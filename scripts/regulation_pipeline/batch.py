"""Message Batches API support.

The weekly run is the textbook batch workload: ~196 independent requests, no
latency requirement. Batches bill all token usage at 50% of standard prices,
support every Messages API feature (web search, structured outputs), and return
per-request results - a transient failure costs one country, not the run.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import anthropic

from .api import add_usage
from .retry import call_with_retries

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30
# Most batches complete within an hour; the API allows up to 24h. The GitHub
# Actions job dies at 6h (update-data.yml sets timeout-minutes), and a killed
# job saves nothing, so this budget covers ALL batches of a run together (the
# first one, the transient-failure retry, and pause_turn continuations) and
# leaves time to apply, mirror, write the digest and commit.
MAX_WAIT_SECONDS = 4 * 60 * 60
# After canceling a timed-out batch, how long to wait for it to reach a terminal
# state so we can still collect the requests that already succeeded.
CANCEL_GRACE_SECONDS = 10 * 60
# A follow-up batch (retry or continuation) is only worth submitting with at
# least this much of the wait budget left.
MIN_ROUND_SECONDS = 15 * 60
# pause_turn continuations per country, as in the synchronous path
# (api.MAX_CONTINUATIONS).
MAX_CONTINUATION_ROUNDS = 3


def build_batch_requests(params_by_country: dict[str, dict]):
    """Map countries to batch requests with safe ``custom_id``s.

    ``custom_id`` allows a limited character set, and country names contain
    spaces, dots, and non-ASCII ("Bosnia and Herz.", "Côte d'Ivoire") - so use
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
        # Seconds spent polling so far, across every batch of the run.
        self._waited = 0
        # Cumulative token usage over succeeded requests (best-effort
        # provenance; batches bill these at 50%).
        self._usage = {"input": 0, "output": 0, "searches": 0}

    def usage(self) -> dict[str, int]:
        return dict(self._usage)

    def research(self, params_by_country: dict[str, dict]) -> tuple[dict, list[str]]:
        """Run the batch, then follow-up rounds in smaller batches: transient
        failures are resubmitted once, and a result the server paused mid-search
        (``stop_reason == "pause_turn"``) is continued by sending the paused turn
        back, up to :data:`MAX_CONTINUATION_ROUNDS` times. Returns ``(messages,
        failed_countries)`` where messages maps country -> Message for succeeded
        requests (a result still paused after the last round stays in, and the
        parser rejects it)."""
        messages, errors = self._run_once(params_by_country)
        retry = {c for c, kind in errors.items() if kind == "retryable"}
        conversations: dict[str, list] = {}

        for _ in range(MAX_CONTINUATION_ROUNDS):
            paused = {
                c: m for c, m in messages.items()
                if getattr(m, "stop_reason", None) == "pause_turn"
            }
            if not paused and not retry:
                break
            if self._max_wait - self._waited < MIN_ROUND_SECONDS:
                logger.warning(
                    "Batch wait budget nearly spent - not resubmitting %d transient "
                    "failures or continuing %d paused results", len(retry), len(paused),
                )
                break
            round_params = {c: params_by_country[c] for c in retry}
            for country, message in paused.items():
                turns = conversations.setdefault(country, list(params_by_country[country]["messages"]))
                turns.append({"role": "assistant", "content": message.content})
                round_params[country] = {**params_by_country[country], "messages": list(turns)}
            logger.info(
                "Follow-up batch: %d transient failures, %d paused results to continue...",
                len(retry), len(paused),
            )
            round_messages, round_errors = self._run_once(round_params)
            messages.update(round_messages)
            errors = {c: k for c, k in errors.items() if c not in round_messages}
            errors.update(round_errors)
            # Transient failures get one resubmission; later rounds only
            # continue paused results.
            retry = set()

        return messages, sorted(errors)

    def _run_once(self, params_by_country: dict[str, dict]) -> tuple[dict, dict]:
        """Submit one batch and wait for it to end. Returns ``(messages,
        errors)`` where ``errors`` maps country -> "retryable" | "fatal".

        Every API call goes through the transient-error retry policy: one
        connection blip on a poll must never cost a run whose results are
        already paid for."""
        requests, id_map = build_batch_requests(params_by_country)

        batch = self._call(
            lambda: self._client.messages.batches.create(requests=requests), "batch submit"
        )
        if batch is None:
            logger.error("Could not submit a batch of %d requests", len(requests))
            return {}, {country: "retryable" for country in id_map.values()}

        logger.info("Batch %s submitted (%d requests, 50%% token pricing)", batch.id, len(requests))

        while batch.processing_status != "ended":
            if self._waited >= self._max_wait:
                # Don't discard already-succeeded (already-billed) work: cancel
                # the batch, let it reach a terminal state, then collect whatever
                # completed. Requests still in flight come back as "canceled" and
                # are retried/reported by the caller.
                logger.warning(
                    "Batch %s still processing after the %ds wait budget - canceling and "
                    "collecting partial results", batch.id, self._max_wait,
                )
                self._call(lambda b=batch.id: self._client.messages.batches.cancel(b), "batch cancel")
                batch = self._drain_after_cancel(batch)
                break
            self._sleep(self._poll_interval)
            self._waited += self._poll_interval
            refreshed = self._call(
                lambda b=batch.id: self._client.messages.batches.retrieve(b), f"batch poll {batch.id}"
            )
            if refreshed is None:
                continue  # keep polling; the wait budget bounds this
            batch = refreshed
            counts = batch.request_counts
            logger.info(
                "... %s: %d processing, %d succeeded, %d errored (%ds)",
                batch.processing_status, counts.processing, counts.succeeded, counts.errored,
                self._waited,
            )

        return self._collect(batch, id_map)

    def _call(self, call, label: str):
        """One batch API call under :func:`~regulation_pipeline.retry.call_with_retries`.
        Returns ``None`` once transient retries are exhausted."""
        return call_with_retries(call, label=label, sleep=self._sleep)

    def _drain_after_cancel(self, batch):
        """Poll a canceled batch until it ends, so succeeded results are
        collectable. Bounded by ``cancel_grace_seconds`` (default
        :data:`CANCEL_GRACE_SECONDS`)."""
        grace = 0
        while batch.processing_status != "ended" and grace < self._cancel_grace_seconds:
            self._sleep(self._poll_interval)
            grace += self._poll_interval
            refreshed = self._call(
                lambda b=batch.id: self._client.messages.batches.retrieve(b), f"batch poll {batch.id}"
            )
            if refreshed is not None:
                batch = refreshed
        return batch

    def _collect(self, batch, id_map: dict[str, str]) -> tuple[dict, dict]:
        messages: dict = {}
        errors: dict = {}
        if batch.processing_status != "ended":
            # Results can't be read until the batch ends. Resubmitting would pay
            # again for requests that already succeeded, so these countries fail
            # this run; the batch id lets someone fetch the results later.
            logger.error(
                "Batch %s did not end; its results are unreadable for now. %d countries "
                "fail this run.", batch.id, len(id_map),
            )
            return messages, {country: "fatal" for country in id_map.values()}

        results = self._call(
            lambda: list(self._client.messages.batches.results(batch.id)), f"batch results {batch.id}"
        )
        if results is None:
            logger.error(
                "Could not read the results of batch %s; %d countries fail this run. "
                "The results stay available from the Batches API for 29 days.",
                batch.id, len(id_map),
            )
            return messages, {country: "fatal" for country in id_map.values()}

        for result in results:
            country = id_map[result.custom_id]
            kind = result.result.type
            if kind == "succeeded":
                messages[country] = result.result.message
                add_usage(self._usage, getattr(result.result.message, "usage", None))
            elif kind == "errored":
                error_type = _error_type(result.result.error)
                # invalid_request means the request itself is malformed -
                # resubmitting the same thing can't succeed.
                errors[country] = "fatal" if error_type in _FATAL_ERRORS else "retryable"
                logger.warning("batch request for %s errored (%s)", country, error_type)
            else:  # canceled / expired
                errors[country] = "retryable"
                logger.warning("batch request for %s %s", country, kind)

        return messages, errors


# Batch error kinds that resubmitting cannot fix.
_FATAL_ERRORS = frozenset({"invalid_request_error", "invalid_request"})


def _error_type(error) -> str | None:
    """The error kind of an errored batch result. The SDK wraps it: the result
    carries an ``ErrorResponse`` (``type == "error"``) whose ``error.type`` is
    the kind, such as ``"invalid_request_error"`` or ``"overloaded_error"``."""
    inner = getattr(error, "error", None)
    return getattr(inner, "type", None) or getattr(error, "type", None)
