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
