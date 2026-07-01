import json

import pytest
from conftest import full_result, text_message
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.strategies import BatchStrategy, SyncStrategy


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
    def test_yields_success_and_failure(self):
        result = full_result()
        client = StubResearchClient({"A": result, "B": None})
        strat = SyncStrategy(client, lambda c: False, sleep=lambda s: None)
        assert list(strat.research(["A", "B"], {})) == [("A", result), ("B", None)]

    def test_search_decider_is_applied(self):
        client = StubResearchClient({"A": full_result()})
        strat = SyncStrategy(client, lambda c: c == "A", sleep=lambda s: None)
        list(strat.research(["A"], {}))
        assert client.calls == [("A", True)]

    def test_aborts_after_consecutive_failures(self):
        client = StubResearchClient({})  # every country returns None
        strat = SyncStrategy(client, lambda c: False, sleep=lambda s: None, max_consecutive_failures=3)
        seen = []
        with pytest.raises(FatalAPIError):
            for item in strat.research(["A", "B", "C", "D"], {}):
                seen.append(item)
        assert seen == [("A", None), ("B", None), ("C", None)]

    def test_success_resets_consecutive_counter(self):
        client = StubResearchClient({"B": full_result()})  # only B succeeds
        strat = SyncStrategy(client, lambda c: False, sleep=lambda s: None, max_consecutive_failures=2)
        # A fail, B success (reset), C fail, D fail -> fatal only on 2nd straight fail
        seen = list(_drain_until_fatal(strat.research(["A", "B", "C", "D"], {})))
        assert [c for c, _ in seen] == ["A", "B", "C", "D"]


class TestBatchStrategy:
    def test_parses_messages_and_marks_failed(self):
        client = StubResearchClient({})
        runner = StubRunner({"A": text_message(json.dumps(full_result()))}, ["B"])
        strat = BatchStrategy(client, runner, lambda c: False)
        out = dict(strat.research(["A", "B"], {}))
        assert out["A"]["confidence"] == "high"
        assert out["B"] is None
        assert set(runner.params) == {"A", "B"}

    def test_search_decider_flows_into_request_params(self):
        client = StubResearchClient({})
        runner = StubRunner({}, ["A"])
        strat = BatchStrategy(client, runner, lambda c: True)
        list(strat.research(["A"], {}))
        assert runner.params["A"]["use_search"] is True


def _drain_until_fatal(gen):
    try:
        yield from gen
    except FatalAPIError:
        pass
