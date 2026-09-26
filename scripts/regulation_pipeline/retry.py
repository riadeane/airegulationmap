"""Reusable retry policy for transient Anthropic API failures.

Extracted from the old ``api._call_with_retries`` so the same policy is
expressible independently of any domain string (it took a ``country`` only to
format log lines) and independent of ``print`` (it now logs). The classification
is: auth / permission / 4xx -> fatal (don't retry); rate-limit / timeout /
connection / 5xx -> retry with exponential backoff, honoring a ``Retry-After``
header when present on *any* retryable error (the old code honored it only on the
rate-limit path).
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from typing import TypeVar

import anthropic

from .errors import FatalAPIError

logger = logging.getLogger(__name__)

T = TypeVar("T")

# 1 initial try + 3 retries (backoff ~2s, 4s, 8s plus jitter).
MAX_ATTEMPTS = 4

# Transient errors worth retrying.
_RETRYABLE = (
    anthropic.RateLimitError,
    anthropic.APITimeoutError,
    anthropic.APIConnectionError,
)


def _retry_after(exc: Exception) -> float | None:
    """Return the server-requested delay from a ``Retry-After`` header, if any."""
    response = getattr(exc, "response", None)
    if response is None:
        return None
    try:
        value = float(response.headers.get("retry-after"))
    except (AttributeError, TypeError, ValueError):
        return None
    return value if value > 0 else None


# Upper bound on a server-requested delay, so one odd Retry-After header
# cannot stall a run for hours.
MAX_RETRY_AFTER_SECONDS = 120.0

# 4xx responses that concern this one request (malformed, too large, not
# processable): the request fails, the run goes on. Other 4xx (a wrong model
# id, a revoked key) would fail every request, so they stay fatal. A sync run
# still aborts after five failed countries in a row.
_REQUEST_ERRORS = frozenset({400, 413, 422})


def _backoff(attempt: int, exc: Exception) -> float:
    """Exponential backoff with jitter, overridden by ``Retry-After``."""
    server = _retry_after(exc)
    if server is not None:
        return min(server, MAX_RETRY_AFTER_SECONDS)
    return 2 * (2 ** attempt) + random.uniform(0, 1)


def call_with_retries(
    call: Callable[[], T],
    *,
    label: str,
    sleep: Callable[[float], None] = time.sleep,
) -> T | None:
    """Invoke ``call`` with backoff on transient errors.

    Returns the call's result, or ``None`` once retries are exhausted on a
    transient error. Raises :class:`FatalAPIError` for unrecoverable conditions.
    ``label`` is used only for log context; ``sleep`` is injectable for tests.
    """
    for attempt in range(MAX_ATTEMPTS):
        last_attempt = attempt == MAX_ATTEMPTS - 1
        try:
            return call()
        except anthropic.AuthenticationError as exc:
            raise FatalAPIError(f"Authentication failed (invalid API key): {exc}") from exc
        except anthropic.PermissionDeniedError as exc:
            raise FatalAPIError(f"Permission denied (check credits/permissions): {exc}") from exc
        except _RETRYABLE as exc:
            kind = type(exc).__name__
            if last_attempt:
                logger.warning("%s for %s - giving up after %d attempts", kind, label, MAX_ATTEMPTS)
                return None
            delay = _backoff(attempt, exc)
            logger.warning(
                "%s for %s - retrying in %.1fs (attempt %d/%d)",
                kind, label, delay, attempt + 1, MAX_ATTEMPTS,
            )
            sleep(delay)
        except anthropic.APIStatusError as exc:
            if exc.status_code in _REQUEST_ERRORS:
                logger.warning("API error %s for %s - skipping: %s", exc.status_code, label, exc)
                return None
            if exc.status_code < 500:
                raise FatalAPIError(f"API error {exc.status_code}: {exc}") from exc
            if last_attempt:
                logger.warning(
                    "server error (%s) for %s - giving up after %d attempts",
                    exc.status_code, label, MAX_ATTEMPTS,
                )
                return None
            delay = _backoff(attempt, exc)
            logger.warning(
                "server error (%s) for %s - retrying in %.1fs (attempt %d/%d)",
                exc.status_code, label, delay, attempt + 1, MAX_ATTEMPTS,
            )
            sleep(delay)
    return None
