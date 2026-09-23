"""The pipeline orchestrator.

:class:`PipelineService` ties selection (staleness), research (a
:class:`~regulation_pipeline.strategies.ResearchStrategy`), and persistence (the
:class:`~regulation_pipeline.repository.Dataset`) together - the logic that used
to live inside ``cli.main``. It has no argparse/exit-code/credential concerns, so
it is unit-testable with a fake strategy and a temp dataset. Answers arrive
already validated (as :class:`~regulation_pipeline.models.ResearchResult`), so the
service only orchestrates applying, validating the dataset, and saving.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from . import gate
from .errors import FatalAPIError
from .repository import Dataset
from .staleness import StalenessPolicy
from .strategies import ResearchStrategy

if TYPE_CHECKING:  # avoid importing the db layer unless a mirror is used
    from .db.mirror import Mirror

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RunResult:
    """Outcome of a run, for the CLI to turn into an exit code."""

    updated: int
    failed: list[str]
    fatal: bool = False
    gate: gate.GateTally = field(default_factory=gate.GateTally)


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
    ):
        self._dataset = dataset
        self._staleness = staleness
        self._today = today
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
        :class:`~regulation_pipeline.errors.FatalAPIError` aborts the run but the
        work completed so far is still saved."""
        reg_rows = {country: self._dataset.regulation_row(country) or {} for country in to_update}

        updated = 0
        failed: list[str] = []
        tally = gate.GateTally()
        if self._break is not None:
            self._dataset.record_break(self._break)
        self._mirror_call("begin", len(to_update))

        try:
            for country, result in strategy.research(to_update, reg_rows):
                decision = None if result is None else self._apply(country, result)
                if decision is None:
                    failed.append(country)
                else:
                    updated += 1
                    tally.add(country, decision)
                    self._mirror_record(country, result)
        except FatalAPIError as exc:
            logger.error("FATAL: %s", exc)
            logger.error("Aborting. %d countries updated before failure.", updated)
            if updated:
                logger.info("Saving partial progress...")
                self._dataset.save()
            # Mirror AFTER the files are safe - same ordering as the happy path.
            self._mirror_call("finish", updated, len(set(failed)), True, gate_counts=tally.counts)
            return RunResult(updated=updated, failed=sorted(set(failed)), fatal=True, gate=tally)

        for error in self._dataset.validate():
            logger.warning("validation: %s", error)

        logger.info("Writing output files...")
        self._dataset.save()
        self._mirror_call("finish", updated, len(set(failed)), False, gate_counts=tally.counts)
        return RunResult(updated=updated, failed=sorted(set(failed)), gate=tally)

    def standing(self, country: str) -> str:
        """What the gate will do with the next result for ``country``."""
        if not self._gate_enabled:
            return "gate off: any result applies"
        return gate.standing(self._dataset.scores_row(country), self._dataset.pending_for(country))

    def _apply(self, country: str, result) -> gate.Decision | None:
        """Gate and apply one validated result. Returns the gate decision, or
        ``None`` on failure. Isolated so an unexpected error on one country
        can never abort the whole run."""
        try:
            existing_scores = self._dataset.scores_row(country)
            if self._gate_enabled:
                decision = gate.decide(
                    existing_scores, self._dataset.regulation_row(country), result,
                    self._dataset.pending_for(country), self._today,
                )
            else:
                decision = gate.ungated(existing_scores, result)
            outcome = self._dataset.apply(
                country, result, self._today, apply_scores=decision.apply_scores,
            )
            self._dataset.set_pending(country, decision.pending)
        except Exception:
            logger.exception("failed to apply result for %s", country)
            return None

        note = "(new snapshot)" if outcome.history_added else "(no snapshot)"
        logger.info(
            "%s: %s - %s; avg %s, confidence %s %s",
            country, decision.rule, decision.reason, outcome.average, outcome.confidence, note,
        )
        for move in decision.large_moves:
            logger.warning(
                "%s: large move %s %s -> %s", country, move.dimension, move.old, move.new,
            )
        return decision

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
