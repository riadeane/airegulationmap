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
        self.error = type == "errored" and _ErrorResponse(error_type) or None


class _ErrorResponse:
    """The SDK's shape: an ErrorResponse (type "error") wrapping the kind."""

    def __init__(self, kind):
        self.type = "error"
        self.error = type("ErrorObject", (), {"type": kind})()


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
        "B": ("errored", "invalid_request_error"),   # -> fatal
        "C": ("errored", "overloaded_error"),         # -> retryable
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
    # batch - it goes straight to the failed list.
    params = {"A": {}}
    batches = FakeBatches(
        [{"statuses": ["ended"], "results": _items(params, {"A": ("errored", "invalid_request_error")})}]
    )
    client = FakeClient(batches)
    messages, failed = _runner(client).research(params)
    assert messages == {}
    assert failed == ["A"]
    assert batches.create_calls == 1  # no retry batch submitted


def test_batch_that_never_terminates_fails_without_resubmitting():
    # If a canceled batch never reaches a terminal state within the grace
    # window, its results can't be read yet. Resubmitting would pay again for
    # requests that already succeeded, so those countries fail this run.
    params = {"A": {}}
    batches = FakeBatches([{"statuses": ["canceling"], "results": []}])
    client = FakeClient(batches)
    # poll_interval == grace window so the drain loop runs exactly once.
    runner = _runner(client, max_wait=0, poll_interval=600)
    messages, errors = runner._run_once(params)
    assert batches.canceled == ["batch_0"]
    assert messages == {}
    assert errors == {"A": "fatal"}


# -- transient API errors never lose a paid-for batch --------------------------


class FlakyBatches(FakeBatches):
    """Fails the first ``fail`` calls of the named method with a transient error."""

    def __init__(self, rounds, *, method, fail, error):
        super().__init__(rounds)
        self._method, self._fail, self._error = method, fail, error

    def _maybe_fail(self, name):
        if name == self._method and self._fail > 0:
            self._fail -= 1
            raise self._error

    def create(self, requests):
        self._maybe_fail("create")
        return super().create(requests)

    def retrieve(self, id):
        self._maybe_fail("retrieve")
        return super().retrieve(id)

    def results(self, id):
        self._maybe_fail("results")
        return super().results(id)


@pytest.mark.parametrize("method", ["create", "retrieve", "results"])
def test_a_transient_error_on_any_batch_call_is_retried(method, anthropic_errors):
    params = {"A": {}}
    msg = object()
    batches = FlakyBatches(
        [{"statuses": ["in_progress", "ended"], "results": _items(params, {"A": ("succeeded", msg)})}],
        method=method, fail=1, error=anthropic_errors["connection"](),
    )
    messages, failed = _runner(FakeClient(batches)).research(params)
    assert messages == {"A": msg}
    assert failed == []


def test_unreadable_results_fail_the_countries_without_raising(anthropic_errors):
    params = {"A": {}}
    batches = FlakyBatches(
        [{"statuses": ["ended"], "results": _items(params, {"A": ("succeeded", object())})}],
        method="results", fail=99, error=anthropic_errors["connection"](),
    )
    messages, failed = _runner(FakeClient(batches)).research(params)
    assert messages == {}
    assert failed == ["A"]
    assert batches.create_calls == 1  # not resubmitted: it was already paid for


# -- pause_turn continuations --------------------------------------------------


class _Msg:
    def __init__(self, stop_reason, content):
        self.stop_reason = stop_reason
        self.content = content


class RecordingBatches(FakeBatches):
    def __init__(self, rounds):
        super().__init__(rounds)
        self.submitted: list[list[dict]] = []

    def create(self, requests):
        self.submitted.append(requests)
        return super().create(requests)


def test_paused_results_are_continued_in_a_follow_up_batch():
    user = [{"role": "user", "content": "prompt"}]
    params = {"A": {"model": "m", "messages": user}, "B": {"model": "m", "messages": user}}
    paused = _Msg("pause_turn", ["searching"])
    done_a, done_b = _Msg("end_turn", ["a"]), _Msg("end_turn", ["b"])
    batches = RecordingBatches([
        {"statuses": ["ended"], "results": _items(params, {"A": ("succeeded", paused), "B": ("succeeded", done_b)})},
        {"statuses": ["ended"], "results": _items({"A": {}}, {"A": ("succeeded", done_a)})},
    ])
    messages, failed = _runner(FakeClient(batches)).research(params)
    assert messages == {"A": done_a, "B": done_b}
    assert failed == []
    # The continuation re-sends the prompt plus the paused turn, nothing else.
    [follow_up] = batches.submitted[1]
    assert follow_up["params"]["model"] == "m"
    assert follow_up["params"]["messages"] == user + [{"role": "assistant", "content": ["searching"]}]
    assert params["A"]["messages"] == user  # the original params are untouched


def test_continuations_stop_at_the_round_cap():
    from regulation_pipeline.batch import MAX_CONTINUATION_ROUNDS

    params = {"A": {"messages": [{"role": "user", "content": "p"}]}}
    # Each round's result is a new Message, as the Batches API returns.
    rounds = [
        {"statuses": ["ended"], "results": _items({"A": {}}, {"A": ("succeeded", _Msg("pause_turn", ["x"]))})}
        for _ in range(MAX_CONTINUATION_ROUNDS + 1)
    ]
    batches = RecordingBatches(rounds)
    messages, _ = _runner(FakeClient(batches)).research(params)
    assert batches.create_calls == MAX_CONTINUATION_ROUNDS + 1
    assert len(batches.submitted[-1][0]["params"]["messages"]) == 1 + MAX_CONTINUATION_ROUNDS
    assert messages["A"].stop_reason == "pause_turn"  # the parser rejects it


def test_the_wait_budget_is_shared_across_batches():
    # The first batch uses up the budget, so no follow-up batch is submitted:
    # the job's timeout must cover every batch of the run together.
    params = {"A": {}, "B": {}}
    msg = object()
    batches = FakeBatches([
        {"statuses": ["in_progress"] * 3 + ["ended"],
         "results": _items(params, {"A": ("succeeded", msg), "B": ("canceled", None)})},
    ])
    runner = _runner(FakeClient(batches), max_wait=3 * 600, poll_interval=600)
    messages, failed = runner.research(params)
    assert messages == {"A": msg}
    assert failed == ["B"]
    assert batches.create_calls == 1


def test_a_failed_continuation_is_retried_without_duplicating_the_turn():
    user = [{"role": "user", "content": "q"}]
    params = {"A": {"messages": user}}
    paused = _Msg("pause_turn", ["c1"])
    done = _Msg("end_turn", ["answer"])
    batches = RecordingBatches([
        {"statuses": ["ended"], "results": _items({"A": {}}, {"A": ("succeeded", paused)})},
        {"statuses": ["ended"], "results": _items({"A": {}}, {"A": ("errored", "overloaded_error")})},
        {"statuses": ["ended"], "results": _items({"A": {}}, {"A": ("succeeded", done)})},
    ])
    messages, failed = _runner(FakeClient(batches)).research(params)
    assert messages == {"A": done}
    assert failed == []
    for submitted in batches.submitted[1:]:
        assert submitted[0]["params"]["messages"] == user + [{"role": "assistant", "content": ["c1"]}]


def test_an_interrupted_results_download_is_retried():
    import httpx

    params = {"A": {}}
    msg = object()

    class Dropping(FakeBatches):
        drops = 1

        def results(self, id):
            if self.drops:
                self.drops -= 1

                def broken():
                    yield from ()
                    raise httpx.ReadError("connection reset")
                return broken()
            return super().results(id)

    batches = Dropping([{"statuses": ["ended"], "results": _items(params, {"A": ("succeeded", msg)})}])
    messages, failed = _runner(FakeClient(batches)).research(params)
    assert messages == {"A": msg}
    assert failed == []
