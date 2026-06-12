"""Message Batches API support.

The monthly run is the textbook batch workload: ~196 independent
requests, no latency requirement. Batches bill all token usage at 50%
of standard prices, support every Messages API feature (including the
web_search tool and structured outputs), and return per-request
results — a transient failure costs one country, not the run.
"""

import time

try:
    import anthropic
except ImportError:
    anthropic = None

from .api import FatalAPIError

POLL_INTERVAL_SECONDS = 30
# Most batches complete within an hour; the API allows up to 24h. The
# GitHub Actions job would die long before that, so give up earlier.
MAX_WAIT_SECONDS = 4 * 60 * 60


def build_batch_requests(params_by_country):
    """Map countries to batch requests with safe custom_ids.

    custom_id allows a limited character set, and country names contain
    spaces, dots, and non-ASCII ("Bosnia and Herz.", "Côte d'Ivoire") —
    so use positional ids and return the reverse mapping.
    """
    requests = []
    id_map = {}
    for i, country in enumerate(sorted(params_by_country)):
        custom_id = f"country-{i:04d}"
        id_map[custom_id] = country
        requests.append({"custom_id": custom_id, "params": params_by_country[country]})
    return requests, id_map


def run_batch(client, params_by_country, poll_interval=POLL_INTERVAL_SECONDS):
    """Submit one batch and wait for it to end.

    Returns (messages, errors): messages maps country -> Message for
    succeeded requests; errors maps country -> "retryable" | "fatal".
    """
    requests, id_map = build_batch_requests(params_by_country)

    try:
        batch = client.messages.batches.create(requests=requests)
    except anthropic.AuthenticationError as e:
        raise FatalAPIError(f"Authentication failed (invalid API key): {e}")
    except anthropic.PermissionDeniedError as e:
        raise FatalAPIError(f"Permission denied (check credits/permissions): {e}")

    print(f"  Batch {batch.id} submitted ({len(requests)} requests, 50% token pricing)")

    waited = 0
    while batch.processing_status != "ended":
        if waited >= MAX_WAIT_SECONDS:
            client.messages.batches.cancel(batch.id)
            raise FatalAPIError(
                f"Batch {batch.id} still processing after {MAX_WAIT_SECONDS}s — canceled"
            )
        time.sleep(poll_interval)
        waited += poll_interval
        batch = client.messages.batches.retrieve(batch.id)
        c = batch.request_counts
        print(
            f"  ... {batch.processing_status}: {c.processing} processing, "
            f"{c.succeeded} succeeded, {c.errored} errored ({waited}s)"
        )

    messages = {}
    errors = {}
    for result in client.messages.batches.results(batch.id):
        country = id_map[result.custom_id]
        kind = result.result.type
        if kind == "succeeded":
            messages[country] = result.result.message
        elif kind == "errored":
            error_type = result.result.error.type
            # invalid_request means the request itself is malformed —
            # resubmitting the same thing can't succeed.
            errors[country] = "fatal" if error_type == "invalid_request" else "retryable"
            print(f"  WARNING: batch request for {country} errored ({error_type})")
        else:  # canceled / expired
            errors[country] = "retryable"
            print(f"  WARNING: batch request for {country} {kind}")

    return messages, errors


def research_countries_batch(client, params_by_country):
    """Run the batch, then retry transient failures once in a second,
    smaller batch. Returns (messages, failed_countries)."""
    messages, errors = run_batch(client, params_by_country)

    retryable = {c for c, kind in errors.items() if kind == "retryable"}
    if retryable:
        print(f"Retrying {len(retryable)} transient failures in a second batch...")
        retry_params = {c: params_by_country[c] for c in retryable}
        retry_messages, retry_errors = run_batch(client, retry_params)
        messages.update(retry_messages)
        errors = {c: k for c, k in errors.items() if c not in retry_messages}
        errors.update(retry_errors)

    return messages, sorted(errors)
