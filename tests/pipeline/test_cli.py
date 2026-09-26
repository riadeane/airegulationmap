import importlib.util
from pathlib import Path

import typer
from regulation_pipeline import cli
from typer.testing import CliRunner

runner = CliRunner()


def _app() -> typer.Typer:
    app = typer.Typer()
    app.command()(cli._run)
    return app


def test_help_exits_0():
    assert runner.invoke(_app(), ["--help"]).exit_code == 0


def test_missing_api_key_exits_1(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert runner.invoke(_app(), ["--dry-run"]).exit_code == 1


def test_dry_run_exits_0(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    result = runner.invoke(_app(), ["--dry-run", "--force", "--countries", "Germany"])
    assert result.exit_code == 0


def test_shim_module_imports_and_exposes_main():
    # The update_data.py shim bootstraps sys.path and re-exports main; importing
    # it must not raise (the historical invocation path).
    path = Path(__file__).resolve().parents[2] / "scripts" / "update_data.py"
    spec = importlib.util.spec_from_file_location("update_data_shim", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert callable(module.main)


def test_digest_failure_never_changes_exit_code(monkeypatch, tmp_path):
    # A scheduled run writes the digest; a digest failure is a warning only.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setenv("GITHUB_EVENT_NAME", "schedule")
    monkeypatch.setattr(cli, "Settings", lambda **kw: _TmpSettings(tmp_path, **kw))

    def explode(*a, **k):
        raise RuntimeError("digest down")

    monkeypatch.setattr(cli, "write_run_digest", explode)
    # No countries in the temp dataset -> "Nothing to update" path, which
    # still writes the (empty) digest for scheduled runs.
    result = runner.invoke(_app(), ["--countries", ""])
    assert result.exit_code == 0


def test_no_changes_digest_written_when_nothing_to_update(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.delenv("GITHUB_EVENT_NAME", raising=False)
    monkeypatch.setattr(cli, "Settings", lambda **kw: _TmpSettings(tmp_path, **kw))
    result = runner.invoke(_app(), ["--digest"])
    assert result.exit_code == 0
    written = list((tmp_path / "public" / "digest").glob("????-W??.json"))
    assert len(written) == 1
    assert (tmp_path / "public" / "digest" / "feed.xml").exists()
    # Without --digest (and not scheduled) nothing is written.
    result = runner.invoke(_app(), [])
    assert result.exit_code == 0
    assert len(list((tmp_path / "public" / "digest").glob("????-W??.json"))) == 1


def _TmpSettings(root, **kw):
    """Settings rooted in an empty temp dir: no data files, so every run
    takes the "Nothing to update" path without touching the API."""
    from regulation_pipeline.config import Settings

    return Settings(root=root, **kw)


def _dataset_with(tmp_path, countries, breaks):
    """A temp dataset with the given countries (identical scores) and breaks."""
    import json

    from regulation_pipeline.config import Settings

    settings = Settings(root=tmp_path)
    settings.scores_csv.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "Country,Regulation Status,Policy Lever,Governance Type,Actor Involvement,"
        "Enforcement Level,Average Score,Last Updated,Data Version\n"
    )
    rows = "".join(f"{c},2,2,2,2,2,2,2026-09-01,1\n" for c in countries)
    settings.scores_csv.write_text(header + rows, encoding="utf-8")
    settings.history_json.write_text(
        json.dumps({"schema_version": 1, "countries": {}, "breaks": breaks}), encoding="utf-8",
    )
    return settings


def test_unknown_country_names_exit_before_any_research(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    _dataset_with(tmp_path, ["Germany", "France"], [])
    monkeypatch.setattr(cli, "Settings", lambda **kw: _TmpSettings(tmp_path, **kw))
    result = runner.invoke(_app(), ["--dry-run", "--countries", "germany, Germny"])
    assert result.exit_code == 1
    assert "Germny" in result.output
    assert "Germany" not in result.output.split("Unknown countries")[1].split(".")[0]


def test_country_names_resolve_case_insensitively(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    _dataset_with(tmp_path, ["Germany", "France"], [])
    monkeypatch.setattr(cli, "Settings", lambda **kw: _TmpSettings(tmp_path, **kw))
    result = runner.invoke(_app(), ["--dry-run", "--countries", "germany, FRANCE"])
    assert result.exit_code == 0
    assert "Countries to update: 2 / 2" in result.output


def test_first_full_run_on_a_new_rubric_records_a_break(monkeypatch, tmp_path):
    from regulation_pipeline.prompt import RUBRIC_VERSION

    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    june = {"date": "2026-06-13", "prompt_version": "v2-2026-06", "reason": "v2"}
    _dataset_with(tmp_path, ["Germany"], [june])
    monkeypatch.setattr(cli, "Settings", lambda **kw: _TmpSettings(tmp_path, **kw))
    result = runner.invoke(_app(), ["--dry-run"])
    assert result.exit_code == 0
    assert f"First full run on rubric {RUBRIC_VERSION}" in result.output
    assert "would record break: Switch to scoring rubric" in result.output


def test_a_partial_run_on_a_new_rubric_stays_gated(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    june = {"date": "2026-06-13", "prompt_version": "v2-2026-06", "reason": "v2"}
    _dataset_with(tmp_path, ["Germany", "France"], [june])
    monkeypatch.setattr(cli, "Settings", lambda **kw: _TmpSettings(tmp_path, **kw))
    result = runner.invoke(_app(), ["--dry-run", "--countries", "Germany"])
    assert result.exit_code == 0
    assert "stays gated" in result.output
    assert "would record break" not in result.output
