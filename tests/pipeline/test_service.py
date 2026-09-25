import csv
import json
from datetime import date

from conftest import full_result, sub, text_message
from regulation_pipeline.api import ResearchClient
from regulation_pipeline.config import Settings
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.models import ResearchProvenance, ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy
from regulation_pipeline.strategies import SyncStrategy

TODAY = date(2026, 6, 11)


def model():
    return ResearchResult.model_validate(full_result())


class ListStrategy:
    """Yields a fixed list of validated answers, optionally raising fatal."""

    def __init__(self, answers, raise_fatal=False):
        self._answers = answers
        self._raise_fatal = raise_fatal

    def research(self, countries, reg_rows):
        yield from self._answers
        if self._raise_fatal:
            raise FatalAPIError("boom")


def _service(tmp_path, run_id=None):
    ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
    return PipelineService(ds, StalenessPolicy(90, TODAY), TODAY, run_id=run_id), ds


def _saved_subscores(tmp_path) -> dict:
    path = tmp_path / "public" / "data" / "subscores.json"
    return json.loads(path.read_text(encoding="utf-8"))["countries"]


class _FakeAnthropic:
    """Stands in for ``anthropic.Anthropic``: every request gets the same
    valid answer, and the sent kwargs are kept."""

    def __init__(self):
        self.messages = self
        self.sent: list[dict] = []

    def create(self, **kwargs):
        self.sent.append(kwargs)
        return text_message(json.dumps(full_result()))


GROUNDED = ResearchProvenance(initiatives_used=7, search=True, model="claude-test")
PLAIN = ResearchProvenance(initiatives_used=None, search=True, model="claude-test")


def _saved_countries(tmp_path):
    path = tmp_path / "public" / "scores.csv"
    if not path.exists():
        return None  # file not written at all
    with path.open(newline="") as f:
        return {r["Country"] for r in csv.DictReader(f)}


class TestRun:
    def test_applies_valid_and_skips_failures(self, tmp_path):
        svc, ds = _service(tmp_path)
        result = svc.run(ListStrategy([("A", model()), ("B", None)]), ["A", "B"])
        assert result.updated == 1
        assert result.failed == ["B"]
        assert result.fatal is False
        assert ds.scores_row("A") is not None
        assert _saved_countries(tmp_path) == {"A"}

    def test_isolates_per_country_apply_error(self, tmp_path):
        # A non-result object slips through: apply() raises, but the run must
        # isolate it and keep going rather than abort.
        svc, ds = _service(tmp_path)
        result = svc.run(ListStrategy([("A", model()), ("C", object())]), ["A", "C"])
        assert result.updated == 1
        assert result.failed == ["C"]
        assert result.fatal is False
        assert _saved_countries(tmp_path) == {"A"}

    def test_fatal_saves_partial_progress(self, tmp_path):
        svc, _ = _service(tmp_path)
        result = svc.run(ListStrategy([("A", model())], raise_fatal=True), ["A"])
        assert result.fatal is True
        assert result.updated == 1
        assert _saved_countries(tmp_path) == {"A"}  # partial data persisted

    def test_all_failures_still_writes_unchanged_data(self, tmp_path):
        # Mirrors the old behavior: the run always writes at the end, even with
        # zero updates. With an empty dataset that means a header-only CSV.
        svc, _ = _service(tmp_path)
        result = svc.run(ListStrategy([("A", None), ("B", None)]), ["A", "B"])
        assert result.updated == 0
        assert result.failed == ["A", "B"]
        assert _saved_countries(tmp_path) == set()  # file written, no rows


class TestEvidenceRecord:
    """PRD 14: every applied result records how it was researched."""

    def test_grounded_and_plain_results_are_recorded_with_the_run_id(self, tmp_path):
        svc, _ = _service(tmp_path, run_id="run-1")
        no_records = ResearchProvenance(initiatives_used=0, search=False, model="claude-test")
        answers = [
            ("A", model().with_provenance(GROUNDED)),
            ("B", model().with_provenance(PLAIN)),
            ("C", model().with_provenance(no_records)),
        ]
        result = svc.run(ListStrategy(answers), ["A", "B", "C"])
        assert result.run_id == "run-1"

        saved = _saved_subscores(tmp_path)
        assert saved["A"]["evidence"] == {
            "grounded": True, "initiatives_used": 7, "search": True,
            "model": "claude-test", "run_id": "run-1",
        }
        assert saved["B"]["evidence"] == {
            "grounded": False, "initiatives_used": None, "search": True,
            "model": "claude-test", "run_id": "run-1",
        }
        assert saved["C"]["evidence"] == {
            "grounded": False, "initiatives_used": 0, "search": False,
            "model": "claude-test", "run_id": "run-1",
        }
        # The record sits beside the sub-scores, which still land.
        assert saved["A"]["regulation_status"]["binding_force"] == {"score": 4, "rationale": "Fact."}

    def test_held_result_updates_evidence_but_not_subscores(self, tmp_path):
        first, _ = _service(tmp_path, run_id="run-1")
        first.run(ListStrategy([("A", model().with_provenance(PLAIN))]), ["A"])

        # Same sources and laws, different scores: the gate holds it.
        moved = full_result(regulation_status={
            "binding_force": sub(1), "scope": sub(1), "implementation": sub(1),
            "ai_specificity": sub(1), "text": "Justification.",
        })
        held = ResearchResult.model_validate(moved).with_provenance(GROUNDED)
        second, _ = _service(tmp_path, run_id="run-2")
        result = second.run(ListStrategy([("A", held)]), ["A"])
        assert result.gate.counts.get("held") == 1

        entry = _saved_subscores(tmp_path)["A"]
        assert entry["regulation_status"]["binding_force"]["score"] == 4   # unchanged
        assert entry["evidence"] == {
            "grounded": True, "initiatives_used": 7, "search": True,
            "model": "claude-test", "run_id": "run-2",
        }

    def test_end_to_end_grounded_and_plain_prompts(self, tmp_path):
        # The real client and strategy: the count comes from the prompt the
        # client rendered, the search flag from the strategy's decider.
        api = _FakeAnthropic()
        evidence = {"A": [{"name": f"I{i}", "start_year": 2020 + i} for i in range(3)]}
        client = ResearchClient(
            api, model="claude-test", today=TODAY,
            evidence_provider=lambda country: evidence.get(country, []),
        )
        svc, _ = _service(tmp_path, run_id="run-1")
        svc.run(SyncStrategy(client, lambda c: c == "A", sleep=lambda s: None), ["A", "B"])

        saved = _saved_subscores(tmp_path)
        assert saved["A"]["evidence"] == {
            "grounded": True, "initiatives_used": 3, "search": True,
            "model": "claude-test", "run_id": "run-1",
        }
        assert saved["B"]["evidence"] == {
            "grounded": False, "initiatives_used": 0, "search": False,
            "model": "claude-test", "run_id": "run-1",
        }
        assert "(3 shown" in api.sent[0]["messages"][0]["content"]
        assert "VERIFIED POLICY INITIATIVES" not in api.sent[1]["messages"][0]["content"]

    def test_end_to_end_without_an_evidence_provider(self, tmp_path):
        client = ResearchClient(_FakeAnthropic(), model="claude-test", today=TODAY)
        svc, _ = _service(tmp_path, run_id="run-1")
        svc.run(SyncStrategy(client, lambda c: True, sleep=lambda s: None), ["A"])
        assert _saved_subscores(tmp_path)["A"]["evidence"] == {
            "grounded": False, "initiatives_used": None, "search": True,
            "model": "claude-test", "run_id": "run-1",
        }

    def test_result_without_provenance_records_no_evidence(self, tmp_path):
        first, _ = _service(tmp_path, run_id="run-1")
        first.run(ListStrategy([("A", model().with_provenance(GROUNDED)), ("B", model())]), ["A", "B"])
        saved = _saved_subscores(tmp_path)
        assert "evidence" in saved["A"]
        assert "evidence" not in saved["B"]

        # A later pass without provenance leaves no stale record behind.
        second, _ = _service(tmp_path, run_id="run-2")
        second.run(ListStrategy([("A", model())]), ["A"])
        assert "evidence" not in _saved_subscores(tmp_path)["A"]


class TestSelect:
    def test_filters_by_staleness(self, tmp_path):
        svc, ds = _service(tmp_path)
        ds._scores["Fresh"] = {"Country": "Fresh", "Last Updated": "2026-06-10", "Data Version": "1"}
        ds._regulation["Fresh"] = {"Country": "Fresh", "Regulation Status": "x", "Confidence": "high"}
        ds._scores["Stale"] = {"Country": "Stale", "Last Updated": "2020-01-01", "Data Version": "1"}
        ds._regulation["Stale"] = {"Country": "Stale", "Regulation Status": "x", "Confidence": "high"}
        _, to_update = svc.select(None, force=False)
        assert "Stale" in to_update
        assert "Fresh" not in to_update

    def test_explicit_targets_with_force(self, tmp_path):
        svc, _ = _service(tmp_path)
        all_targets, to_update = svc.select(["A", "B"], force=True)
        assert all_targets == ["A", "B"]
        assert to_update == ["A", "B"]
