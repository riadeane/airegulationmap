"""The pipeline orchestrator.

:class:`PipelineService` ties selection (staleness), research (a
:class:`~regulation_pipeline.strategies.ResearchStrategy`), and persistence (the
:class:`~regulation_pipeline.repository.Dataset`) together - the logic that used
to live inside ``cli.main``. It has no argparse/exit-code/credential concerns, so
it is unit-testable with a fake strategy and a temp dataset. Answers arrive
already validated (as :class:`~regulation_pipeline.models.ResearchResult`), so the
service only orchestrates applying, validating the dataset, and saving.

Every applied result also records its research provenance (PRD 14) in the
country's subscores.json entry, tagged with this run's id.

With a :class:`~regulation_pipeline.frontier.FrontierContext` (PRD 15) each
result's Frontier Risk Governance block is assembled into a record, gated
on its own (:func:`gate.decide_frontier`) and applied after the five
dimensions, so the lens never changes whether they land.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from . import gate
from .errors import FatalAPIError
from .gate import GateTally
from .models import FrontierRecord, ResearchResult, format_score
from .repository import Dataset
from .staleness import StalenessPolicy
from .strategies import ResearchStrategy

if TYPE_CHECKING:  # avoid importing the db layer unless a mirror is used
    from .db.mirror import Mirror
    from .frontier import FrontierContext
    from .links import LinkChecker

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CountryChange:
    """One applied result: the rows it replaced, the rows it wrote, and the
    gate rule that decided it.

    ``old_*`` are ``None`` for a country with no prior data. The rows use the
    CSV column names (``SCORES_FIELDS`` / ``REGULATION_FIELDS``) and are read
    after the gate applied, so ``new_scores`` holds the gated scores: a held
    result shows no score movement here. Consumers such as the weekly digest
    decide what counts as a change; the service only records what changed.
    """

    country: str
    old_scores: dict | None
    new_scores: dict
    old_regulation: dict | None
    new_regulation: dict
    rule: str = ""


@dataclass(frozen=True)
class RunResult:
    """Outcome of a run: counts for the CLI's exit code, the gate tally, and
    the applied changes plus run id for post-run consumers (the weekly
    digest, the gold-set drift check).

    ``raw_results`` holds every validated result the strategy returned, by
    country, exactly as the model scored it: before the stability gate, so
    a held result is present with its candidate scores. The drift check
    reads these so it measures the model, not the gate. ``raw_frontier``
    holds the assembled Frontier Risk Governance records the same way, and
    ``frontier_gate`` the lens's own gate tally.
    """

    updated: int
    failed: list[str]
    fatal: bool = False
    gate: gate.GateTally = field(default_factory=gate.GateTally)
    run_id: str = ""
    changes: tuple[CountryChange, ...] = field(default_factory=tuple)
    calibration_break: dict | None = None
    raw_results: dict[str, ResearchResult] = field(default_factory=dict)
    raw_frontier: dict[str, FrontierRecord] = field(default_factory=dict)
    # GateTally by name: the ``gate`` field above shadows the module here.
    frontier_gate: GateTally = field(default_factory=GateTally)


class PipelineService:
    def __init__(
        self,
        dataset: Dataset,
        staleness: StalenessPolicy,
        today: date,
        mirror: Mirror | None = None,
        *,
        gate_enabled: bool = True,
        calibration_break: dict | None = None,
        run_id: str | None = None,
        link_checker: LinkChecker | None = None,
        frontier: FrontierContext | None = None,
    ):
        self._dataset = dataset
        self._staleness = staleness
        self._today = today
        # One id per run, shared with the Supabase research_runs row when a
        # mirror is attached (the CLI passes the mirror's id) so the digest can
        # be regenerated from the database by the same id.
        self._run_id = run_id or str(uuid.uuid4())
        # Optional Supabase dual-write. Deliberately OUTSIDE Dataset: the file
        # stores and their byte contracts stay untouched, and every mirror
        # call below is downgraded to a warning - a mirror failure can never
        # fail a run or change its exit code.
        self._mirror = mirror
        # The stability gate (gate.py). Off only for a calibration run, which
        # records ``calibration_break`` ({date, model, prompt_version, reason})
        # in history.json so the frontend can label the shift.
        self._gate_enabled = gate_enabled
        self._break = calibration_break
        # Optional link check (links.py): dead cited URLs are dropped before
        # a result is gated and written. A checker failure keeps the result
        # as it was.
        self._links = link_checker
        self._dead_links = 0
        # Frontier Risk Governance (PRD 15): assembles each answer's frontier
        # block. Without it a result's frontier block (if any) is ignored.
        self._frontier = frontier
        self._raw_frontier: dict[str, FrontierRecord] = {}
        self._frontier_tally = gate.GateTally()

    def select(self, targets: list[str] | None, *, force: bool) -> tuple[list[str], list[str]]:
        """Return ``(all_targets, to_update)``. ``targets`` is an explicit
        (already-canonicalized) country list, or ``None`` for "every known
        country". ``to_update`` is the subset that is stale under the policy."""
        all_targets = targets if targets is not None else self._dataset.countries()
        to_update = [
            country
            for country in all_targets
            if self._staleness.should_update(
                self._dataset.scores_row(country),
                self._dataset.regulation_row(country),
                force=force,
            )
        ]
        return all_targets, to_update

    def run(self, strategy: ResearchStrategy, to_update: list[str]) -> RunResult:
        """Research ``to_update`` with ``strategy``, folding each valid answer
        into the dataset, then validate and persist. A
        :class:`~regulation_pipeline.errors.FatalAPIError`, or any unexpected
        error from the strategy, aborts the run but the work completed so far is
        still saved."""
        reg_rows = {country: self._dataset.regulation_row(country) or {} for country in to_update}

        updated = 0
        failed: list[str] = []
        tally = gate.GateTally()
        changes: list[CountryChange] = []
        raw: dict[str, ResearchResult] = {}
        self._mirror_call("begin", len(to_update))

        try:
            for country, result in strategy.research(to_update, reg_rows):
                if isinstance(result, ResearchResult):
                    raw[country] = result
                    result = self._check_links(country, result)
                applied = None if result is None else self._apply(country, result)
                if applied is None:
                    failed.append(country)
                else:
                    decision, change = applied
                    updated += 1
                    tally.add(country, decision)
                    changes.append(change)
                    self._mirror_record(country, result)
        except Exception as exc:
            # FatalAPIError is the expected abort; anything else (a network
            # error the strategy did not absorb, a bug) must not throw away
            # the countries already applied and paid for either.
            if isinstance(exc, FatalAPIError):
                logger.error("FATAL: %s", exc)
            else:
                logger.exception("FATAL: unexpected error during research")
            logger.error("Aborting. %d countries updated before failure.", updated)
            recorded = self._record_break(updated, len(to_update))
            if updated:
                logger.info("Saving partial progress...")
                self._dataset.save()
            # Mirror AFTER the files are safe - same ordering as the happy path.
            self._mirror_call(
                "finish", updated, len(set(failed)), True,
                gate_counts=tally.counts, calibration_break=recorded,
            )
            return self._result(updated, failed, tally, changes, raw, recorded, fatal=True)

        recorded = self._record_break(updated, len(to_update))
        if self._links is not None:
            logger.info("links: %d dead cited URLs dropped", self._dead_links)
        for error in self._dataset.validate():
            logger.warning("validation: %s", error)

        logger.info("Writing output files...")
        self._dataset.save()
        self._mirror_call(
            "finish", updated, len(set(failed)), False,
            gate_counts=tally.counts, calibration_break=recorded,
        )
        return self._result(updated, failed, tally, changes, raw, recorded, fatal=False)

    def _check_links(self, country: str, result: ResearchResult) -> ResearchResult:
        """``result`` without its dead cited URLs (and with the live pages'
        titles), or unchanged when no checker is attached or it fails."""
        if self._links is None:
            return result
        try:
            checked, dead = self._links.filter_result(result)
        except Exception:
            logger.warning("links: check failed for %s - kept every source", country, exc_info=True)
            return result
        for status in dead:
            logger.info("links: %s dropped %s (%s)", country, status.url, status.reason)
        self._dead_links += len(dead)
        return checked

    def _record_break(self, updated: int, attempted: int) -> dict | None:
        """Record the calibration break only once the run has applied
        something: a break written by a run that re-scored nothing would tell
        the rubric guard the switch is done, and the next (gated) run would
        land the whole shift as policy change. ``complete`` says whether every
        attempted country was re-scored; the guard treats an incomplete break
        for the current rubric as still due."""
        if self._break is None or updated == 0:
            if self._break is not None:
                logger.warning("calibration break not recorded: no country was updated")
            return None
        entry = {**self._break, "complete": updated >= attempted}
        self._dataset.record_break(entry)
        return entry

    def _result(
        self, updated: int, failed: list[str], tally: gate.GateTally,
        changes: list[CountryChange], raw: dict[str, ResearchResult],
        recorded_break: dict | None, *, fatal: bool,
    ) -> RunResult:
        return RunResult(
            updated=updated, failed=sorted(set(failed)), fatal=fatal, gate=tally,
            run_id=self._run_id, changes=tuple(changes), calibration_break=recorded_break,
            raw_results=dict(raw), raw_frontier=dict(self._raw_frontier),
            frontier_gate=self._frontier_tally,
        )

    def standing(self, country: str) -> str:
        """What the gate will do with the next result for ``country``."""
        if not self._gate_enabled:
            return "gate off: any result applies"
        return gate.standing(self._dataset.scores_row(country), self._dataset.pending_for(country))

    def _apply(self, country: str, result) -> tuple[gate.Decision, CountryChange] | None:
        """Gate and apply one validated result. Returns the gate decision and
        the rows it replaced, or ``None`` on failure. Isolated so an
        unexpected error on one country can never abort the whole run."""
        old_scores = _copy(self._dataset.scores_row(country))
        old_regulation = _copy(self._dataset.regulation_row(country))
        try:
            existing_scores = self._dataset.scores_row(country)
            existing_reg = self._dataset.regulation_row(country)
            if self._gate_enabled:
                decision = gate.decide(
                    existing_scores, existing_reg, result,
                    self._dataset.pending_for(country), self._today,
                    seen_sources=self._dataset.seen_sources_for(country),
                )
            else:
                decision = gate.ungated(existing_scores, result)
            # Remember what the country cited before this result replaces the
            # Sources column, and what it cites now, held or not.
            self._dataset.remember_sources(
                country,
                gate.cited_urls((existing_reg or {}).get("Sources")) | gate.cited_urls(result.sources),
            )
            outcome = self._dataset.apply(
                country, result, self._today, apply_scores=decision.apply_scores,
            )
            self._dataset.set_pending(country, decision.pending)
            # The evidence record describes the pass behind the text, sources
            # and confidence, which always land, so it is written for a held
            # result too. No provenance (a result built outside a strategy)
            # means no record rather than a stale one.
            provenance = result.provenance
            self._dataset.set_evidence(
                country, provenance.record(self._run_id) if provenance is not None else None,
            )
        except Exception:
            logger.exception("failed to apply result for %s", country)
            return None
        self._apply_frontier(country, result, old_scores, old_regulation)

        note = "(new snapshot)" if outcome.history_added else "(no snapshot)"
        logger.info(
            "%s: %s - %s; avg %s, confidence %s %s",
            country, decision.rule, decision.reason, format_score(outcome.average),
            outcome.confidence, note,
        )
        for move in decision.large_moves:
            logger.warning(
                "%s: large move %s %s -> %s", country, move.dimension,
                format_score(move.old), format_score(move.new),
            )
        change = CountryChange(
            country=country,
            old_scores=old_scores,
            new_scores=dict(self._dataset.scores_row(country) or {}),
            old_regulation=old_regulation,
            new_regulation=dict(self._dataset.regulation_row(country) or {}),
            rule=decision.rule,
        )
        return decision, change

    def _apply_frontier(
        self, country: str, result: ResearchResult, old_scores: dict | None, old_reg: dict | None,
    ) -> None:
        """Assemble, gate and apply the result's Frontier Risk Governance
        block, after the five dimensions landed. A failure here is logged and
        leaves the lens as it was; the five dimensions are already applied."""
        answer = result.frontier_answer()
        if self._frontier is None or answer is None:
            return
        try:
            record = self._frontier.assemble(country, answer)
            self._raw_frontier[country] = record
            if self._gate_enabled:
                decision = gate.decide_frontier(
                    old_scores, old_reg, record, self._dataset.frontier_pending_for(country),
                    self._today, seen_sources=self._dataset.seen_sources_for(country),
                )
            else:
                decision = gate.ungated_frontier(old_scores, record)
            self._dataset.remember_sources(
                country,
                gate.cited_urls((old_reg or {}).get("Frontier Sources")) | gate.cited_urls(record.sources),
            )
            self._dataset.apply_frontier(country, record, self._today, apply_score=decision.apply_scores)
            self._dataset.set_frontier_pending(country, decision.pending)
        except Exception:
            logger.exception("failed to apply the frontier block for %s", country)
            return
        self._frontier_tally.add(country, decision)
        logger.info(
            "%s: frontier %s - %s; %s", country, decision.rule, decision.reason, record.describe(),
        )
        for move in decision.large_moves:
            logger.warning(
                "%s: large move %s %s -> %s", country, move.dimension,
                format_score(move.old), format_score(move.new),
            )

    # -- mirror plumbing (never raises) ----------------------------------------

    def _mirror_record(self, country: str, result) -> None:
        if self._mirror is None:
            return
        try:
            self._mirror.record(
                country, result, self._today,
                scores_row=dict(self._dataset.scores_row(country) or {}),
                subscores=self._dataset.subscores_for(country) or {},
                history=self._dataset.history_for(country),
            )
        except Exception:
            logger.warning("mirror: record(%s) failed - continuing", country, exc_info=True)

    def _mirror_call(self, method: str, *args, **kwargs) -> None:
        if self._mirror is None:
            return
        try:
            getattr(self._mirror, method)(*args, **kwargs)
        except Exception:
            logger.warning("mirror: %s failed - continuing", method, exc_info=True)


def _copy(row: dict | None) -> dict | None:
    return dict(row) if row is not None else None
