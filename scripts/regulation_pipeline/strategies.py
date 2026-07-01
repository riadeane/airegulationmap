"""Research strategies: two interchangeable backends behind one interface.

The synchronous path researches countries one call at a time (immediate, full
price); the Batches path submits them all at once (50% token pricing, ~1h
turnaround). Both are generators that yield ``(country, ResearchResult | None)``
as answers arrive — ``None`` means the answer failed for *any* reason (transient
error, unparseable JSON, or schema-invalid response). Validating here (rather than
downstream) keeps the sync circuit-breaker able to count invalid responses, and
lets the service deal only in validated domain objects.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterator

from pydantic import ValidationError

from .api import ResearchClient, parse_message
from .batch import BatchRunner
from .errors import FatalAPIError
from .models import ResearchResult

logger = logging.getLogger(__name__)

# One yielded answer: the country and its validated result, or None on any failure.
Answer = tuple[str, "ResearchResult | None"]

# Decides whether a given country gets a web-search-backed research pass.
SearchDecider = Callable[[str], bool]


class ResearchStrategy(ABC):
    """A backend that researches a list of countries, yielding validated answers
    as they arrive. May raise :class:`~regulation_pipeline.errors.FatalAPIError`
    to abort the run; answers yielded before the raise are committed."""

    @abstractmethod
    def research(self, countries: list[str], reg_rows: dict[str, dict]) -> Iterator[Answer]:
        ...


class SyncStrategy(ResearchStrategy):
    """One API call per country, in order. Aborts the run if too many countries
    fail in a row — a transient error, an unparseable answer, or a schema-invalid
    answer all count, since any sustained run of them signals a systemic
    problem rather than isolated flakiness."""

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
            raw = self._client.research(
                country, reg_rows.get(country), use_search=self._use_search_for(country)
            )
            result = _validate(country, raw)
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
    then yield the validated answer for each. The Batches API returns per-request
    results, so there is no consecutive-failure abort — a bad request costs one
    country, not the run."""

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
            raw = parse_message(message, country) if message is not None else None
            yield country, _validate(country, raw)


def _validate(country: str, raw: dict | None) -> ResearchResult | None:
    """Validate a raw answer into a typed result. Returns ``None`` (with a logged
    warning) for a missing or schema-invalid answer."""
    if raw is None:
        return None
    try:
        return ResearchResult.model_validate(raw)
    except ValidationError as exc:
        logger.warning("invalid response for %s: %s", country, _summarize(exc))
        return None


def _summarize(exc: ValidationError) -> str:
    """Condense a pydantic ValidationError to a short one-line summary."""
    parts = []
    for error in exc.errors():
        loc = ".".join(str(p) for p in error["loc"])
        parts.append(f"{loc}: {error['msg']}")
    return "; ".join(parts)
