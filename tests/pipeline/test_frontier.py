"""Frontier Risk Governance (PRD 15): the lens's models, tracks, computed
sub-indicator, prompt, request, persistence, gate, service run and gold
check, plus the committed reference files."""

from __future__ import annotations

import csv
import itertools
import json
from datetime import date
from pathlib import Path

import pytest
from conftest import full_result, sub, text_message
from regulation_pipeline import gate
from regulation_pipeline.api import ResearchClient
from regulation_pipeline.config import Settings
from regulation_pipeline.frontier import (
    Dialogue,
    FrontierContext,
    FrontierDataError,
    FrontierPrompt,
    FrontierTrackMismatch,
    InternationalLists,
    LeadingRole,
    SummitText,
    TrackEntry,
    load_international,
    load_tracks,
)
from regulation_pipeline.gold import compare_frontier, drift_row, parse_gold_set
from regulation_pipeline.models import (
    FRONTIER_SUBINDICATORS,
    NA,
    TRACKS,
    FrontierAnswerG,
    FrontierAnswerH,
    FrontierRecord,
    ResearchResult,
    ResearchResultC,
    ResearchResultG,
    ResearchResultH,
    applies,
    frontier_score,
    researched_subindicators,
    result_model_for,
)
from regulation_pipeline.names import CountryNames
from regulation_pipeline.prompt import (
    FRONTIER_ANCHORS,
    PROMPT_VERSION,
    RUBRIC_VERSION,
    render_prompt,
)
from regulation_pipeline.repository import FRONTIER_KEY, Dataset, split_subscores_entry
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy

REPO_ROOT = Path(__file__).resolve().parents[2]
TODAY = date(2026, 10, 5)
NEXT_WEEK = date(2026, 10, 12)


# -- builders -------------------------------------------------------------------


def frontier_block(track: str, score: int | None = 3, sources: str = "https://example.gov/frontier") -> dict:
    block = {name: {"score": score, "rationale": "Fact."} for name in researched_subindicators(track)}
    return {**block, "text": "Frontier text.", "sources": sources}


def raw(track: str | None, score: int | None = 3, **overrides) -> dict:
    data = full_result(**overrides)
    if track is not None:
        data["frontier_risk"] = frontier_block(track, score)
    return data


def lists(**overrides) -> InternationalLists:
    """A small set of public lists: Aland signed Bletchley and a Seoul text
    and leads; Borduria is a member with a frontier text; Carpania a
    member without one; Dorvia signed Bletchley only; Elbonia holds a
    dialogue with Aland; Freedonia signed only Paris."""
    base = dict(
        reviewed_on="2026-10-01",
        texts=(
            SummitText("bletchley", "Bletchley Declaration", "Bletchley (2023)", "2023-11-01",
                       "frontier", "https://gov.example/b", frozenset({"Aland", "Borduria", "Dorvia"})),
            SummitText("seoul_ministerial", "Seoul Ministerial Statement", "Seoul Ministerial (2024)",
                       "2024-05-22", "frontier", "https://gov.example/s", frozenset({"Aland"})),
            SummitText("paris_2025", "Paris statement", "Paris 2025", "2025-02-11", "broad",
                       "https://gov.example/p", frozenset({"Freedonia", "Dorvia"})),
        ),
        network_title="International Network for Advanced AI Measurement, Evaluation and Science",
        network=frozenset({"Aland", "Borduria", "Carpania"}),
        dialogues=(
            Dialogue(("Aland", "Elbonia"), "Aland-Elbonia frontier dialogue", "2025-01", "2026-06",
                     ("https://gov.example/d",)),
        ),
        leading_roles=(
            LeadingRole("Aland", "coordinates the measurement network", "2025-12",
                        ("https://gov.example/r",)),
        ),
    )
    base.update(overrides)
    return InternationalLists(**base)


def context(tracks: dict[str, str] | None = None, eu: frozenset[str] = frozenset()) -> FrontierContext:
    tracks = tracks if tracks is not None else {"Aland": "H", "Borduria": "C"}
    entries = tuple(
        TrackEntry(country, track, "basis", ("https://epoch.ai/data",), "2026-10-01")
        for country, track in tracks.items()
    )
    return FrontierContext(entries, lists(), eu)


def record(track: str = "G", scores: dict | None = None, sources: str = "https://example.gov/f") -> FrontierRecord:
    values = {name: (scores or {}).get(name, 3) if applies(name, track) else NA for name in FRONTIER_SUBINDICATORS}
    return FrontierRecord(
        track=track, subscores=values, rationales=dict.fromkeys(FRONTIER_SUBINDICATORS, "Fact."),
        text="Frontier text.", sources=sources,
    )


def dataset(tmp_path) -> Dataset:
    return Dataset.load(Settings(root=tmp_path), CountryNames({}))


# -- the score --------------------------------------------------------------------


class TestScore:
    def test_mean_of_applicable(self):
        assert frontier_score({"a": 3, "b": 4, "c": NA, "d": NA}) == 3.5

    def test_capped_at_lowest_plus_one(self):
        # 5, 5, 5, 2 averages 4.25 but the weakest element caps it at 3.
        assert frontier_score({"a": 5, "b": 5, "c": 5, "d": 2}) == 3.0

    def test_cap_rounds_thirds(self):
        assert frontier_score({"a": 2, "b": 3, "c": 3, "d": NA}) == 2.67

    def test_any_applicable_null_is_insufficient(self):
        assert frontier_score({"a": None, "b": 5, "c": 5, "d": 5}) is None

    def test_null_on_a_na_element_cannot_happen_but_na_never_counts(self):
        assert frontier_score({"a": NA, "b": NA, "c": 1, "d": 1}) == 1.0

    def test_cap_holds_for_every_combination(self):
        """PRD 15 acceptance: no score exceeds its lowest applicable
        sub-indicator plus one, on any track."""
        for track in TRACKS:
            names = [n for n in FRONTIER_SUBINDICATORS if applies(n, track)]
            for combo in itertools.product(range(1, 6), repeat=len(names)):
                values = {n: NA for n in FRONTIER_SUBINDICATORS}
                values.update(dict(zip(names, combo, strict=True)))
                score = frontier_score(values)
                assert score is not None and 1 <= score <= min(combo) + 1


# -- the models -------------------------------------------------------------------


class TestModels:
    @pytest.mark.parametrize("track", TRACKS)
    def test_schema_asks_for_the_tracks_researched_subindicators_only(self, track):
        schema = result_model_for(track).output_schema()
        assert list(schema["properties"])[-1] == "frontier_risk"
        block = schema["$defs"][f"FrontierAnswer{track}"]
        assert set(block["required"]) == {*researched_subindicators(track), "text", "sources"}
        assert "international_coordination" not in block["properties"]
        assert block["additionalProperties"] is False

    def test_plain_schema_has_no_frontier_block(self):
        assert "frontier_risk" not in result_model_for(None).output_schema()["properties"]

    def test_g_track_never_researches_developer_obligations(self):
        assert researched_subindicators("G") == ("incident_emergency_preparedness",)
        assert researched_subindicators("C") == ("evaluation_oversight", "incident_emergency_preparedness")

    @pytest.mark.parametrize(("track", "cls"), [
        ("H", ResearchResultH), ("C", ResearchResultC), ("G", ResearchResultG), (None, ResearchResult),
    ])
    def test_parse_picks_the_class_by_shape(self, track, cls):
        result = ResearchResult.parse(raw(track))
        assert type(result) is cls
        assert (result.frontier_answer() is None) == (track is None)

    def test_five_dimensions_are_identical_with_and_without_the_block(self):
        plain, frontier = ResearchResult.parse(raw(None)), ResearchResult.parse(raw("H", 1))
        assert plain.dimension_scores() == frontier.dimension_scores()
        assert plain.average_score() == frontier.average_score()
        assert plain.effective_confidence() == frontier.effective_confidence()

    def test_null_frontier_subindicator_does_not_cap_the_main_confidence(self):
        result = ResearchResult.parse(raw("G", None))
        assert result.effective_confidence() == "high"


# -- the context ------------------------------------------------------------------


class TestContext:
    def test_unlisted_country_is_global(self):
        assert context().track_for("Nowhere") == "G"

    def test_assemble_fills_na_and_computed(self):
        answer = FrontierAnswerG.model_validate(frontier_block("G", 2))
        rec = context().assemble("Freedonia", answer)
        assert rec.track == "G"
        assert rec.subscores == {
            "developer_obligations": NA, "evaluation_oversight": NA,
            "incident_emergency_preparedness": 2, "international_coordination": 2,
        }
        assert rec.score == 2.0
        assert rec.rationales["developer_obligations"].startswith("Does not apply on the global track")

    def test_assemble_rejects_another_tracks_answer(self):
        answer = FrontierAnswerG.model_validate(frontier_block("G"))
        with pytest.raises(FrontierTrackMismatch):
            context().assemble("Aland", answer)

    def test_eu_level_only_for_eu_members_on_track_h(self):
        ctx = context({"Aland": "H", "Borduria": "C"}, eu=frozenset({"Aland", "Borduria"}))
        h = ctx.assemble("Aland", FrontierAnswerH.model_validate(frontier_block("H")))
        assert h.eu_level is True
        assert h.entry(TODAY)["developer_obligations"]["eu_level"] is True
        c = ctx.assemble("Borduria", ResearchResult.parse(raw("C")).frontier_answer())
        assert c.eu_level is False

    def test_entry_shape(self):
        rec = context().assemble("Freedonia", FrontierAnswerG.model_validate(frontier_block("G")))
        entry = rec.entry(TODAY)
        assert list(entry) == ["date", "track", "rubric", *FRONTIER_SUBINDICATORS]
        assert entry["international_coordination"]["computed"] is True
        assert entry["developer_obligations"] == {
            "score": NA, "rationale": entry["developer_obligations"]["rationale"],
        }

    @pytest.mark.parametrize(("country", "level"), [
        ("Aland", 5),      # member, Bletchley + Seoul, leading role
        ("Borduria", 4),   # member + frontier text
        ("Carpania", 3),   # member without a frontier text
        ("Dorvia", 3),     # Bletchley signatory, not a member
        ("Elbonia", 3),    # standing frontier-safety dialogue only
        ("Freedonia", 2),  # only a broad declaration
        ("Grand Fenwick", 1),
    ])
    def test_international_levels(self, country, level):
        score, rationale = context().international(country)
        assert score == level
        assert 1 <= len(rationale) <= 200

    def test_member_without_bletchley_and_seoul_needs_both_for_5(self):
        ctx = FrontierContext((), lists(leading_roles=(
            LeadingRole("Borduria", "led a joint test", "2026-01", ("https://gov.example/x",)),
        )))
        assert ctx.international("Borduria")[0] == 4


class TestReferenceFiles:
    """The committed track file and public lists."""

    @pytest.fixture
    def scored(self):
        with (REPO_ROOT / "public" / "scores.csv").open(newline="", encoding="utf-8") as f:
            return {row["Country"] for row in csv.DictReader(f)}

    def test_tracks_name_scored_countries_with_a_valid_track(self, scored):
        entries = load_tracks(REPO_ROOT / "public" / "data" / "frontier_tracks.json")
        assert entries
        assert {e.country for e in entries} <= scored
        assert {e.track for e in entries} <= set(TRACKS)

    def test_lists_name_scored_countries(self, scored):
        intl = load_international(REPO_ROOT / "public" / "data" / "frontier_international.json")
        assert intl.countries() <= scored

    def test_dialogues_met_in_the_year_before_review(self):
        intl = load_international(REPO_ROOT / "public" / "data" / "frontier_international.json")
        reviewed = date.fromisoformat(intl.reviewed_on)
        for dialogue in intl.dialogues:
            met = date.fromisoformat(dialogue.last_met + "-01")
            assert 0 <= (reviewed - met).days <= 366, dialogue.name

    def test_the_committed_context_loads_and_every_rationale_fits(self, scored):
        ctx = FrontierContext.load(Settings())
        assert ctx is not None
        for country in scored:
            score, rationale = ctx.international(country)
            assert 1 <= score <= 5 and len(rationale) <= 200

    def test_no_track_file_turns_the_lens_off(self, tmp_path):
        assert FrontierContext.load(Settings(root=tmp_path)) is None

    def test_malformed_track_file_is_loud(self, tmp_path):
        path = tmp_path / "t.json"
        path.write_text(json.dumps({"schema_version": 1, "countries": [
            {"country": "A", "track": "X", "basis": "b", "sources": ["https://x"], "reviewed_on": "2026-10-01"},
        ]}))
        with pytest.raises(FrontierDataError, match="track"):
            load_tracks(path)

    def test_duplicate_track_entry_is_loud(self, tmp_path):
        entry = {"country": "A", "track": "H", "basis": "b", "sources": ["https://x"], "reviewed_on": "2026-10-01"}
        path = tmp_path / "t.json"
        path.write_text(json.dumps({"schema_version": 1, "countries": [entry, entry]}))
        with pytest.raises(FrontierDataError, match="duplicate"):
            load_tracks(path)


# -- the prompt and the request ---------------------------------------------------


class TestPrompt:
    def test_version(self):
        assert PROMPT_VERSION == "v3.6-2026-10"
        assert RUBRIC_VERSION == "v3.2"  # the five dimensions' rubric is unchanged

    def test_plain_prompt_has_no_lens(self):
        text = render_prompt("Chile", TODAY, None)
        assert "frontier_risk" not in text and "Frontier Risk Governance" not in text

    @pytest.mark.parametrize("track", TRACKS)
    def test_track_prompt_lists_only_its_subindicators(self, track):
        text = render_prompt("Chile", TODAY, None, FrontierPrompt(track, False, "", ""))
        for name in ("developer_obligations", "evaluation_oversight", "incident_emergency_preparedness"):
            assert (f'"{name}": {{"score": <{FRONTIER_ANCHORS[name]}>' in text) == (name in researched_subindicators(track))
        assert '"international_coordination": {"score"' not in text
        assert f"Chile is on track {track}" in text

    def test_eu_rule_and_existing_block(self):
        text = render_prompt("France", TODAY, None, FrontierPrompt("H", True, "Old.", "https://old.example"))
        assert "France is an EU member state" in text
        assert "Existing frontier assessment" in text and "https://old.example" in text
        plain = render_prompt("Chile", TODAY, None, FrontierPrompt("G", False, "", ""))
        assert "Chile is an EU member state" not in plain and "Existing frontier" not in plain

    def test_national_level_and_voluntary_rules(self):
        text = render_prompt("Chile", TODAY, None, FrontierPrompt("H", False, "", ""))
        assert "never raise a frontier score" in text
        assert 'the rationale then says "voluntary"' in text


class _FakeAnthropic:
    def __init__(self):
        self.messages = self
        self.sent: list[dict] = []

    def create(self, **kwargs):
        self.sent.append(kwargs)
        return text_message(json.dumps(raw("G")))


class TestRequest:
    @pytest.mark.parametrize(("country", "track", "uses", "tokens"), [
        ("Aland", "H", 16, 20000), ("Borduria", "C", 16, 20000), ("Freedonia", "G", 12, 16000),
    ])
    def test_schema_and_budget_follow_the_track(self, country, track, uses, tokens):
        client = ResearchClient(_FakeAnthropic(), model="m", today=TODAY, frontier=context())
        params = client.request(country, None, use_search=True).params
        schema = params["output_config"]["format"]["schema"]
        assert f"FrontierAnswer{track}" in schema["$defs"]
        assert params["tools"][0]["max_uses"] == uses
        assert params["max_tokens"] == tokens

    def test_without_context_the_request_is_unchanged(self):
        params = ResearchClient(_FakeAnthropic(), model="m", today=TODAY).request(
            "Freedonia", None, use_search=True,
        ).params
        assert params["output_config"]["format"]["schema"] == ResearchResult.output_schema()
        assert params["tools"][0]["max_uses"] == 12 and params["max_tokens"] == 16000


# -- persistence --------------------------------------------------------------------


def _applied(tmp_path, track="G", scores=None) -> Dataset:
    ds = dataset(tmp_path)
    ds.apply("Freedonia", ResearchResult.parse(raw(track)), TODAY)
    ds.apply_frontier("Freedonia", record(track, scores), TODAY)
    return ds


class TestRepository:
    def test_first_apply_writes_every_store(self, tmp_path):
        ds = _applied(tmp_path, "G", {"incident_emergency_preparedness": 2, "international_coordination": 4})
        row = ds.scores_row("Freedonia")
        assert row["Frontier Risk"] == 3.0 and row["Frontier Track"] == "G"
        reg = ds.regulation_row("Freedonia")
        assert reg["Frontier Risk"] == "Frontier text." and reg["Frontier Sources"] == "https://example.gov/f"
        entry = ds.subscores_for("Freedonia")
        assert entry[FRONTIER_KEY]["track"] == "G"
        snaps = ds.history_for("Freedonia")
        assert len(snaps) == 1
        assert snaps[0]["frontierRisk"] == 3.0 and snaps[0]["frontierTrack"] == "G"
        assert ds.validate() == [] and ds.consistency_errors() == []

    def test_frontier_block_is_not_a_dimension(self, tmp_path):
        scores, rationales = split_subscores_entry(_applied(tmp_path).subscores_for("Freedonia"))
        assert FRONTIER_KEY not in scores and FRONTIER_KEY not in (rationales or {})

    def test_held_frontier_lands_text_only(self, tmp_path):
        ds = dataset(tmp_path)
        ds.apply("Freedonia", ResearchResult.parse(raw("G")), TODAY)
        ds.apply_frontier("Freedonia", record("G"), TODAY, apply_score=False)
        assert ds.scores_row("Freedonia")["Frontier Track"] == ""
        assert ds.regulation_row("Freedonia")["Frontier Risk"] == "Frontier text."
        assert "frontierRisk" not in ds.history_for("Freedonia")[0]
        assert ds.consistency_errors() == []

    def test_main_apply_carries_the_lens(self, tmp_path):
        ds = _applied(tmp_path)
        changed = ResearchResult.parse(raw("G", policy_lever={
            "binding_instruments": sub(1), "soft_law": sub(1), "economic_tools": sub(1),
            "institutional_capacity": sub(1), "text": "Changed.",
        }))
        ds.apply("Freedonia", changed, NEXT_WEEK)
        assert ds.scores_row("Freedonia")["Frontier Track"] == "G"
        assert ds.regulation_row("Freedonia")["Frontier Sources"] == "https://example.gov/f"
        assert FRONTIER_KEY in ds.subscores_for("Freedonia")
        last = ds.history_for("Freedonia")[-1]
        assert last["date"] == NEXT_WEEK.isoformat() and last["frontierRisk"] == 3.0
        assert ds.consistency_errors() == []

    def test_frontier_move_alone_appends_a_copy_of_the_last_snapshot(self, tmp_path):
        ds = _applied(tmp_path)
        ds.apply("Freedonia", ResearchResult.parse(raw("G")), NEXT_WEEK)  # unchanged: no snapshot
        assert len(ds.history_for("Freedonia")) == 1
        ds.apply_frontier("Freedonia", record("G", {"incident_emergency_preparedness": 1}), NEXT_WEEK)
        snaps = ds.history_for("Freedonia")
        assert len(snaps) == 2
        assert snaps[1]["regulationStatus"] == snaps[0]["regulationStatus"]
        assert snaps[1]["frontierRisk"] == 2.0 and snaps[1]["date"] == NEXT_WEEK.isoformat()
        assert ds.consistency_errors() == []

    def test_same_day_frontier_amends_todays_snapshot(self, tmp_path):
        ds = _applied(tmp_path)
        ds.apply_frontier("Freedonia", record("G", {"incident_emergency_preparedness": 1}), TODAY)
        snaps = ds.history_for("Freedonia")
        assert len(snaps) == 1 and snaps[0]["frontierRisk"] == 2.0

    def test_validate_catches_a_bad_track(self, tmp_path):
        ds = _applied(tmp_path)
        ds.scores_row("Freedonia")["Frontier Track"] = "Z"
        assert any("Frontier Track" in e for e in ds.validate())

    def test_save_and_reload_round_trip(self, tmp_path):
        _applied(tmp_path).save()
        again = dataset(tmp_path)
        assert again.scores_row("Freedonia")["Frontier Risk"] == "3.0"
        assert again.consistency_errors() == []

    def test_frontier_pending_is_absent_until_used(self, tmp_path):
        ds = dataset(tmp_path)
        ds.set_frontier_pending("A", None)
        ds.save()
        pending = json.loads((tmp_path / "public" / "data" / "pending.json").read_text())
        assert "frontier_pending" not in pending


# -- the gate ---------------------------------------------------------------------


def _rows(score="3.0", track="G", sources="https://example.gov/f"):
    return (
        {"Frontier Risk": score, "Frontier Track": track},
        {"Frontier Sources": sources},
    )


class TestGate:
    def test_first_score_applies(self):
        decision = gate.decide_frontier({"Frontier Track": ""}, {}, record(), None, TODAY)
        assert decision.rule == gate.APPLIED_EVIDENCE and decision.apply_scores

    def test_track_change_applies(self):
        scores, reg = _rows(track="C")
        decision = gate.decide_frontier(scores, reg, record("G"), None, TODAY)
        assert decision.apply_scores and "track changed" in decision.reason

    def test_unchanged(self):
        scores, reg = _rows()
        assert gate.decide_frontier(scores, reg, record(), None, TODAY).rule == gate.UNCHANGED

    def test_new_frontier_source_is_evidence(self):
        scores, reg = _rows(score="2.0")
        decision = gate.decide_frontier(scores, reg, record(sources="https://new.example/law"), None, TODAY)
        assert decision.rule == gate.APPLIED_EVIDENCE
        assert decision.new_sources == ("https://new.example/law",)

    def test_seen_source_is_not_evidence(self):
        scores, reg = _rows(score="2.0", sources="")
        decision = gate.decide_frontier(
            scores, reg, record(), None, TODAY, seen_sources=frozenset({"example.gov/f"}),
        )
        assert decision.rule == gate.HELD and not decision.apply_scores
        assert decision.pending == {"candidate": 3.0, "track": "G", "first_seen": TODAY.isoformat()}

    def test_repeat_move_persists(self):
        scores, reg = _rows(score="2.0")
        pending = {"candidate": 2.5, "track": "G", "first_seen": TODAY.isoformat()}
        decision = gate.decide_frontier(scores, reg, record(), pending, NEXT_WEEK)
        assert decision.rule == gate.APPLIED_PERSISTED

    def test_move_to_insufficient_is_a_large_move(self):
        scores, reg = _rows(sources="https://example.gov/f")
        rec = record(scores={"incident_emergency_preparedness": None})
        decision = gate.decide_frontier(scores, reg, rec, None, TODAY)
        assert decision.rule == gate.HELD
        held = gate.decide_frontier(scores, reg, rec, decision.pending, NEXT_WEEK)
        assert held.rule == gate.APPLIED_PERSISTED and held.large_moves

    def test_ungated(self):
        scores, _ = _rows(score="2.0")
        assert gate.ungated_frontier(scores, record()).rule == gate.APPLIED_UNGATED
        assert gate.ungated_frontier({}, record()).rule == gate.APPLIED_EVIDENCE


# -- a service run ----------------------------------------------------------------


class _Answers:
    def __init__(self, answers):
        self._answers = answers

    def research(self, countries, reg_rows):
        yield from self._answers


def _run(tmp_path, answers, frontier, today=TODAY):
    ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
    svc = PipelineService(ds, StalenessPolicy(90, today), today, frontier=frontier)
    return svc.run(_Answers(answers), [c for c, _ in answers]), ds


class TestServiceRun:
    def test_five_dimensions_unchanged_by_the_lens(self, tmp_path):
        """PRD 15 acceptance: the implementation index and the five
        dimensions are the same with and without the lens."""
        countries = ("Aland", "Borduria", "Freedonia")
        tracks = {"Aland": "H", "Borduria": "C", "Freedonia": "G"}
        _, plain = _run(tmp_path / "a", [(c, ResearchResult.parse(raw(None))) for c in countries], None)
        result, lens = _run(
            tmp_path / "b", [(c, ResearchResult.parse(raw(tracks[c]))) for c in countries], context(),
        )
        for country in countries:
            before, after = plain.scores_row(country), lens.scores_row(country)
            for column in ("Regulation Status", "Policy Lever", "Governance Type",
                           "Actor Involvement", "Enforcement Level", "Average Score"):
                assert before[column] == after[column], (country, column)
            assert after["Frontier Track"] == tracks[country]
        assert set(result.raw_frontier) == set(countries)
        assert result.frontier_gate.counts[gate.APPLIED_EVIDENCE] == 3

    def test_no_global_country_is_scored_on_developer_obligations(self, tmp_path):
        result, ds = _run(tmp_path, [("Freedonia", ResearchResult.parse(raw("G")))], context())
        block = ds.subscores_for("Freedonia")[FRONTIER_KEY]
        assert block["developer_obligations"]["score"] == NA
        assert block["evaluation_oversight"]["score"] == NA

    def test_frontier_evidence_never_moves_the_five_dimensions(self, tmp_path):
        _run(tmp_path, [("Freedonia", ResearchResult.parse(raw("G")))], context())
        # Next week: a policy_lever move with no new main source, and a new
        # frontier source. The main move is held; the frontier move applies.
        moved = raw("G", 1, policy_lever={
            "binding_instruments": sub(1), "soft_law": sub(1), "economic_tools": sub(1),
            "institutional_capacity": sub(1), "text": "Changed.",
        })
        moved["frontier_risk"]["sources"] = "https://new.example/frontier"
        result, ds = _run(tmp_path, [("Freedonia", ResearchResult.parse(moved))], context(), NEXT_WEEK)
        assert result.gate.counts[gate.HELD] == 1
        assert result.frontier_gate.counts[gate.APPLIED_EVIDENCE] == 1
        assert float(ds.scores_row("Freedonia")["Policy Lever"]) == 3.0
        assert ds.scores_row("Freedonia")["Frontier Risk"] == 1.5
        assert ds.consistency_errors() == []

    def test_wrong_track_answer_leaves_the_lens_alone(self, tmp_path):
        result, ds = _run(tmp_path, [("Aland", ResearchResult.parse(raw("G")))], context())
        assert result.updated == 1  # the five dimensions still land
        assert ds.scores_row("Aland")["Frontier Track"] == ""

    def test_without_context_the_block_is_ignored(self, tmp_path):
        _, ds = _run(tmp_path, [("Freedonia", ResearchResult.parse(raw("G")))], None)
        assert ds.scores_row("Freedonia")["Frontier Track"] == ""


# -- the gold check ---------------------------------------------------------------


def _gold(frontier: dict | None) -> dict:
    entry = {
        "country": "Freedonia", "status": "draft",
        "subscores": {
            dim: {name: 3 for name in names}
            for dim, names in {
                "regulation_status": ("binding_force", "scope", "implementation", "ai_specificity"),
                "policy_lever": ("binding_instruments", "soft_law", "economic_tools", "institutional_capacity"),
                "governance_type": ("regulator_plurality", "formal_coordination", "subnational_role",
                                    "nongovernmental_checks"),
                "actor_involvement": ("industry", "civil_society", "academia", "international"),
                "enforcement_level": ("sanctions_framework", "actions_taken", "dedicated_authority",
                                      "monitoring_practice"),
            }.items()
        },
        "justification": {d: "J." for d in ("regulation_status", "policy_lever", "governance_type",
                                            "actor_involvement", "enforcement_level")},
        "sources": ["https://example.gov"],
    }
    if frontier is not None:
        entry["frontier"] = frontier
    return {"countries": [entry]}


FRONTIER_GOLD = {
    "status": "draft", "drafted_on": "2026-10-01", "track": "G",
    "subscores": {"incident_emergency_preparedness": 2},
    "justification": "J.", "sources": ["https://example.gov"],
}


class TestGold:
    def test_parses_a_frontier_block(self):
        gold = parse_gold_set(_gold(FRONTIER_GOLD))
        assert gold.frontier_names() == ["Freedonia"]

    def test_frontier_block_must_match_its_track(self):
        bad = {**FRONTIER_GOLD, "subscores": {"developer_obligations": 2}}
        with pytest.raises(ValueError, match="exactly"):
            parse_gold_set(_gold(bad))

    def test_signed_bias(self):
        gold = parse_gold_set(_gold(FRONTIER_GOLD))
        metrics = compare_frontier(gold, {"Freedonia": record("G", {"incident_emergency_preparedness": 4})})
        assert metrics.bias == 2.0 and metrics.mae == 2.0 and metrics.within_one == 0.0
        assert metrics.warning

    def test_other_track_is_missing_and_null_is_skipped(self):
        gold = parse_gold_set(_gold(FRONTIER_GOLD))
        assert compare_frontier(gold, {"Freedonia": record("C")}).missing == ("Freedonia",)
        skipped = compare_frontier(gold, {"Freedonia": record("G", {"incident_emergency_preparedness": None})})
        assert skipped.count == 0 and skipped.skipped == 1

    def test_no_frontier_gold_means_no_metrics(self):
        assert compare_frontier(parse_gold_set(_gold(None)), {"Freedonia": record()}) is None

    def test_drift_row_carries_the_frontier_block(self):
        gold = parse_gold_set(_gold(FRONTIER_GOLD))
        from regulation_pipeline.gold import compare

        metrics = compare(gold, {})
        frontier = compare_frontier(gold, {"Freedonia": record("G", {"incident_emergency_preparedness": 1})})
        row = drift_row(metrics, run_id="r", run_date=TODAY, model="m", prompt_version="p", frontier=frontier)
        assert row["frontier"]["bias"] == -1.0 and row["frontier"]["compared"] == 1


# -- the Supabase mirror ----------------------------------------------------------


class _UpsertClient:
    """Fails the first upsert to a table that carries the frontier columns,
    as a database without migration 0014 would."""

    def __init__(self, missing_columns: bool):
        self.missing_columns = missing_columns
        self.upserts: list[tuple[str, list[dict]]] = []

    def upsert(self, table, rows, on_conflict):
        from regulation_pipeline.db.client import SupabaseError

        if self.missing_columns and any(k.startswith("frontier_") for k in rows[0]):
            raise SupabaseError("column frontier_risk does not exist")
        self.upserts.append((table, rows))


class TestMirror:
    def test_frontier_columns(self):
        from regulation_pipeline.db.mirror import frontier_columns, frontier_summary_columns

        block = record("G").entry(TODAY)
        cols = frontier_columns({"Frontier Risk": "2.5", "Frontier Track": "G"}, {FRONTIER_KEY: block})
        assert cols == {"frontier_risk": 2.5, "frontier_track": "G", "frontier_subscores": block}
        assert frontier_columns({"Frontier Risk": "", "Frontier Track": ""}, {}) == {
            "frontier_risk": None, "frontier_track": None, "frontier_subscores": None,
        }
        assert frontier_summary_columns({"Frontier Risk": "", "Frontier Sources": "u"}) == {
            "frontier_risk_text": None, "frontier_sources_raw": "u",
        }

    @pytest.mark.parametrize("missing", [False, True])
    def test_rows_land_with_or_without_migration_0014(self, missing):
        from regulation_pipeline.db.mirror import _FRONTIER_SCORE_COLUMNS, SupabaseMirror

        client = _UpsertClient(missing)
        mirror = SupabaseMirror.__new__(SupabaseMirror)
        mirror._client = client
        rows = [{"country_id": "1", "avg_score": 3.0, **dict.fromkeys(_FRONTIER_SCORE_COLUMNS)}]
        mirror._upsert_with_fallback("country_scores", rows, _FRONTIER_SCORE_COLUMNS)
        (table, written), = client.upserts
        assert table == "country_scores"
        assert ("frontier_risk" in written[0]) is not missing
        assert written[0]["avg_score"] == 3.0
