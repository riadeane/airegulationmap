"""Regression tests for the pipeline hardening pass.

Covers the behaviors added in the senior-review fixes: validate-time
confidence capping, the sync wall-clock budget, injectable batch grace,
settings-root validation, alias-map immutability, durable/atomic writes, and
numeric normalization of Data Version on load.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from conftest import full_result
from regulation_pipeline.batch import CANCEL_GRACE_SECONDS, BatchRunner
from regulation_pipeline.config import Settings
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset, _write_text
from regulation_pipeline.strategies import SyncStrategy

TODAY = date(2026, 6, 11)


class StubResearchClient:
    def __init__(self, results: dict):
        self.results = results

    def research(self, country, existing, *, use_search):
        return self.results.get(country)

    def request_params(self, country, existing, *, use_search):
        return {"country": country}


class TestConfidenceValidator:
    def test_field_downgraded_at_validation_time(self):
        # The rule is now enforced in the model, not only on write: the
        # confidence FIELD itself is capped, so the in-memory object never
        # advertises a confidence its (missing) sources can't support.
        model = ResearchResult.model_validate(full_result(sources="", confidence="high"))
        assert model.confidence == "low"
        assert model.effective_confidence() == "low"

    def test_whitespace_only_sources_downgrade(self):
        model = ResearchResult.model_validate(full_result(sources="   \n ", confidence="medium"))
        assert model.confidence == "low"

    def test_sourced_confidence_preserved(self):
        model = ResearchResult.model_validate(full_result(confidence="high"))
        assert model.confidence == "high"


class TestSyncWallClock:
    def test_aborts_when_budget_exceeded(self):
        # Fake monotonic clock: start=0, first country at 10s (under the 60s
        # budget), second country's pre-check at 100s (over budget → abort).
        ticks = iter([0.0, 10.0, 100.0])
        client = StubResearchClient({"A": full_result(), "B": full_result()})
        strat = SyncStrategy(
            client, lambda c: False, sleep=lambda s: None,
            max_wall_seconds=60, clock=lambda: next(ticks),
        )
        gen = strat.research(["A", "B"], {})
        assert gen.__next__()[0] == "A"      # first country under budget
        with pytest.raises(FatalAPIError):
            gen.__next__()                    # second: clock now past budget

    def test_unbounded_by_default(self):
        client = StubResearchClient({"A": full_result()})
        out = list(SyncStrategy(client, lambda c: False, sleep=lambda s: None).research(["A"], {}))
        assert isinstance(out[0][1], ResearchResult)


class TestBatchGraceInjectable:
    def test_defaults_to_module_constant(self):
        runner = BatchRunner(client=object(), sleep=lambda s: None)
        assert runner._cancel_grace_seconds == CANCEL_GRACE_SECONDS

    def test_override_is_respected(self):
        runner = BatchRunner(client=object(), cancel_grace_seconds=42, sleep=lambda s: None)
        assert runner._cancel_grace_seconds == 42


class TestSettingsValidation:
    def test_valid_root_returns_self(self, tmp_path):
        assert Settings(root=tmp_path).validate().root == tmp_path

    def test_missing_root_raises(self, tmp_path):
        with pytest.raises(NotADirectoryError):
            Settings(root=tmp_path / "does-not-exist").validate()

    def test_file_root_raises(self, tmp_path):
        f = tmp_path / "afile"
        f.write_text("x")
        with pytest.raises(NotADirectoryError):
            Settings(root=f).validate()


class TestNamesImmutable:
    def test_mutating_source_dict_does_not_leak(self):
        src = {"Czech Republic": "Czechia"}
        names = CountryNames(src)
        src["Czech Republic"] = "WRONG"        # mutate the caller's dict
        src["Germany"] = "Deutschland"
        assert names.canonical("Czech Republic") == "Czechia"
        assert names.canonical("Germany") == "Germany"

    def test_internal_table_is_read_only(self):
        names = CountryNames({"a": "b"})
        with pytest.raises(TypeError):
            names._aliases["a"] = "c"          # MappingProxyType rejects writes


class TestDurableWrite:
    def test_atomic_write_roundtrips_and_leaves_no_tmp(self, tmp_path):
        target = tmp_path / "out.csv"
        _write_text(target, "hello,world\n")
        assert target.read_text(encoding="utf-8") == "hello,world\n"
        assert not (tmp_path / "out.csv.tmp").exists()

    def test_data_version_loaded_as_int(self, tmp_path):
        scores = tmp_path / "public" / "scores.csv"
        scores.parent.mkdir(parents=True)
        header = ",".join([
            "Country", "Regulation Status", "Policy Lever", "Governance Type",
            "Actor Involvement", "Average Score", "Enforcement Level",
            "Last Updated", "Data Version",
        ])
        scores.write_text(f"{header}\nGermany,4,3,2,3,3.67,4,2026-06-11,3\n", encoding="utf-8")
        ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
        assert ds.scores_row("Germany")["Data Version"] == 3
        assert isinstance(ds.scores_row("Germany")["Data Version"], int)
