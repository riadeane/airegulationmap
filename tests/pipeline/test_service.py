import csv
from datetime import date

from conftest import full_result
from regulation_pipeline.config import Settings
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy

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


def _service(tmp_path):
    ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
    return PipelineService(ds, StalenessPolicy(90, TODAY), TODAY), ds


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
