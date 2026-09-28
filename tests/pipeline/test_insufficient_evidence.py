"""Insufficient evidence (rubric v3.1, issue #162) across the pipeline: a
``None`` score must survive the repository, the history, the gate, the
digest and the mirror without crashing or turning into a number.

The model-level rules (schema, dimension mean, composite, confidence cap)
are in ``test_models.py``.
"""

from __future__ import annotations

import csv
import json
from datetime import date

from conftest import full_result
from regulation_pipeline import digest, gate
from regulation_pipeline.config import Settings
from regulation_pipeline.db.mirror import _Entry, _score_row
from regulation_pipeline.history import append_snapshot, calibration_due, rubric_of
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.prompt import PROMPT_VERSION, RESEARCH_PROMPT, RUBRIC_VERSION
from regulation_pipeline.repository import Dataset, split_subscores_entry
from regulation_pipeline.service import CountryChange
from regulation_pipeline.staleness import StalenessPolicy

TODAY = date(2026, 10, 5)
NULL = {"score": None, "rationale": "Searched the regulator and gazette sites; nothing found."}
BASE_SOURCES = "https://example.gov/ai|https://example.gov/law"


def unscored_enforcement(**overrides) -> ResearchResult:
    """Baseline result with enforcement_level unscored (two nulls) and one
    null in policy_lever: enforcement None, policy 3.33, composite 3.67."""
    raw = full_result(**overrides)
    raw["enforcement_level"]["actions_taken"] = dict(NULL)
    raw["enforcement_level"]["monitoring_practice"] = dict(NULL)
    raw["policy_lever"]["economic_tools"] = dict(NULL)
    return ResearchResult.model_validate(raw)


def baseline() -> ResearchResult:
    return ResearchResult.model_validate(full_result())


def dataset(tmp_path) -> Dataset:
    return Dataset.load(Settings(root=tmp_path), CountryNames({}))


# -- repository ----------------------------------------------------------------


class TestRepository:
    def test_scores_row_holds_none_and_confidence_is_low(self, tmp_path):
        ds = dataset(tmp_path)
        outcome = ds.apply("Fiji", unscored_enforcement(), TODAY)
        row = ds.scores_row("Fiji")
        assert row["Enforcement Level"] is None
        assert row["Policy Lever"] == 3.33
        assert row["Average Score"] == 3.67  # (4.0 + 3.33) / 2
        assert ds.regulation_row("Fiji")["Confidence"] == "low"
        assert outcome.confidence == "low"
        assert ds.validate() == []

    def test_round_trip_through_the_files(self, tmp_path):
        ds = dataset(tmp_path)
        ds.apply("Fiji", unscored_enforcement(), TODAY)
        ds.save()

        with (tmp_path / "public" / "scores.csv").open(newline="", encoding="utf-8") as f:
            [row] = list(csv.DictReader(f))
        assert row["Enforcement Level"] == ""  # an empty cell, not 0 or "None"
        assert row["Policy Lever"] == "3.33"

        subscores = json.loads((tmp_path / "public/data/subscores.json").read_text(encoding="utf-8"))
        block = subscores["countries"]["Fiji"]["enforcement_level"]
        assert block["actions_taken"] == NULL
        assert block["sanctions_framework"]["score"] == 5

        history = json.loads((tmp_path / "public/history.json").read_text(encoding="utf-8"))
        [snap] = history["countries"]["Fiji"]
        assert snap["enforcementLevel"] is None
        assert snap["averageScore"] == 3.67

        # A reload and a rewrite leave every file byte-identical.
        before = {p: p.read_bytes() for p in (tmp_path / "public").rglob("*.*")}
        dataset(tmp_path).save()
        assert {p: p.read_bytes() for p in before} == before

    def test_split_subscores_entry_keeps_null(self):
        entry = {"date": "2026-10-05", "enforcement_level": {"actions_taken": NULL}}
        scores, rationales = split_subscores_entry(entry)
        assert scores == {"date": "2026-10-05", "enforcement_level": {"actions_taken": None}}
        assert rationales == {"enforcement_level": {"actions_taken": NULL["rationale"]}}

    def test_held_result_reports_a_none_average(self, tmp_path):
        ds = dataset(tmp_path)
        ds._scores["Fiji"] = {
            "Country": "Fiji", "Regulation Status": "", "Policy Lever": "",
            "Governance Type": "2.0", "Actor Involvement": "3.0", "Average Score": "",
            "Enforcement Level": "4.0", "Last Updated": "2026-09-01", "Data Version": 2,
        }
        outcome = ds.apply("Fiji", baseline(), TODAY, apply_scores=False)
        assert outcome.average is None


# -- history -------------------------------------------------------------------


def snap(day: str, **overrides) -> dict:
    s = {
        "date": day, "regulationStatus": 2.0, "policyLever": 2.0, "governanceType": 2.0,
        "actorInvolvement": 2.0, "enforcementLevel": 2.0, "averageScore": 2.0,
    }
    s.update(overrides)
    return s


class TestHistory:
    def test_number_to_null_is_a_change(self):
        history = {"countries": {}}
        append_snapshot(history, "Fiji", snap("2026-09-01"))
        assert append_snapshot(history, "Fiji", snap("2026-10-01", enforcementLevel=None)) is True

    def test_null_to_number_is_a_change(self):
        history = {"countries": {}}
        append_snapshot(history, "Fiji", snap("2026-09-01", enforcementLevel=None))
        assert append_snapshot(history, "Fiji", snap("2026-10-01")) is True

    def test_null_to_null_is_unchanged(self):
        history = {"countries": {}}
        append_snapshot(history, "Fiji", snap("2026-09-01", enforcementLevel=None))
        assert append_snapshot(history, "Fiji", snap("2026-10-01", enforcementLevel=None)) is False
        assert len(history["countries"]["Fiji"]) == 1


class TestRubricGuard:
    def test_versions(self):
        assert RUBRIC_VERSION == "v3.1"
        assert PROMPT_VERSION == "v3.3-2026-09"

    def test_rubric_of_reads_v3_1(self):
        assert rubric_of({"rubric": "v3.1"}) == "v3.1"
        # Legacy entries without the field fall back to the leading vN.
        assert rubric_of({"prompt_version": "v3.3-2026-09"}) == "v3"

    def test_calibration_due_for_v3_1(self):
        june = {"date": "2026-06-13", "rubric": "v2", "reason": "v2"}
        v3 = {"date": "2026-09-28", "rubric": "v3", "reason": "v3"}
        v31 = {"date": "2026-10-05", "rubric": "v3.1", "reason": "v3.1"}
        assert calibration_due([june], "v3.1") is True
        assert calibration_due([june, v3], "v3.1") is True
        assert calibration_due([june, v3, v31], "v3.1") is False
        assert calibration_due([june, v3, {**v31, "complete": False}], "v3.1") is True

    def test_the_committed_history_makes_the_v3_1_break_due(self):
        from pathlib import Path

        path = Path(__file__).resolve().parents[2] / "public" / "history.json"
        breaks = json.loads(path.read_text(encoding="utf-8")).get("breaks", [])
        assert calibration_due(breaks, RUBRIC_VERSION) is True


class TestPrompt:
    def test_prompt_allows_null_and_scopes_the_tie_break(self):
        assert "When torn between two levels, give the lower one." not in RESEARCH_PROMPT
        assert "null = insufficient evidence" in RESEARCH_PROMPT
        assert "A 1 needs positive evidence of" in RESEARCH_PROMPT
        assert "never turns missing evidence into a 1" in RESEARCH_PROMPT


# -- gate ----------------------------------------------------------------------


def scores_row(**overrides) -> dict:
    row = {
        "Country": "Fiji", "Regulation Status": "4.0", "Policy Lever": "3.0",
        "Governance Type": "2.0", "Actor Involvement": "3.0", "Average Score": "3.67",
        "Enforcement Level": "4.0", "Last Updated": "2026-09-01", "Data Version": 3,
    }
    row.update(overrides)
    return row


REG = {"Country": "Fiji", "Specific Laws": "AI Act (2024)", "Sources": BASE_SOURCES}


class TestGate:
    def test_move_to_null_without_evidence_is_held(self):
        decision = gate.decide(scores_row(), REG, unscored_enforcement(), None, TODAY)
        assert decision.rule == gate.HELD
        assert decision.pending["candidate_scores"]["enforcement_level"] is None
        assert "enforcement_level to insufficient evidence" in decision.reason

    def test_move_to_null_repeating_is_persisted(self):
        first = gate.decide(scores_row(), REG, unscored_enforcement(), None, TODAY)
        # The pending entry round-trips through JSON (pending.json).
        pending = json.loads(json.dumps(first.pending))
        second = gate.decide(scores_row(), REG, unscored_enforcement(), pending, date(2026, 10, 12))
        assert second.rule == gate.APPLIED_PERSISTED

    def test_move_to_null_with_new_source_applies_and_is_reviewed(self):
        result = unscored_enforcement(sources=BASE_SOURCES + "|https://new.gov/x")
        decision = gate.decide(scores_row(), REG, result, None, TODAY)
        assert decision.rule == gate.APPLIED_EVIDENCE
        moves = {m.dimension: m for m in decision.large_moves}
        assert moves["enforcement_level"].old == 4.0
        assert moves["enforcement_level"].new is None

    def test_move_from_null_is_a_change(self):
        prior = scores_row(**{"Enforcement Level": ""})
        decision = gate.decide(prior, REG, baseline(), None, TODAY)
        assert decision.rule == gate.HELD
        assert "enforcement_level from insufficient evidence" in decision.reason

    def test_null_to_null_is_unchanged(self):
        prior = scores_row(**{"Enforcement Level": "", "Policy Lever": "3.33"})
        decision = gate.decide(prior, REG, unscored_enforcement(), None, TODAY)
        assert decision.rule == gate.UNCHANGED

    def test_row_with_every_score_empty_counts_as_no_prior_scores(self):
        empty = {column: "" for column in gate.SCORE_COLUMNS.values()}
        decision = gate.decide(scores_row(**empty), REG, baseline(), None, TODAY)
        assert decision.rule == gate.APPLIED_EVIDENCE
        assert decision.reason == "no prior scores"

    def test_summary_formats_null(self):
        result = unscored_enforcement(sources=BASE_SOURCES + "|https://new.gov/x")
        tally = gate.GateTally()
        tally.add("Fiji", gate.decide(scores_row(), REG, result, None, TODAY))
        assert "Review: Fiji enforcement_level 4.0 -> insufficient evidence" in gate.review_lines(tally)[0]
        assert "| Fiji | enforcement_level | 4.0 | insufficient evidence |" in gate.markdown_summary(tally)

    def test_standing_with_a_null_candidate(self):
        pending = {"candidate_scores": {"enforcement_level": None}, "first_seen": "2026-10-05"}
        text = gate.standing(scores_row(), pending)
        assert "enforcement_level to insufficient evidence" in text


class TestStaleness:
    def test_low_confidence_from_an_unscored_dimension_is_re_researched(self, tmp_path):
        ds = dataset(tmp_path)
        ds.apply("Fiji", unscored_enforcement(), TODAY)
        policy = StalenessPolicy(90, TODAY)
        assert policy.should_update(ds.scores_row("Fiji"), ds.regulation_row("Fiji")) is True


# -- digest --------------------------------------------------------------------


class TestDigest:
    def _change(self, old_scores) -> CountryChange:
        reg = {"Country": "Fiji", "Specific Laws": "AI Act (2024)", "Sources": BASE_SOURCES,
               "Confidence": "low"}
        return CountryChange(
            country="Fiji", old_scores=old_scores,
            new_scores=scores_row(**{"Enforcement Level": ""}),
            old_regulation=dict(reg), new_regulation=dict(reg),
        )

    def test_move_to_null_reads_insufficient_evidence(self):
        [selected] = digest.select_changes([self._change(scores_row(**{"Enforcement Level": "2.5"}))])
        assert selected.scores == {"enforcement_level": (2.5, None)}
        assert selected.first_scored is False
        prompt = digest.render_prompt([selected], TODAY)
        assert "- enforcement_level: 2.5 -> insufficient evidence" in prompt
        assert selected.to_json()["first_scored"] is False
        assert selected.to_json()["scores"]["enforcement_level"] == {"old": 2.5, "new": None}

    def test_first_scored_country_reads_none_for_old(self):
        [selected] = digest.select_changes([self._change(None)])
        assert selected.first_scored is True
        prompt = digest.render_prompt([selected], TODAY)
        assert "- regulation_status: none -> 4" in prompt
        # No prior row and no score now: nothing moved, so it is not listed.
        assert "enforcement_level" not in prompt


# -- mirror --------------------------------------------------------------------


class TestMirror:
    def test_score_row_carries_nulls(self, tmp_path):
        ds = dataset(tmp_path)
        result = unscored_enforcement()
        ds.apply("Fiji", result, TODAY)
        entry = _Entry(
            "Fiji", result, TODAY, dict(ds.scores_row("Fiji")),
            ds.subscores_for("Fiji") or {}, ds.history_for("Fiji"),
        )
        row = _score_row("cid-1", entry, "run-1")
        assert row["enforcement_level"] is None
        assert row["avg_score"] == 3.67
        assert row["subscores"]["enforcement_level"]["actions_taken"] is None
        assert row["rationales"]["enforcement_level"]["actions_taken"] == NULL["rationale"]
        assert row["confidence"] == "low"
