"""The pipeline orchestrator.

:class:`PipelineService` ties selection (staleness), research (a
:class:`~regulation_pipeline.strategies.ResearchStrategy`), and persistence (the
:class:`~regulation_pipeline.repository.Dataset`) together — the logic that used
to live inside ``cli.main``. It has no argparse/exit-code/credential concerns, so
it is unit-testable with a fake strategy and a temp dataset. Answers arrive
already validated (as :class:`~regulation_pipeline.models.ResearchResult`), so the
service only orchestrates applying, validating the dataset, and saving.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from .errors import FatalAPIError
from .repository import Dataset
from .staleness import StalenessPolicy
from .strategies import ResearchStrategy

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RunResult:
    """Outcome of a run, for the CLI to turn into an exit code."""

    updated: int
    failed: list[str]
    fatal: bool = False


class PipelineService:
    def __init__(self, dataset: Dataset, staleness: StalenessPolicy, today: date):
        self._dataset = dataset
        self._staleness = staleness
        self._today = today

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

        try:
            for country, result in strategy.research(to_update, reg_rows):
                if result is None or not self._apply(country, result):
                    failed.append(country)
                else:
                    updated += 1
        except FatalAPIError as exc:
            logger.error("FATAL: %s", exc)
            logger.error("Aborting. %d countries updated before failure.", updated)
            if updated:
                logger.info("Saving partial progress...")
                self._dataset.save()
            return RunResult(updated=updated, failed=sorted(set(failed)), fatal=True)

        for error in self._dataset.validate():
            logger.warning("validation: %s", error)

        logger.info("Writing output files...")
        self._dataset.save()
        return RunResult(updated=updated, failed=sorted(set(failed)))

    def _apply(self, country: str, result) -> bool:
        """Apply one validated result. Isolated so an unexpected error on one
        country can never abort the whole run."""
        try:
            outcome = self._dataset.apply(country, result, self._today)
        except Exception:
            logger.exception("failed to apply result for %s", country)
            return False

        note = "(new snapshot)" if outcome.history_added else "(no score change)"
        logger.info("%s: avg %s, confidence %s %s", country, outcome.average, outcome.confidence, note)
        return True
