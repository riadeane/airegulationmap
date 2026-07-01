import csv
from datetime import date

from conftest import full_result
from regulation_pipeline.config import Settings
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy

TODAY = date(2026, 6, 11)


class ListStrategy:
    """Yields a fixed list of answers, optionally raising fatal at the end."""

    def __init__(self, answers, raise_fatal=False):
        self._answers = answers
        self._raise_fatal = raise_fatal

    def research(self, countries, reg_rows):
        yield from self._answers
        if self._raise_fatal:
            raise FatalAPIError("boom")


def _service(tmp_path):
    ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
    return PipelineService(ds, StalenessPolicy(90, TODAY), TODAY), ds


def _saved_countries(tmp_path):
    path = tmp_path / "public" / "scores.csv"
    if not path.exists():
        return set()
    with path.open(newline="") as f:
        return {r["Country"] for r in csv.DictReader(f)}


class TestRun:
    def test_applies_valid_and_isolates_invalid(self, tmp_path):
        svc, ds = _service(tmp_path)
        strat = ListStrategy([("A", full_result()), ("B", None), ("C", {"bad": "data"})])
        result = svc.run(strat, ["A", "B", "C"])
        assert result.updated == 1
        assert result.failed == ["B", "C"]
        assert result.fatal is False
        assert ds.scores_row("A") is not None
        assert ds.scores_row("C") is None  # invalid never written
        assert _saved_countries(tmp_path) == {"A"}

    def test_fatal_saves_partial_progress(self, tmp_path):
        svc, _ = _service(tmp_path)
        strat = ListStrategy([("A", full_result())], raise_fatal=True)
        result = svc.run(strat, ["A"])
        assert result.fatal is True
        assert result.updated == 1
        assert _saved_countries(tmp_path) == {"A"}  # partial data persisted

    def test_all_failures_produce_no_data_file_writes_are_still_valid(self, tmp_path):
        svc, _ = _service(tmp_path)
        result = svc.run(ListStrategy([("A", None), ("B", None)]), ["A", "B"])
        assert result.updated == 0
        assert result.failed == ["A", "B"]


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
