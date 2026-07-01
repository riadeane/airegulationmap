"""Research strategies: two interchangeable backends behind one interface.

The synchronous path researches countries one call at a time (immediate, full
price); the Batches path submits them all at once (50% token pricing, ~1h
turnaround). Both are generators that yield ``(country, raw_result_or_None)`` as
answers arrive, so the service can commit results incrementally — and still save
whatever completed if the run aborts partway through.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterator

from .api import ResearchClient, parse_message
from .batch import BatchRunner
from .errors import FatalAPIError

logger = logging.getLogger(__name__)

# One yielded answer: the country and its raw parsed JSON dict, or None on failure.
Answer = tuple[str, "dict | None"]

# Decides whether a given country gets a web-search-backed research pass.
SearchDecider = Callable[[str], bool]


class ResearchStrategy(ABC):
    """A backend that researches a list of countries, yielding answers as they
    arrive. May raise :class:`~regulation_pipeline.errors.FatalAPIError` to abort
    the run; answers yielded before the raise have already been handed to the
    caller and are committed."""

    @abstractmethod
    def research(self, countries: list[str], reg_rows: dict[str, dict]) -> Iterator[Answer]:
        ...


class SyncStrategy(ResearchStrategy):
    """One API call per country, in order. Aborts the run if too many calls fail
    in a row (a signal of a systemic problem rather than isolated flakiness)."""

    def __init__(
        self,
        client: ResearchClient,
        use_search_for: SearchDecider,
        *,
        sleep: Callable[[float], None] = time.sleep,
        max_consecutive_failures: int = 5,
    ):
        self._client = client
        self._use_search_for = use_search_for
        self._sleep = sleep
        self._max_consecutive_failures = max_consecutive_failures

    def research(self, countries: list[str], reg_rows: dict[str, dict]) -> Iterator[Answer]:
        consecutive = 0
        for i, country in enumerate(countries, 1):
            logger.info("[%d/%d] Researching %s...", i, len(countries), country)
            result = self._client.research(
                country, reg_rows.get(country), use_search=self._use_search_for(country)
            )
            if result is None:
                consecutive += 1
                yield country, None
                if consecutive >= self._max_consecutive_failures:
                    raise FatalAPIError(
                        f"{consecutive} consecutive failures — likely a systemic issue"
                    )
                self._sleep(2)
                continue

            consecutive = 0
            yield country, result
            if i < len(countries):
                self._sleep(0.5)


class BatchStrategy(ResearchStrategy):
    """Submit every country in one batch (with a transient-failure retry batch),
    then yield the parsed answer for each."""

    def __init__(
        self,
        client: ResearchClient,
        runner: BatchRunner,
        use_search_for: SearchDecider,
    ):
        self._client = client
        self._runner = runner
        self._use_search_for = use_search_for

    def research(self, countries: list[str], reg_rows: dict[str, dict]) -> Iterator[Answer]:
        params_by_country = {
            country: self._client.request_params(
                country, reg_rows.get(country), use_search=self._use_search_for(country)
            )
            for country in countries
        }
        logger.info("Submitting batch of %d requests...", len(params_by_country))
        messages, _failed = self._runner.research(params_by_country)

        for country in countries:
            message = messages.get(country)
            if message is None:
                yield country, None  # errored/canceled — no message returned
            else:
                yield country, parse_message(message, country)
