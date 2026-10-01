"""A batch still processing at the end of the wait is handed to a later run (#194).

On 2026-09-28 the weekly batch (196 requests) was still processing after the
4-hour wait; the runner canceled it and collected the 67 requests that had
finished, so 129 countries were lost. With handoff on, the run's main batch
is left running and recorded in ``state/open_batch.json``; a later run
collects it with the options it was submitted with.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
import typer
from conftest import full_result
from regulation_pipeline import cli, handoff
from regulation_pipeline.batch import BatchPending, BatchRunner, OpenBatch, build_batch_requests
from regulation_pipeline.config import Settings
from regulation_pipeline.models import ResearchResult
from test_batch import FakeBatches, FakeClient, _items
from typer.testing import CliRunner

NOW = datetime(2026, 10, 5, 6, 20, tzinfo=UTC)


def _runner(client, **kw):
    return BatchRunner(client, sleep=lambda s: None, now=lambda: NOW, **kw)


# -- BatchRunner -----------------------------------------------------------------


def test_main_batch_still_processing_is_handed_off_not_canceled():
    params = {c: {} for c in ("Chile", "Kenya", "Japan")}
    batches = FakeBatches([{"statuses": ["in_progress"] * 50, "results": []}])
    runner = _runner(FakeClient(batches), handoff=True, max_wait=60, poll_interval=30)
    with pytest.raises(BatchPending) as caught:
        runner.research(params)
    pending = caught.value.batch
    assert batches.canceled == []
    assert pending.batch_id == "batch_0"
    assert sorted(pending.id_map.values()) == ["Chile", "Japan", "Kenya"]
    assert pending.id_map == build_batch_requests(params)[1]
    assert pending.submitted_at == NOW


def test_without_handoff_the_batch_is_still_canceled_and_salvaged():
    # The gold CLI has no later run to hand a batch to.
    params = {"A": {}}
    msg = object()
    batches = FakeBatches([{"statuses": ["ended"], "results": _items(params, {"A": ("succeeded", msg)})}])
    messages, failed = _runner(FakeClient(batches), max_wait=0).research(params)
    assert batches.canceled == ["batch_0"]
    assert messages == {"A": msg} and failed == []


def test_a_follow_up_batch_is_never_handed_off():
    # Follow-up rounds are small; one still running at the end of the budget
    # is canceled and salvaged as before, never recorded.
    params = {"A": {}, "B": {}}
    msg = object()
    first = _items(params, {"A": ("succeeded", msg), "B": ("errored", "overloaded_error")})
    batches = FakeBatches([
        {"statuses": ["ended"], "results": first},
        {"statuses": ["in_progress"] * 100, "results": []},
    ])
    runner = _runner(
        FakeClient(batches), handoff=True, max_wait=20 * 60, poll_interval=60,
        cancel_grace_seconds=60,
    )
    messages, failed = runner.research(params)
    assert batches.canceled == ["batch_1"]
    assert messages == {"A": msg}
    assert failed == ["B"]


class _ResumeBatches(FakeBatches):
    """A server that already holds batch ``batch_old``; create() is a failure."""

    def __init__(self, statuses, results):
        super().__init__([])
        self._statuses = list(statuses)
        self._results = results

    def create(self, requests):
        raise AssertionError("a resumed run must not submit a new batch")


def test_resume_collects_the_recorded_batch_without_submitting():
    params = {c: {} for c in ("Chile", "Kenya")}
    msg_c, msg_k = object(), object()
    _, id_map = build_batch_requests(params)
    results = _items(params, {"Chile": ("succeeded", msg_c), "Kenya": ("succeeded", msg_k)})
    batches = _ResumeBatches(["ended"], results)
    runner = _runner(FakeClient(batches), handoff=True)
    open_batch = OpenBatch("batch_old", id_map, NOW - timedelta(hours=5))
    messages, failed = runner.research(params, resume=open_batch)
    assert messages == {"Chile": msg_c, "Kenya": msg_k}
    assert failed == []


def test_resume_hands_a_still_running_batch_on_with_the_same_id():
    params = {"Chile": {}}
    _, id_map = build_batch_requests(params)
    batches = _ResumeBatches(["in_progress"] * 50, [])
    runner = _runner(FakeClient(batches), handoff=True, collect_wait=60, poll_interval=30)
    open_batch = OpenBatch("batch_old", id_map, NOW - timedelta(hours=5))
    with pytest.raises(BatchPending) as caught:
        runner.research(params, resume=open_batch)
    assert caught.value.batch == open_batch
    assert batches.canceled == []


# -- the state file ----------------------------------------------------------------


def test_state_round_trips_and_expires_after_29_days(tmp_path):
    path = tmp_path / "state" / "open_batch.json"
    record = handoff.Handoff(
        OpenBatch("msgbatch_1", {"country-0000": "Chile", "country-0001": "Kenya"}, NOW),
        run_id="run-1", options={"model": "claude-opus-5", "full_run": True},
    )
    handoff.save(path, record)
    loaded = handoff.load(path)
    assert loaded == record
    assert loaded.countries == ["Chile", "Kenya"]
    assert not loaded.expired(NOW + timedelta(days=28))
    assert loaded.expired(NOW + timedelta(days=30))
    handoff.clear(path)
    assert handoff.load(path) is None


def test_an_unreadable_state_file_is_an_error_not_no_batch(tmp_path):
    # Treating it as "no batch" would submit a second one and pay twice.
    path = tmp_path / "open_batch.json"
    path.write_text(json.dumps({"version": 1, "batch_id": "", "id_map": {}}))
    with pytest.raises(ValueError):
        handoff.load(path)


# -- CLI ------------------------------------------------------------------------------

runner = CliRunner()


def _app() -> typer.Typer:
    app = typer.Typer()
    app.command()(cli._run)
    return app


def _dataset(tmp_path, countries):
    settings = Settings(root=tmp_path)
    settings.scores_csv.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "Country,Regulation Status,Policy Lever,Governance Type,Actor Involvement,"
        "Enforcement Level,Average Score,Last Updated,Data Version\n"
    )
    rows = "".join(f"{c},2,2,2,2,2,2,2026-09-01,1\n" for c in countries)
    settings.scores_csv.write_text(header + rows, encoding="utf-8")
    june = {"date": "2026-06-13", "prompt_version": "v2-2026-06", "reason": "v2"}
    settings.history_json.write_text(
        json.dumps({"schema_version": 1, "countries": {}, "breaks": [june]}), encoding="utf-8",
    )
    return settings


@pytest.fixture
def cli_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    for name in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "GITHUB_EVENT_NAME", "GITHUB_STEP_SUMMARY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(cli, "Settings", lambda **kw: Settings(root=tmp_path, **kw))
    return _dataset(tmp_path, ["Chile", "Kenya"])


class _PendingStrategy:
    def __init__(self, client, runner, use_search_for, *, resume=None):
        self.resume = resume

    def research(self, countries, reg_rows):
        id_map = {f"country-{i:04d}": c for i, c in enumerate(sorted(countries))}
        # A resumed batch is handed on with its own record, as the runner does.
        raise BatchPending(self.resume or OpenBatch("msgbatch_new", id_map, NOW))
        yield  # pragma: no cover - makes this a generator, like the real strategy


class _CollectingStrategy:
    seen_resume = None

    def __init__(self, client, runner, use_search_for, *, resume=None):
        type(self).seen_resume = resume

    def research(self, countries, reg_rows):
        for country in countries:
            yield country, ResearchResult.model_validate(full_result())


def test_a_handed_off_run_records_the_batch_and_exits_0(cli_env, monkeypatch):
    monkeypatch.setattr(cli, "BatchStrategy", _PendingStrategy)
    result = runner.invoke(_app(), ["--no-link-check"])
    assert result.exit_code == 0, result.output
    assert "still processing" in result.output
    state = json.loads(cli_env.open_batch_json.read_text())
    assert state["batch_id"] == "msgbatch_new"
    assert sorted(state["id_map"].values()) == ["Chile", "Kenya"]
    # The rubric guard's decision travels with the batch: the collecting run
    # applies the results ungated and records the same break.
    assert state["options"]["gate_enabled"] is False
    assert state["options"]["break_reason"].startswith("Switch to scoring rubric")
    assert state["options"]["full_run"] is True
    # Nothing was applied: the data files are untouched.
    assert "Chile,2,2,2,2,2,2,2026-09-01,1" in cli_env.scores_csv.read_text()


def test_the_next_run_collects_with_the_recorded_options_and_clears_the_record(cli_env, monkeypatch):
    handoff.save(cli_env.open_batch_json, handoff.Handoff(
        OpenBatch("msgbatch_old", {"country-0000": "Chile", "country-0001": "Kenya"}, NOW),
        run_id="run-1",
        options={
            "model": "claude-opus-5", "search": True, "grounded": False, "gate_enabled": False,
            "break_reason": "Switch to scoring rubric v3.2 (model claude-opus-5)",
            "full_run": True, "digest": False, "scheduled": True,
        },
    ))
    monkeypatch.setattr(cli, "BatchStrategy", _CollectingStrategy)
    # Flags that would start a different run are ignored while a batch is open.
    result = runner.invoke(_app(), ["--no-link-check", "--countries", "Kenya"])
    assert result.exit_code == 0, result.output
    assert _CollectingStrategy.seen_resume.batch_id == "msgbatch_old"
    assert "Countries to update: 2 / 2" in result.output
    assert not cli_env.open_batch_json.exists()
    history = json.loads(cli_env.history_json.read_text())
    assert history["breaks"][-1]["reason"] == "Switch to scoring rubric v3.2 (model claude-opus-5)"
    assert history["breaks"][-1]["complete"] is True


def test_a_still_running_batch_keeps_its_record(cli_env, monkeypatch):
    record = handoff.Handoff(
        OpenBatch("msgbatch_old", {"country-0000": "Chile", "country-0001": "Kenya"}, NOW),
        run_id="run-1", options={"model": "claude-opus-5", "gate_enabled": True, "full_run": True},
    )
    handoff.save(cli_env.open_batch_json, record)
    before = cli_env.open_batch_json.read_text()
    monkeypatch.setattr(cli, "BatchStrategy", _PendingStrategy)
    # A scheduled collect run must not rewrite a record a manual run made.
    monkeypatch.setenv("GITHUB_EVENT_NAME", "schedule")
    result = runner.invoke(_app(), ["--no-link-check", "--collect-only"])
    assert result.exit_code == 0, result.output
    # Byte for byte: an unfinished collect leaves nothing to commit.
    assert cli_env.open_batch_json.read_text() == before


def test_collect_only_without_a_record_exits_0_before_any_api_use(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(cli, "Settings", lambda **kw: Settings(root=tmp_path, **kw))
    result = runner.invoke(_app(), ["--collect-only"])
    assert result.exit_code == 0
    assert "No open batch to collect" in result.output


def test_an_expired_record_is_removed_and_fails_the_run(cli_env):
    handoff.save(cli_env.open_batch_json, handoff.Handoff(
        OpenBatch("msgbatch_old", {"country-0000": "Chile"}, datetime(2026, 8, 1, tzinfo=UTC)),
        options={"full_run": True},
    ))
    result = runner.invoke(_app(), ["--collect-only"])
    assert result.exit_code == 1
    assert "results are gone" in result.output
    assert not cli_env.open_batch_json.exists()
