"""Message Batches API support.

The monthly run is the textbook batch workload: ~196 independent requests, no
latency requirement. Batches bill all token usage at 50% of standard prices,
support every Messages API feature (web search, structured outputs), and return
per-request results — a transient failure costs one country, not the run.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import anthropic

from .errors import FatalAPIError

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30
# Most batches complete within an hour; the API allows up to 24h. The GitHub
# Actions job would die long before that, so give up earlier.
MAX_WAIT_SECONDS = 4 * 60 * 60
# After canceling a timed-out batch, how long to wait for it to reach a terminal
# state so we can still collect the requests that already succeeded.
CANCEL_GRACE_SECONDS = 5 * 60


def build_batch_requests(params_by_country: dict[str, dict]):
    """Map countries to batch requests with safe ``custom_id``s.

    ``custom_id`` allows a limited character set, and country names contain
    spaces, dots, and non-ASCII ("Bosnia and Herz.", "Côte d'Ivoire") — so use
    positional ids and return the reverse mapping.
    """
    requests = []
    id_map = {}
    for i, country in enumerate(sorted(params_by_country)):
        custom_id = f"country-{i:04d}"
        id_map[custom_id] = country
        requests.append({"custom_id": custom_id, "params": params_by_country[country]})
    return requests, id_map


class BatchRunner:
    """Submits a batch, polls to completion, and classifies per-request results.
    ``sleep`` is injectable so tests can drive the poll loop without real waits.
    """

    def __init__(
        self,
        client: anthropic.Anthropic,
        *,
        poll_interval: int = POLL_INTERVAL_SECONDS,
        max_wait: int = MAX_WAIT_SECONDS,
        cancel_grace_seconds: int = CANCEL_GRACE_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._client = client
        self._poll_interval = poll_interval
        self._max_wait = max_wait
        self._cancel_grace_seconds = cancel_grace_seconds
        self._sleep = sleep
        # Cumulative token usage over succeeded requests (best-effort
        # provenance; batches bill these at 50%).
        self._usage = {"input": 0, "output": 0}

    def usage(self) -> dict[str, int]:
        return dict(self._usage)

    def research(self, params_by_country: dict[str, dict]) -> tuple[dict, list[str]]:
        """Run the batch, then retry transient failures once in a second,
        smaller batch. Returns ``(messages, failed_countries)`` where messages
        maps country -> Message for succeeded requests."""
        messages, errors = self._run_once(params_by_country)

        retryable = {c for c, kind in errors.items() if kind == "retryable"}
        if retryable:
            logger.info("Retrying %d transient failures in a second batch...", len(retryable))
            retry_params = {c: params_by_country[c] for c in retryable}
            retry_messages, retry_errors = self._run_once(retry_params)
            messages.update(retry_messages)
            errors = {c: k for c, k in errors.items() if c not in retry_messages}
            errors.update(retry_errors)

        return messages, sorted(errors)

    def _run_once(self, params_by_country: dict[str, dict]) -> tuple[dict, dict]:
        """Submit one batch and wait for it to end. Returns ``(messages,
        errors)`` where ``errors`` maps country -> "retryable" | "fatal"."""
        requests, id_map = build_batch_requests(params_by_country)

        try:
            batch = self._client.messages.batches.create(requests=requests)
        except anthropic.AuthenticationError as exc:
            raise FatalAPIError(f"Authentication failed (invalid API key): {exc}") from exc
        except anthropic.PermissionDeniedError as exc:
            raise FatalAPIError(f"Permission denied (check credits/permissions): {exc}") from exc

        logger.info("Batch %s submitted (%d requests, 50%% token pricing)", batch.id, len(requests))

        waited = 0
        while batch.processing_status != "ended":
            if waited >= self._max_wait:
                # Don't discard already-succeeded (already-billed) work: cancel
                # the batch, let it reach a terminal state, then collect whatever
                # completed. Requests still in flight come back as "canceled" and
                # are retried/reported by the caller.
                logger.warning(
                    "Batch %s still processing after %ds — canceling and collecting "
                    "partial results", batch.id, self._max_wait,
                )
                self._client.messages.batches.cancel(batch.id)
                batch = self._drain_after_cancel(batch)
                break
            self._sleep(self._poll_interval)
            waited += self._poll_interval
            batch = self._client.messages.batches.retrieve(batch.id)
            counts = batch.request_counts
            logger.info(
                "... %s: %d processing, %d succeeded, %d errored (%ds)",
                batch.processing_status, counts.processing, counts.succeeded, counts.errored, waited,
            )

        return self._collect(batch, id_map)

    def _drain_after_cancel(self, batch):
        """Poll a canceled batch until it ends, so succeeded results are
        collectable. Bounded by ``cancel_grace_seconds`` (default
        :data:`CANCEL_GRACE_SECONDS`)."""
        grace = 0
        while batch.processing_status != "ended" and grace < self._cancel_grace_seconds:
            self._sleep(self._poll_interval)
            grace += self._poll_interval
            batch = self._client.messages.batches.retrieve(batch.id)
        return batch

    def _collect(self, batch, id_map: dict[str, str]) -> tuple[dict, dict]:
        messages: dict = {}
        errors: dict = {}
        if batch.processing_status != "ended":
            # Couldn't reach a terminal state to read results — treat everything
            # not already collected as retryable rather than losing the run.
            logger.warning("Batch %s did not end; treating all requests as retryable", batch.id)
            return messages, {country: "retryable" for country in id_map.values()}

        for result in self._client.messages.batches.results(batch.id):
            country = id_map[result.custom_id]
            kind = result.result.type
            if kind == "succeeded":
                messages[country] = result.result.message
                usage = getattr(result.result.message, "usage", None)
                if usage is not None:
                    self._usage["input"] += getattr(usage, "input_tokens", 0) or 0
                    self._usage["output"] += getattr(usage, "output_tokens", 0) or 0
            elif kind == "errored":
                error_type = result.result.error.type
                # invalid_request means the request itself is malformed —
                # resubmitting the same thing can't succeed.
                errors[country] = "fatal" if error_type == "invalid_request" else "retryable"
                logger.warning("batch request for %s errored (%s)", country, error_type)
            else:  # canceled / expired
                errors[country] = "retryable"
                logger.warning("batch request for %s %s", country, kind)

        return messages, errors
