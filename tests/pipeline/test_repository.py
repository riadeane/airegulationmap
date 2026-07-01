import shutil
from datetime import date
from pathlib import Path

from conftest import full_result
from regulation_pipeline.config import REGULATION_FIELDS, SCORES_FIELDS, Settings
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset

REPO_ROOT = Path(__file__).resolve().parents[2]
TODAY = date(2026, 6, 11)


def empty_dataset(tmp_path) -> Dataset:
    settings = Settings(root=tmp_path)
    return Dataset.load(settings, CountryNames({}))


def result_model() -> ResearchResult:
    return ResearchResult.model_validate(full_result())


class TestApply:
    def test_scores_row(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), TODAY)
        row = ds.scores_row("Germany")
        assert set(row) == set(SCORES_FIELDS)
        assert row["Regulation Status"] == 4.0
        assert row["Enforcement Level"] == 4.0
        assert row["Average Score"] == 3.67
        assert row["Last Updated"] == "2026-06-11"
        assert row["Data Version"] == 2  # fresh country: 1 -> 2

    def test_data_version_increments_from_existing(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds._scores["Germany"] = {"Country": "Germany", "Data Version": "3"}
        ds.apply("Germany", result_model(), TODAY)
        assert ds.scores_row("Germany")["Data Version"] == 4

    def test_regulation_row(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), TODAY)
        row = ds.regulation_row("Germany")
        assert set(row) == set(REGULATION_FIELDS)
        assert row["Regulation Status"] == "Justification."
        assert row["Sources"].startswith("https://example.gov")
        assert row["Confidence"] == "high"

    def test_regulation_row_downgrades_confidence_without_sources(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("X", ResearchResult.model_validate(full_result(sources="", confidence="high")), TODAY)
        assert ds.regulation_row("X")["Confidence"] == "low"

    def test_subscores_entry(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), TODAY)
        entry = ds._subscores["countries"]["Germany"]
        assert entry["date"] == "2026-06-11"
        assert entry["regulation_status"]["ai_specificity"] == 5
        assert set(entry["actor_involvement"]) == {"industry", "civil_society", "academia", "international"}

    def test_history_snapshot_appended_with_average(self, tmp_path):
        ds = empty_dataset(tmp_path)
        outcome = ds.apply("Germany", result_model(), TODAY)
        assert outcome.history_added is True
        snap = ds._history["countries"]["Germany"][0]
        # averageScore is computed from the model, not a mutated shared dict.
        assert snap["averageScore"] == 3.67
        assert snap["regulationStatus"] == 4.0
        assert list(snap) == [
            "date", "regulationStatus", "policyLever", "governanceType",
            "actorInvolvement", "enforcementLevel", "averageScore",
        ]

    def test_unchanged_scores_do_not_append_second_snapshot(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), date(2026, 6, 1))
        outcome = ds.apply("Germany", result_model(), date(2026, 7, 1))
        assert outcome.history_added is False
        assert len(ds._history["countries"]["Germany"]) == 1
        assert ds._history["countries"]["Germany"][0]["date"] == "2026-07-01"


class TestValidate:
    def test_clean_dataset_has_no_errors(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), TODAY)
        assert ds.validate() == []

    def test_flags_out_of_range_score(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), TODAY)
        ds._scores["Germany"]["Enforcement Level"] = 9  # missed by the old validator
        errors = ds.validate()
        assert any("Enforcement Level" in e and "out of range" in e for e in errors)

    def test_flags_missing_column(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), TODAY)
        del ds._scores["Germany"]["Average Score"]
        assert any("columns off" in e for e in ds.validate())


class TestPersistence:
    def test_save_round_trip_is_byte_identical(self, tmp_path):
        # The strongest no-regression check: load the real data files and
        # rewrite them unchanged; every byte must match.
        for rel in [
            "public/scores.csv", "public/regulation_data.csv",
            "public/history.json", "public/data/subscores.json",
            "public/data/country_names.json",
        ]:
            dst = tmp_path / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO_ROOT / rel, dst)

        settings = Settings(root=tmp_path)
        names = CountryNames.load(settings.country_names_json)
        Dataset.load(settings, names).save()

        for rel in [
            "public/scores.csv", "public/regulation_data.csv",
            "public/history.json", "public/data/subscores.json",
        ]:
            assert (tmp_path / rel).read_bytes() == (REPO_ROOT / rel).read_bytes(), rel

    def test_save_is_atomic_and_leaves_no_temp_file(self, tmp_path):
        ds = empty_dataset(tmp_path)
        ds.apply("Germany", result_model(), TODAY)
        ds.save()
        assert (tmp_path / "public" / "scores.csv").exists()
        assert not list(tmp_path.glob("**/*.tmp"))
