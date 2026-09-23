"""The gold set and the drift check (gold.py): the file's shape, the pure
metrics, the drift record, the run summary, the service seam that keeps the
raw results, the post-run check on a fake run, the mirror row, and the
model-comparison CLI on a fake strategy."""

from __future__ import annotations

import csv
import json
from datetime import date
from pathlib import Path

import pytest
import typer
from conftest import full_result, sub
from regulation_pipeline import cli, gold
from regulation_pipeline.config import Settings
from regulation_pipeline.gold import (
    GoldSetError,
    append_drift_row,
    check_run,
    compare,
    drift_row,
    load_gold_set,
    markdown_summary,
    parse_gold_set,
    research_gold,
    summary_line,
    text_report,
)
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService, RunResult
from regulation_pipeline.staleness import StalenessPolicy
from typer.testing import CliRunner

REPO = Path(__file__).resolve().parents[2]
TODAY = date(2026, 9, 21)

# conftest.full_result scores, per dimension, in sub-indicator order:
#   regulation 4,3,4,5  policy 3,3,2,4  governance 2,3,1,2  actor 4,2,3,3  enforcement 5,4,4,3
BASE = {
    "regulation_status": {"binding_force": 4, "scope": 3, "implementation": 4, "ai_specificity": 5},
    "policy_lever": {"binding_instruments": 3, "soft_law": 3, "economic_tools": 2, "institutional_capacity": 4},
    "governance_type": {"regulator_plurality": 2, "formal_coordination": 3, "subnational_role": 1, "nongovernmental_checks": 2},
    "actor_involvement": {"industry": 4, "civil_society": 2, "academia": 3, "international": 3},
    "enforcement_level": {"sanctions_framework": 5, "actions_taken": 4, "dedicated_authority": 4, "monitoring_practice": 3},
}
JUSTIFICATION = {dim: "Because." for dim in BASE}


def gold_entry(country: str, scores: dict | None = None, **overrides) -> dict:
    entry = {
        "country": country,
        "status": "draft",
        "verified_on": None,
        "drafted_on": "2026-09-23",
        "subscores": scores or json.loads(json.dumps(BASE)),
        "justification": dict(JUSTIFICATION),
        "sources": ["https://example.gov/ai"],
    }
    entry.update(overrides)
    return entry


def gold_set(*entries: dict):
    return parse_gold_set({"schema_version": 1, "countries": list(entries)})


def result(**overrides) -> ResearchResult:
    return ResearchResult.model_validate(full_result(**overrides))


def shifted(dimension: str, **subs: int) -> ResearchResult:
    """The baseline result with some sub-indicators of one dimension moved."""
    block = dict(full_result()[dimension])
    for name, score in subs.items():
        block[name] = sub(score)
    return result(**{dimension: block})


# -- the gold file -----------------------------------------------------------------


class TestGoldFile:
    def test_committed_gold_set_loads_with_ten_dataset_countries(self):
        settings = Settings(root=REPO)
        gold_set_ = load_gold_set(settings.gold_set_json)
        assert len(gold_set_) == 10
        with settings.scores_csv.open(newline="", encoding="utf-8") as f:
            dataset = {row["Country"] for row in csv.DictReader(f)}
        for entry in gold_set_.countries:
            assert entry.country in dataset, entry.country
            assert entry.status in gold.STATUSES
            assert sum(len(v) for v in entry.subscores.values()) == 20
            assert entry.sources
            assert set(entry.justification) == set(gold.SUBINDICATORS)
        # The file states the maturity range it covers: a top and a floor.
        means = {
            e.country: sum(e.subscores["regulation_status"].values()) / 4
            for e in gold_set_.countries
        }
        assert max(means.values()) >= 4 and min(means.values()) == 1

    def test_committed_gold_set_copy_is_plain_prose(self):
        text = (REPO / "public" / "data" / "gold_set.json").read_text(encoding="utf-8")
        assert "—" not in text  # no em dashes in copy

    def test_parse_rejects_bad_shapes(self):
        with pytest.raises(GoldSetError, match="status"):
            gold_set(gold_entry("A", status="checked"))
        with pytest.raises(GoldSetError, match="verified_on"):
            gold_set(gold_entry("A", status="verified"))
        missing = json.loads(json.dumps(BASE))
        del missing["policy_lever"]["soft_law"]
        with pytest.raises(GoldSetError, match="policy_lever"):
            gold_set(gold_entry("A", missing))
        out_of_range = json.loads(json.dumps(BASE))
        out_of_range["actor_involvement"]["industry"] = 6
        with pytest.raises(GoldSetError, match="actor_involvement.industry"):
            gold_set(gold_entry("A", out_of_range))
        boolean = json.loads(json.dumps(BASE))
        boolean["actor_involvement"]["industry"] = True
        with pytest.raises(GoldSetError, match="integer"):
            gold_set(gold_entry("A", boolean))
        with pytest.raises(GoldSetError, match="justification"):
            gold_set(gold_entry("A", justification={"regulation_status": "x"}))
        with pytest.raises(GoldSetError, match="sources"):
            gold_set(gold_entry("A", sources=[]))
        with pytest.raises(GoldSetError, match="duplicate"):
            gold_set(gold_entry("A"), gold_entry("A"))
        with pytest.raises(GoldSetError, match="no countries"):
            parse_gold_set({"countries": []})

    def test_verified_entry_needs_a_date_and_keeps_it(self):
        gs = gold_set(gold_entry("A", status="verified", verified_on="2026-10-01"))
        assert gs.verified() == ["A"]
        assert gs.countries[0].verified_on == "2026-10-01"

    def test_load_reports_unreadable_file(self, tmp_path):
        with pytest.raises(GoldSetError, match="cannot read"):
            load_gold_set(tmp_path / "missing.json")


# -- the pure metrics ---------------------------------------------------------------


class TestCompare:
    def test_identical_results_score_zero_error(self):
        metrics = compare(gold_set(gold_entry("A"), gold_entry("B")), {"A": result(), "B": result()})
        assert metrics.compared == ("A", "B")
        assert metrics.missing == ()
        assert metrics.count == 40
        assert metrics.mae_by_dimension == dict.fromkeys(gold.DIMENSIONS, 0.0)
        assert metrics.within_one == 1.0
        assert metrics.max_dev is not None and metrics.max_dev.delta == 0
        assert metrics.warning is False

    def test_expected_metrics_on_a_fake_run(self):
        # A: regulation_status.scope 3 -> 5 (delta 2) and binding_force 4 -> 3 (delta 1).
        # B: enforcement_level.actions_taken 4 -> 1 (delta 3).
        results = {
            "A": shifted("regulation_status", scope=5, binding_force=3),
            "B": shifted("enforcement_level", actions_taken=1),
        }
        metrics = compare(gold_set(gold_entry("A"), gold_entry("B")), results)
        # regulation_status: 8 sub-indicators over two countries, deltas 2 + 1.
        assert metrics.mae_by_dimension["regulation_status"] == round(3 / 8, 3)
        assert metrics.mae_by_dimension["enforcement_level"] == round(3 / 8, 3)
        assert metrics.mae_by_dimension["policy_lever"] == 0.0
        # 40 compared, two beyond one point (A scope, B actions_taken).
        assert metrics.within_one == round(38 / 40, 3)
        assert metrics.max_dev.country == "B"
        assert metrics.max_dev.dimension == "enforcement_level"
        assert metrics.max_dev.subindicator == "actions_taken"
        assert (metrics.max_dev.gold, metrics.max_dev.run, metrics.max_dev.delta) == (4, 1, 3)

    def test_ties_on_max_dev_resolve_in_gold_order(self):
        results = {
            "A": shifted("policy_lever", economic_tools=4),  # 2 -> 4
            "B": shifted("policy_lever", soft_law=5),  # 3 -> 5
        }
        metrics = compare(gold_set(gold_entry("B"), gold_entry("A")), results)
        assert metrics.max_dev.country == "B"

    def test_missing_countries_are_listed_not_counted(self):
        metrics = compare(gold_set(gold_entry("A"), gold_entry("B")), {"B": result()})
        assert metrics.compared == ("B",)
        assert metrics.missing == ("A",)
        assert metrics.count == 20

    def test_no_overlap_gives_empty_metrics(self):
        metrics = compare(gold_set(gold_entry("A")), {"Z": result()})
        assert metrics.compared == ()
        assert metrics.missing == ("A",)
        assert metrics.mae_by_dimension == {}
        assert metrics.within_one == 0.0
        assert metrics.max_dev is None
        assert metrics.warning is False  # nothing compared is not a calibration warning

    def test_warning_below_threshold(self):
        # Every actor_involvement sub-indicator off by two: 4 of 20 beyond one
        # point -> within_one 0.8, on the threshold, no warning. Every
        # governance one too -> 8 of 20 -> 0.6, warning.
        actor = dict(full_result()["actor_involvement"], industry=sub(2), civil_society=sub(4),
                     academia=sub(5), international=sub(5))
        governance = dict(full_result()["governance_type"], regulator_plurality=sub(4),
                          formal_coordination=sub(5), subnational_role=sub(3),
                          nongovernmental_checks=sub(4))
        four_off = result(actor_involvement=actor)
        on_threshold = compare(gold_set(gold_entry("A")), {"A": four_off})
        assert on_threshold.within_one == 0.8 and on_threshold.warning is False
        eight_off = result(actor_involvement=actor, governance_type=governance)
        metrics = compare(gold_set(gold_entry("A")), {"A": eight_off})
        assert metrics.within_one == 0.6
        assert metrics.warning is True


# -- the drift record ---------------------------------------------------------------


class TestDrift:
    def test_row_shape(self):
        metrics = compare(gold_set(gold_entry("A")), {"A": shifted("policy_lever", soft_law=5)})
        row = drift_row(metrics, run_id="run-1", run_date=TODAY, model="claude-x", prompt_version="v3")
        assert row == {
            "run_id": "run-1",
            "date": "2026-09-21",
            "model": "claude-x",
            "prompt_version": "v3",
            "countries_compared": 1,
            "countries_missing": [],
            "mae_by_dimension": {
                "regulation_status": 0.0, "policy_lever": 0.5, "governance_type": 0.0,
                "actor_involvement": 0.0, "enforcement_level": 0.0,
            },
            "within_one": round(19 / 20, 3),
            "max_dev": 2,
            "max_dev_at": {
                "country": "A", "dimension": "policy_lever", "subindicator": "soft_law",
                "gold": 3, "run": 5,
            },
        }

    def test_append_creates_then_extends_the_file(self, tmp_path):
        path = tmp_path / "public" / "data" / "drift.json"
        metrics = compare(gold_set(gold_entry("A")), {"A": result()})
        first = drift_row(metrics, run_id="r1", run_date=TODAY, model="m", prompt_version="v")
        append_drift_row(path, first)
        document = json.loads(path.read_text())
        assert document["schema_version"] == gold.DRIFT_SCHEMA_VERSION
        assert [r["run_id"] for r in document["checks"]] == ["r1"]
        second = dict(first, run_id="r2")
        append_drift_row(path, second)
        document = json.loads(path.read_text())
        assert [r["run_id"] for r in document["checks"]] == ["r1", "r2"]
        assert not (path.parent / "drift.json.tmp").exists()


# -- reporting -------------------------------------------------------------------------


class TestSummary:
    def test_markdown_and_log_line_without_warning(self):
        gs = gold_set(gold_entry("A"), gold_entry("B", status="verified", verified_on="2026-10-01"))
        metrics = compare(gs, {"A": shifted("policy_lever", soft_law=5)})
        text = markdown_summary(metrics, gs)
        assert text.startswith("\n## Gold set\n")
        assert "Calibration warning" not in text
        assert "| Countries compared | 1 of 2 (1 verified, 1 draft) |" in text
        assert "| Within one point | 0.950 |" in text
        assert "| Largest deviation | 2 (A policy_lever.soft_law: gold 3, run 5) |" in text
        assert "| `policy_lever` | 0.50 |" in text
        assert "Missing from this run: B" in text
        line = summary_line(metrics, gs)
        assert line.startswith("gold: 1/2 countries, within_one=0.950, max_dev=2 (A policy_lever.soft_law")
        assert "policy_lever=0.50" in line

    def test_warning_prefixes_the_summary(self):
        gs = gold_set(gold_entry("A"))
        bad = ResearchResult.model_validate(full_result(
            actor_involvement={"industry": sub(1), "civil_society": sub(5), "academia": sub(1),
                               "international": sub(1), "text": "t"},
            governance_type={"regulator_plurality": sub(5), "formal_coordination": sub(5),
                             "subnational_role": sub(5), "nongovernmental_checks": sub(5), "text": "t"},
        ))
        metrics = compare(gs, {"A": bad})
        assert metrics.warning is True
        text = markdown_summary(metrics, gs)
        assert text.startswith("\n## Calibration warning: gold set\n")
        assert "threshold 80%" in text
        assert summary_line(metrics, gs).startswith("Calibration warning: gold: ")

    def test_nothing_compared_says_so(self):
        gs = gold_set(gold_entry("A"))
        metrics = compare(gs, {})
        assert "None of the 1 gold countries were in this run." in markdown_summary(metrics, gs)
        assert summary_line(metrics, gs) == "gold: none of the 1 gold countries in this run"

    def test_text_report_lists_large_deviations(self):
        gs = gold_set(gold_entry("A"), gold_entry("B"))
        results = {"A": shifted("enforcement_level", actions_taken=1)}
        report = text_report(compare(gs, results), gs, results)
        assert "Deviations of two points or more:" in report
        assert "  A: enforcement_level.actions_taken gold 4, run 1" in report
        assert "Missing: B" in report
        clean = text_report(compare(gs, {"A": result()}), gs, {"A": result()})
        assert "No deviation of two points or more." in clean


# -- the service seam and the post-run check ------------------------------------------


class ListStrategy:
    def __init__(self, answers):
        self._answers = answers

    def research(self, countries, reg_rows):
        yield from self._answers


def _service(root, **kwargs):
    ds = Dataset.load(Settings(root=root), CountryNames({}))
    return PipelineService(ds, StalenessPolicy(90, TODAY), TODAY, **kwargs), ds


class TestRunResultRawResults:
    def test_raw_results_keep_the_ungated_scores(self, tmp_path):
        svc, ds = _service(tmp_path)
        # Run 1 lands the baseline. Run 2 moves one sub-indicator with no new
        # evidence, so the gate holds it: the dataset keeps the old scores but
        # raw_results must carry the candidate the model returned.
        svc.run(ListStrategy([("A", result())]), ["A"])
        svc, ds = _service(tmp_path)
        moved = shifted("regulation_status", scope=5)
        run = svc.run(ListStrategy([("A", moved), ("B", None)]), ["A", "B"])
        assert run.gate.counts["held"] == 1
        assert float(ds.scores_row("A")["Regulation Status"]) == 4.0
        assert run.raw_results["A"].regulation_status.scope.score == 5
        assert "B" not in run.raw_results

    def test_non_result_objects_are_not_kept(self, tmp_path):
        svc, _ = _service(tmp_path)
        run = svc.run(ListStrategy([("A", result()), ("C", object())]), ["A", "C"])
        assert set(run.raw_results) == {"A"}


class FakeMirror:
    def __init__(self, fail: bool = False):
        self.rows: list[dict] = []
        self.fail = fail

    def record_gold_check(self, row: dict) -> None:
        if self.fail:
            raise RuntimeError("db down")
        self.rows.append(row)


def _write_gold(root: Path, *entries: dict) -> Settings:
    settings = Settings(root=root)
    settings.gold_set_json.parent.mkdir(parents=True, exist_ok=True)
    settings.gold_set_json.write_text(
        json.dumps({"schema_version": 1, "countries": list(entries)}), encoding="utf-8",
    )
    return settings


class TestCheckRun:
    def test_appends_a_row_and_mirrors_it(self, tmp_path):
        settings = _write_gold(tmp_path, gold_entry("A"), gold_entry("B"))
        run = RunResult(
            updated=2, failed=[], run_id="run-9",
            raw_results={"A": shifted("enforcement_level", actions_taken=1), "Z": result()},
        )
        mirror = FakeMirror()
        check = check_run(
            run, settings, model="claude-x", prompt_version="v3", run_date=TODAY, mirror=mirror,
        )
        assert check is not None
        assert check.metrics.compared == ("A",) and check.metrics.missing == ("B",)
        document = json.loads(settings.drift_json.read_text())
        [row] = document["checks"]
        assert row["run_id"] == "run-9" and row["model"] == "claude-x"
        assert row["countries_compared"] == 1 and row["countries_missing"] == ["B"]
        assert row["max_dev"] == 3
        assert row["mae_by_dimension"]["enforcement_level"] == 0.75
        assert mirror.rows == [row]

    def test_mirror_failure_keeps_the_file_row(self, tmp_path):
        settings = _write_gold(tmp_path, gold_entry("A"))
        run = RunResult(updated=1, failed=[], run_id="r", raw_results={"A": result()})
        check = check_run(
            run, settings, model="m", prompt_version="v", run_date=TODAY, mirror=FakeMirror(fail=True),
        )
        assert check is not None
        assert len(json.loads(settings.drift_json.read_text())["checks"]) == 1

    def test_no_gold_countries_in_run_records_nothing(self, tmp_path):
        settings = _write_gold(tmp_path, gold_entry("A"))
        run = RunResult(updated=1, failed=[], run_id="r", raw_results={"Z": result()})
        assert check_run(run, settings, model="m", prompt_version="v", run_date=TODAY) is None
        assert not settings.drift_json.exists()

    def test_missing_gold_file_is_skipped(self, tmp_path):
        settings = Settings(root=tmp_path)
        run = RunResult(updated=1, failed=[], run_id="r", raw_results={"A": result()})
        assert check_run(run, settings, model="m", prompt_version="v", run_date=TODAY) is None

    def test_malformed_gold_file_raises_for_the_cli_to_downgrade(self, tmp_path):
        settings = _write_gold(tmp_path, gold_entry("A", status="verified"))
        run = RunResult(updated=1, failed=[], run_id="r", raw_results={"A": result()})
        with pytest.raises(GoldSetError):
            check_run(run, settings, model="m", prompt_version="v", run_date=TODAY)

    def test_cli_wrapper_never_raises_and_writes_the_step_summary(self, tmp_path, monkeypatch):
        settings = _write_gold(tmp_path, gold_entry("A", status="verified"))  # malformed
        run = RunResult(updated=1, failed=[], run_id="r", raw_results={"A": result()})
        summary = tmp_path / "summary.md"
        monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
        cli._gold_check(run, settings, "m", "v", TODAY, None)  # must not raise
        assert not summary.exists()
        settings = _write_gold(tmp_path, gold_entry("A"))
        cli._gold_check(run, settings, "m", "v", TODAY, None)
        assert "## Gold set" in summary.read_text()


# -- the Supabase row ---------------------------------------------------------------------


class TestMirrorRow:
    def test_record_gold_check_posts_the_row(self):
        import httpx
        from regulation_pipeline.db.client import SupabaseClient
        from regulation_pipeline.db.mirror import RunMeta, SupabaseMirror

        posted: list[tuple[str, list]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            posted.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
            return httpx.Response(201, json=[])

        client = SupabaseClient("https://x.supabase.co", "key", transport=httpx.MockTransport(handler))
        mirror = SupabaseMirror(client, RunMeta(trigger="manual", model="m", strategy="sync", prompt_version="v"))
        metrics = compare(gold_set(gold_entry("A")), {"A": shifted("policy_lever", soft_law=5)})
        row = drift_row(metrics, run_id=mirror.run_id, run_date=TODAY, model="m", prompt_version="v")
        mirror.record_gold_check(row)
        [(table, [db_row])] = posted
        assert table == "gold_checks"
        assert db_row["run_id"] == mirror.run_id
        assert db_row["checked_on"] == "2026-09-21"
        assert db_row["within_one"] == row["within_one"]
        assert db_row["max_dev"] == 2
        assert db_row["max_dev_at"]["subindicator"] == "soft_law"
        assert db_row["mae_by_dimension"]["policy_lever"] == 0.5
        assert "date" not in db_row

    def test_migration_creates_the_table_with_public_read(self):
        sql = (REPO / "supabase" / "migrations" / "0007_gold_checks.sql").read_text(encoding="utf-8")
        assert "create table gold_checks" in sql
        for column in ("run_id", "checked_on", "mae_by_dimension", "within_one", "max_dev", "max_dev_at"):
            assert f"comment on column gold_checks.{column}" in sql
        assert "alter table gold_checks enable row level security" in sql
        assert 'create policy "public read" on gold_checks' in sql


# -- the model-comparison CLI ---------------------------------------------------------


class TestGoldCli:
    def test_research_gold_collects_valid_results_only(self):
        gs = gold_set(gold_entry("A"), gold_entry("B"))
        strategy = ListStrategy([("A", result()), ("B", None)])
        results = research_gold(strategy, gs, {"A": {}, "B": {}})
        assert set(results) == {"A"}

    def test_help_exits_0(self):
        app = typer.Typer()
        app.command()(gold._compare_cli)
        assert CliRunner().invoke(app, ["--help"]).exit_code == 0

    def test_missing_api_key_exits_1(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        app = typer.Typer()
        app.command()(gold._compare_cli)
        assert CliRunner().invoke(app, ["--model", "claude-x"]).exit_code == 1
