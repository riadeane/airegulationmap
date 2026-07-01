import json

import pytest
from conftest import full_result, text_message
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.strategies import BatchStrategy, SyncStrategy

INVALID = {"bad": "data"}  # parses as JSON, fails schema validation


class StubResearchClient:
    """Stands in for ResearchClient for both strategies."""

    def __init__(self, results: dict):
        self.results = results  # country -> raw dict or None
        self.calls: list[tuple[str, bool]] = []

    def research(self, country, existing, *, use_search):
        self.calls.append((country, use_search))
        return self.results.get(country)

    def request_params(self, country, existing, *, use_search):
        return {"country": country, "use_search": use_search}


class StubRunner:
    def __init__(self, messages, failed):
        self._messages = messages
        self._failed = failed
        self.params = None

    def research(self, params):
        self.params = params
        return self._messages, self._failed


class TestSyncStrategy:
    def test_yields_validated_result_and_failure(self):
        client = StubResearchClient({"A": full_result(), "B": None})
        out = list(SyncStrategy(client, lambda c: False, sleep=lambda s: None).research(["A", "B"], {}))
        assert out[0][0] == "A"
        assert isinstance(out[0][1], ResearchResult)
        assert out[1] == ("B", None)

    def test_invalid_response_is_a_failure(self):
        client = StubResearchClient({"A": INVALID})
        out = list(SyncStrategy(client, lambda c: False, sleep=lambda s: None).research(["A"], {}))
        assert out == [("A", None)]

    def test_search_decider_is_applied(self):
        client = StubResearchClient({"A": full_result()})
        list(SyncStrategy(client, lambda c: c == "A", sleep=lambda s: None).research(["A"], {}))
        assert client.calls == [("A", True)]

    def test_aborts_after_consecutive_none_failures(self):
        client = StubResearchClient({})  # every country returns None
        strat = SyncStrategy(client, lambda c: False, sleep=lambda s: None, max_consecutive_failures=3)
        seen = list(_drain_until_fatal(strat.research(["A", "B", "C", "D"], {})))
        assert seen == [("A", None), ("B", None), ("C", None)]

    def test_aborts_after_consecutive_invalid_responses(self):
        # Regression: schema-valid-JSON-but-invalid responses must count toward
        # the circuit breaker, exactly as the old apply_result path did.
        client = StubResearchClient({c: INVALID for c in ["A", "B", "C", "D"]})
        strat = SyncStrategy(client, lambda c: False, sleep=lambda s: None, max_consecutive_failures=3)
        with pytest.raises(FatalAPIError):
            for _ in strat.research(["A", "B", "C", "D"], {}):
                pass

    def test_success_resets_consecutive_counter(self):
        client = StubResearchClient({"B": full_result()})  # only B succeeds
        strat = SyncStrategy(client, lambda c: False, sleep=lambda s: None, max_consecutive_failures=2)
        seen = list(_drain_until_fatal(strat.research(["A", "B", "C", "D"], {})))
        assert [c for c, _ in seen] == ["A", "B", "C", "D"]  # B resets, so no abort


class TestBatchStrategy:
    def test_parses_messages_and_marks_failed(self):
        client = StubResearchClient({})
        runner = StubRunner({"A": text_message(json.dumps(full_result()))}, ["B"])
        out = dict(BatchStrategy(client, runner, lambda c: False).research(["A", "B"], {}))
        assert isinstance(out["A"], ResearchResult)
        assert out["A"].confidence == "high"
        assert out["B"] is None
        assert set(runner.params) == {"A", "B"}

    def test_invalid_message_is_a_failure(self):
        client = StubResearchClient({})
        runner = StubRunner({"A": text_message("not json")}, [])
        out = dict(BatchStrategy(client, runner, lambda c: False).research(["A"], {}))
        assert out["A"] is None

    def test_search_decider_flows_into_request_params(self):
        client = StubResearchClient({})
        runner = StubRunner({}, ["A"])
        list(BatchStrategy(client, runner, lambda c: True).research(["A"], {}))
        assert runner.params["A"]["use_search"] is True


def _drain_until_fatal(gen):
    try:
        yield from gen
    except FatalAPIError:
        pass
