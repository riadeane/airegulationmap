"""The stability gate (gate.py) and its seams in the service, the
repository, and the CLI.

Rule coverage: new source applies; law text change applies; no evidence
holds; held then persisted applies; held then reverted clears; --no-gate
applies everything; --no-gate on a full run needs --break-reason; a break
entry lands in history.json.
"""

from __future__ import annotations

import json
from datetime import date

import typer
from conftest import full_result, sub
from regulation_pipeline import cli, gate
from regulation_pipeline.config import Settings
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy
from typer.testing import CliRunner

RUN_1 = date(2026, 9, 7)
RUN_2 = date(2026, 9, 14)
RUN_3 = date(2026, 9, 21)

# The baseline result (conftest.full_result) scores: regulation 4.0,
# policy 3.0, governance 2.0, actor 3.0, enforcement 4.0.
BASE_SOURCES = "https://example.gov/ai|https://example.gov/law"


def result(**overrides) -> ResearchResult:
    return ResearchResult.model_validate(full_result(**overrides))


def bumped(**overrides) -> ResearchResult:
    """The baseline with regulation_status moved 4.0 -> 4.25 and nothing
    else changed: the jitter the gate exists to hold."""
    reg = dict(full_result()["regulation_status"], scope=sub(4))
    return result(regulation_status=reg, **overrides)


def dropped() -> ResearchResult:
    reg = dict(full_result()["regulation_status"], scope=sub(2))
    return result(regulation_status=reg)


def existing_rows() -> tuple[dict, dict]:
    scores = {
        "Country": "A", "Regulation Status": "4.0", "Policy Lever": "3.0",
        "Governance Type": "2.0", "Actor Involvement": "3.0", "Average Score": "3.67",
        "Enforcement Level": "4.0", "Last Updated": "2026-08-31", "Data Version": 3,
    }
    reg = {"Country": "A", "Specific Laws": "AI Act (2024)", "Sources": BASE_SOURCES}
    return scores, reg


# -- decide(): the pure rules -----------------------------------------------------


class TestDecide:
    def test_no_prior_scores_applies(self):
        decision = gate.decide(None, None, bumped(), None, RUN_1)
        assert decision.rule == gate.APPLIED_EVIDENCE
        assert decision.apply_scores is True
        assert decision.pending is None

    def test_unchanged_scores_are_unchanged_and_clear_pending(self):
        scores, reg = existing_rows()
        pending = {"candidate_scores": bumped().dimension_scores(), "first_seen": "2026-09-07"}
        decision = gate.decide(scores, reg, result(), pending, RUN_2)
        assert decision.rule == gate.UNCHANGED
        assert decision.apply_scores is True
        assert decision.pending is None

    def test_new_source_applies(self):
        scores, reg = existing_rows()
        decision = gate.decide(
            scores, reg, bumped(sources=BASE_SOURCES + "|https://legislation.gov.uk/ai"), None, RUN_1,
        )
        assert decision.rule == gate.APPLIED_EVIDENCE
        assert decision.new_sources == ("https://legislation.gov.uk/ai",)

    def test_source_comparison_ignores_scheme_www_and_trailing_slash(self):
        scores, reg = existing_rows()
        same = "http://www.example.gov/ai/|https://example.gov/law"
        decision = gate.decide(scores, reg, bumped(sources=same), None, RUN_1)
        assert decision.rule == gate.HELD

    def test_law_text_change_applies(self):
        scores, reg = existing_rows()
        decision = gate.decide(
            scores, reg, bumped(specific_laws="AI Act (2024), AI Liability Directive (2026)"), None, RUN_1,
        )
        assert decision.rule == gate.APPLIED_EVIDENCE
        assert decision.reason == "specific laws changed"

    def test_law_text_whitespace_only_change_is_not_evidence(self):
        scores, reg = existing_rows()
        decision = gate.decide(scores, reg, bumped(specific_laws="  AI Act   (2024) "), None, RUN_1)
        assert decision.rule == gate.HELD

    def test_no_evidence_holds_with_candidate(self):
        scores, reg = existing_rows()
        decision = gate.decide(scores, reg, bumped(), None, RUN_1)
        assert decision.rule == gate.HELD
        assert decision.apply_scores is False
        assert decision.pending == {
            "candidate_scores": bumped().dimension_scores(), "first_seen": "2026-09-07",
        }
        assert "regulation_status up" in decision.reason

    def test_held_then_persisted_applies(self):
        scores, reg = existing_rows()
        first = gate.decide(scores, reg, bumped(), None, RUN_1)
        second = gate.decide(scores, reg, bumped(), first.pending, RUN_2)
        assert second.rule == gate.APPLIED_PERSISTED
        assert second.apply_scores is True
        assert second.pending is None

    def test_persistence_needs_the_same_direction(self):
        scores, reg = existing_rows()
        first = gate.decide(scores, reg, bumped(), None, RUN_1)
        second = gate.decide(scores, reg, dropped(), first.pending, RUN_2)
        assert second.rule == gate.HELD
        assert second.pending["first_seen"] == "2026-09-14"

    def test_held_then_reverted_clears(self):
        scores, reg = existing_rows()
        first = gate.decide(scores, reg, bumped(), None, RUN_1)
        second = gate.decide(scores, reg, result(), first.pending, RUN_2)
        assert second.rule == gate.UNCHANGED
        assert second.pending is None

    def test_confidence_drop_does_not_bypass_the_gate(self):
        scores, reg = existing_rows()
        decision = gate.decide(scores, reg, bumped(confidence="low"), None, RUN_1)
        assert decision.rule == gate.HELD

    def test_large_move_is_flagged_only_when_applied(self):
        scores, reg = existing_rows()
        big = dict(full_result()["regulation_status"], binding_force=sub(1), scope=sub(1), implementation=sub(1))
        held = gate.decide(scores, reg, result(regulation_status=big), None, RUN_1)
        assert held.large_moves == ()
        applied = gate.decide(
            scores, reg, result(regulation_status=big, specific_laws="repealed"), None, RUN_1,
        )
        assert applied.large_moves == (gate.LargeMove("regulation_status", 4.0, 2.0),)

    def test_ungated_applies_everything_and_labels_it(self):
        scores, reg = existing_rows()
        assert gate.ungated(scores, bumped()).rule == gate.APPLIED_UNGATED
        assert gate.ungated(scores, result()).rule == gate.UNCHANGED
        assert gate.ungated(None, bumped()).rule == gate.APPLIED_EVIDENCE


class TestSummary:
    def test_markdown_lists_counts_and_review_rows(self):
        tally = gate.GateTally()
        scores, reg = existing_rows()
        big = dict(full_result()["regulation_status"], binding_force=sub(1), scope=sub(1), implementation=sub(1))
        tally.add("A", gate.decide(
            scores, reg, result(regulation_status=big, sources="https://new.gov/x"), None, RUN_1,
        ))
        tally.add("B", gate.decide(scores, reg, bumped(), None, RUN_1))
        text = gate.markdown_summary(tally, {"reason": "Opus 5 switch"})
        assert "| `applied:evidence` | 1 |" in text
        assert "| `held` | 1 |" in text
        assert "### Review these" in text
        assert "| A | regulation_status | 4.0 | 2.0 | https://new.gov/x |" in text
        assert "Calibration break recorded: Opus 5 switch" in text
        assert tally.summary_line().startswith("Gate: applied:evidence=1")


# -- the service and the repository -----------------------------------------------


class ListStrategy:
    def __init__(self, answers):
        self._answers = answers

    def research(self, countries, reg_rows):
        yield from self._answers


def _service(root, today, **kwargs):
    ds = Dataset.load(Settings(root=root), CountryNames({}))
    return PipelineService(ds, StalenessPolicy(90, today), today, **kwargs), ds


def _pending_file(root) -> dict:
    return json.loads((root / "public" / "data" / "pending.json").read_text())


class TestServiceGate:
    def test_held_result_updates_text_but_not_scores(self, tmp_path):
        svc, ds = _service(tmp_path, RUN_1)
        svc.run(ListStrategy([("A", result())]), ["A"])

        svc, ds = _service(tmp_path, RUN_2)
        run = svc.run(ListStrategy([("A", bumped(confidence="medium"))]), ["A"])

        assert run.gate.counts[gate.HELD] == 1
        row = ds.scores_row("A")
        assert row["Regulation Status"] == "4.0"      # held (CSV string, as loaded)
        assert row["Last Updated"] == "2026-09-14"    # always applies
        assert ds.regulation_row("A")["Confidence"] == "medium"
        assert len(ds.history_for("A")) == 1
        assert ds.history_for("A")[0]["date"] == "2026-09-07"   # snapshot not advanced
        assert ds.subscores_for("A")["date"] == "2026-09-07"
        assert _pending_file(tmp_path)["pending"] == [{
            "country": "A",
            "candidate_scores": bumped().dimension_scores(),
            "first_seen": "2026-09-14",
        }]

    def test_held_then_persisted_lands_and_clears_pending(self, tmp_path):
        svc, _ = _service(tmp_path, RUN_1)
        svc.run(ListStrategy([("A", result())]), ["A"])
        svc, _ = _service(tmp_path, RUN_2)
        svc.run(ListStrategy([("A", bumped())]), ["A"])
        svc, ds = _service(tmp_path, RUN_3)
        run = svc.run(ListStrategy([("A", bumped())]), ["A"])

        assert run.gate.counts[gate.APPLIED_PERSISTED] == 1
        assert ds.scores_row("A")["Regulation Status"] == 4.25
        assert [s["date"] for s in ds.history_for("A")] == ["2026-09-07", "2026-09-21"]
        assert _pending_file(tmp_path)["pending"] == []

    def test_held_then_reverted_clears(self, tmp_path):
        svc, _ = _service(tmp_path, RUN_1)
        svc.run(ListStrategy([("A", result())]), ["A"])
        svc, _ = _service(tmp_path, RUN_2)
        svc.run(ListStrategy([("A", bumped())]), ["A"])
        svc, ds = _service(tmp_path, RUN_3)
        run = svc.run(ListStrategy([("A", result())]), ["A"])

        assert run.gate.counts[gate.UNCHANGED] == 1
        assert _pending_file(tmp_path)["pending"] == []
        assert ds.history_for("A")[0]["date"] == "2026-09-21"

    def test_no_gate_applies_everything_and_records_break(self, tmp_path):
        svc, _ = _service(tmp_path, RUN_1)
        svc.run(ListStrategy([("A", result()), ("B", result())]), ["A", "B"])

        brk = {"date": "2026-09-14", "model": "claude-opus-5",
               "prompt_version": "v3-2026-09", "reason": "Opus 5 switch"}
        svc, ds = _service(tmp_path, RUN_2, gate_enabled=False, calibration_break=brk)
        run = svc.run(ListStrategy([("A", bumped()), ("B", result())]), ["A", "B"])

        assert run.gate.counts[gate.APPLIED_UNGATED] == 1
        assert run.gate.counts[gate.UNCHANGED] == 1
        assert ds.scores_row("A")["Regulation Status"] == 4.25
        history = json.loads((tmp_path / "public" / "history.json").read_text())
        assert history["breaks"] == [brk]
        assert history["countries"]["A"][-1]["date"] == "2026-09-14"

        # A re-run on the same day records the break once.
        svc, ds = _service(tmp_path, RUN_2, gate_enabled=False, calibration_break=brk)
        svc.run(ListStrategy([("A", bumped())]), ["A"])
        assert len(json.loads((tmp_path / "public" / "history.json").read_text())["breaks"]) == 1

    def test_mirror_receives_gated_scores(self, tmp_path):
        recorded = []

        class Mirror:
            def begin(self, attempted):
                pass

            def record(self, country, result, today, *, scores_row, subscores, history):
                recorded.append((scores_row["Regulation Status"], subscores["date"]))

            def finish(self, updated, failed, fatal, *, gate_counts=None):
                recorded.append(gate_counts)

        svc, _ = _service(tmp_path, RUN_1)
        svc.run(ListStrategy([("A", result())]), ["A"])
        svc, _ = _service(tmp_path, RUN_2, mirror=Mirror())
        svc.run(ListStrategy([("A", bumped())]), ["A"])
        assert recorded[0] == ("4.0", "2026-09-07")
        assert recorded[1][gate.HELD] == 1

    def test_standing_describes_the_pending_candidate(self, tmp_path):
        svc, _ = _service(tmp_path, RUN_1)
        assert svc.standing("A") == "no prior scores: any result applies"
        svc.run(ListStrategy([("A", result())]), ["A"])
        svc, _ = _service(tmp_path, RUN_2)
        assert svc.standing("A").startswith("gate on")
        svc.run(ListStrategy([("A", bumped())]), ["A"])
        svc, _ = _service(tmp_path, RUN_3)
        assert svc.standing("A") == (
            "held since 2026-09-14 (regulation_status up): applies if the same move repeats"
        )


# -- the CLI ----------------------------------------------------------------------


runner = CliRunner()


def _app() -> typer.Typer:
    app = typer.Typer()
    app.command()(cli._run)
    return app


def test_no_gate_on_full_run_without_break_reason_exits_1(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    outcome = runner.invoke(_app(), ["--dry-run", "--no-gate"])
    assert outcome.exit_code == 1


def test_no_gate_on_a_country_subset_needs_no_reason(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    outcome = runner.invoke(_app(), ["--dry-run", "--no-gate", "--countries", "Germany"])
    assert outcome.exit_code == 0


def test_break_reason_without_no_gate_exits_1(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    outcome = runner.invoke(_app(), ["--dry-run", "--break-reason", "x"])
    assert outcome.exit_code == 1


def _logged(outcome) -> str:
    # configure_logging() sends the log to stderr, which the runner captures.
    return outcome.output + (outcome.stderr or "")


def test_dry_run_prints_the_gate_standing_per_country(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    outcome = runner.invoke(_app(), ["--dry-run", "--countries", "Germany"])
    assert outcome.exit_code == 0
    assert "Germany: gate on" in _logged(outcome)


def test_dry_run_with_break_announces_it(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    outcome = runner.invoke(_app(), ["--dry-run", "--no-gate", "--break-reason", "Opus 5 switch"])
    assert outcome.exit_code == 0
    assert "would record break: Opus 5 switch" in _logged(outcome)
