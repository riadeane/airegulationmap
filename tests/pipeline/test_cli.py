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
