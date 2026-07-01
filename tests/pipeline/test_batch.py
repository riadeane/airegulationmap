import pytest
from regulation_pipeline.batch import BatchRunner, build_batch_requests
from regulation_pipeline.errors import FatalAPIError

# -- build_batch_requests (custom_id round-trip) -------------------------------


def test_custom_ids_round_trip_for_awkward_country_names():
    params = {
        "Bosnia and Herz.": {"model": "m"},
        "Côte d'Ivoire": {"model": "m"},
        "United States of America": {"model": "m"},
    }
    requests, id_map = build_batch_requests(params)
    assert len(requests) == 3
    for req in requests:
        cid = req["custom_id"]
        assert cid.replace("country-", "").isdigit()
        assert id_map[cid] in params
        assert req["params"] is params[id_map[cid]]
    assert set(id_map.values()) == set(params)


def test_requests_are_deterministically_ordered():
    params = {name: {} for name in ["Zimbabwe", "Albania", "Mexico"]}
    requests, id_map = build_batch_requests(params)
    assert [id_map[r["custom_id"]] for r in requests] == ["Albania", "Mexico", "Zimbabwe"]


# -- fake anthropic batches client ---------------------------------------------


class _Counts:
    def __init__(self, processing=0, succeeded=0, errored=0):
        self.processing, self.succeeded, self.errored = processing, succeeded, errored


class _Batch:
    def __init__(self, id, status):
        self.id = id
        self.processing_status = status
        self.request_counts = _Counts(processing=1, succeeded=1)


class _Result:
    def __init__(self, type, message=None, error_type=None):
        self.type = type
        self.message = message
        self.error = type == "errored" and _Err(error_type) or None


class _Err:
    def __init__(self, type):
        self.type = type


class _Item:
    def __init__(self, custom_id, type, message=None, error_type=None):
        self.custom_id = custom_id
        self.result = _Result(type, message, error_type)


class FakeBatches:
    def __init__(self, rounds, create_error=None):
        # rounds: list of {"statuses": [...], "results": [_Item, ...]}
        self._rounds = rounds
        self._round = -1
        self._create_error = create_error
        self.canceled = []
        self.create_calls = 0

    def create(self, requests):
        self.create_calls += 1
        if self._create_error:
            raise self._create_error
        self._round += 1
        self._statuses = list(self._rounds[self._round]["statuses"])
        self._results = self._rounds[self._round]["results"]
        return _Batch(f"batch_{self._round}", "in_progress")

    def retrieve(self, id):
        status = self._statuses.pop(0) if self._statuses else "ended"
        return _Batch(id, status)

    def cancel(self, id):
        self.canceled.append(id)

    def results(self, id):
        return iter(self._results)


class FakeClient:
    def __init__(self, batches):
        self.messages = type("M", (), {"batches": batches})()


def _items(params, spec):
    """Build result items with the same custom_ids the runner will generate."""
    _, id_map = build_batch_requests(params)
    cid_by_country = {country: cid for cid, country in id_map.items()}
    items = []
    for country, (kind, payload) in spec.items():
        cid = cid_by_country[country]
        if kind == "succeeded":
            items.append(_Item(cid, "succeeded", message=payload))
        elif kind == "errored":
            items.append(_Item(cid, "errored", error_type=payload))
        else:
            items.append(_Item(cid, kind))
    return items


def _runner(client, **kw):
    return BatchRunner(client, sleep=lambda s: None, **kw)


# -- BatchRunner ---------------------------------------------------------------


def test_classifies_succeeded_errored_and_canceled():
    params = {c: {} for c in ["A", "B", "C", "D"]}
    msg = object()
    spec = {
        "A": ("succeeded", msg),
        "B": ("errored", "invalid_request"),   # -> fatal
        "C": ("errored", "overloaded"),         # -> retryable
        "D": ("canceled", None),                # -> retryable
    }
    client = FakeClient(FakeBatches([{"statuses": ["ended"], "results": _items(params, spec)}]))
    messages, errors = _runner(client)._run_once(params)
    assert messages == {"A": msg}
    assert errors == {"B": "fatal", "C": "retryable", "D": "retryable"}


def test_timeout_cancels_and_salvages_partial_results():
    params = {"A": {}}
    msg = object()
    batches = FakeBatches([{"statuses": ["ended"], "results": _items(params, {"A": ("succeeded", msg)})}])
    client = FakeClient(batches)
    # max_wait=0 forces an immediate timeout on the first poll check.
    messages, errors = _runner(client, max_wait=0)._run_once(params)
    assert batches.canceled == ["batch_0"]
    assert messages == {"A": msg}  # already-billed success preserved, not discarded


def test_auth_error_on_submit_is_fatal(anthropic_errors):
    client = FakeClient(FakeBatches([], create_error=anthropic_errors["auth"]()))
    with pytest.raises(FatalAPIError):
        _runner(client)._run_once({"A": {}})


def test_research_retries_transient_failures_in_second_batch():
    params = {"A": {}, "B": {}}
    msg_a, msg_b = object(), object()
    rounds = [
        {  # first batch: A ok, B transiently canceled
            "statuses": ["ended"],
            "results": _items(params, {"A": ("succeeded", msg_a), "B": ("canceled", None)}),
        },
        {  # retry batch (just B): B succeeds
            "statuses": ["ended"],
            "results": _items({"B": {}}, {"B": ("succeeded", msg_b)}),
        },
    ]
    client = FakeClient(FakeBatches(rounds))
    messages, failed = _runner(client).research(params)
    assert messages == {"A": msg_a, "B": msg_b}
    assert failed == []


def test_fatal_batch_error_is_not_retried():
    # invalid_request classifies as fatal, so it is NOT resubmitted in a second
    # batch — it goes straight to the failed list.
    params = {"A": {}}
    batches = FakeBatches(
        [{"statuses": ["ended"], "results": _items(params, {"A": ("errored", "invalid_request")})}]
    )
    client = FakeClient(batches)
    messages, failed = _runner(client).research(params)
    assert messages == {}
    assert failed == ["A"]
    assert batches.create_calls == 1  # no retry batch submitted


def test_batch_that_never_terminates_classifies_all_retryable():
    # If a canceled batch never reaches a terminal state within the grace
    # window, results can't be read — everything is retryable, not lost.
    params = {"A": {}}
    batches = FakeBatches([{"statuses": ["canceling"], "results": []}])
    client = FakeClient(batches)
    # poll_interval == grace window so the drain loop runs exactly once.
    messages, errors = _runner(client, max_wait=0, poll_interval=300)._run_once(params)
    assert batches.canceled == ["batch_0"]
    assert messages == {}
    assert errors == {"A": "retryable"}
