"""Rubric v3.2: tighter anchors for the implementation dimensions.

The first v3.1 run (2026-09-28) gave 5s on the strength of one instrument,
counted US state statutes and general law applied to AI, and the prompt told
the model that leading jurisdictions reach 5 on most sub-indicators. These
tests pin the rules that replaced that.
"""

from __future__ import annotations

from regulation_pipeline.history import calibration_due
from regulation_pipeline.prompt import RESEARCH_PROMPT, RUBRIC_VERSION
from test_methodology_anchors import prompt_anchors, prompt_ladder

IMPLEMENTATION = ("regulation_status", "policy_lever", "enforcement_level")
STYLE = ("governance_type", "actor_involvement")


def _squashed() -> str:
    return " ".join(RESEARCH_PROMPT.split())


def test_no_relative_frontier_language():
    text = _squashed()
    assert "leading jurisdictions" not in text
    assert "perfection is not required" not in text


def test_a_five_needs_the_whole_anchor_and_deferral_caps_at_four():
    ladder = prompt_ladder()
    assert ladder["5"] == "every element of the sub-indicator's 5 anchor is in force, applicable and exercised."
    assert "caps the score at 4" in _squashed()
    assert "deferred" in ladder["4"]


def test_national_level_only():
    text = _squashed()
    assert "Score the national level only." in text
    assert "EU regulations and directives that apply in it count as its national law" in text
    assert "never raise a regulation_status, policy_lever or enforcement_level sub-indicator" in text


def test_general_law_and_narrow_rules_are_capped():
    text = _squashed()
    assert "General law with no provision written for AI" in text
    assert "scores at most 3 on binding_force and at most 2 on scope" in text


def test_implementation_subindicators_define_every_level():
    anchors = prompt_anchors()
    for dimension in IMPLEMENTATION:
        for key, levels in anchors[dimension].items():
            assert set(levels) == {"1", "2", "3", "4", "5"}, f"{dimension}.{key}"


def test_style_anchors_are_unchanged():
    # Governance style is descriptive: a 5 is a position, not an amount, so
    # v3.2 leaves its 1/3/5 anchors alone.
    anchors = prompt_anchors()
    for dimension in STYLE:
        for key, levels in anchors[dimension].items():
            assert set(levels) == {"1", "3", "5"}, f"{dimension}.{key}"


def test_the_guard_makes_v3_2_due_after_a_v3_1_break():
    june = {"date": "2026-06-13", "rubric": "v2", "reason": "v2"}
    v31 = {"date": "2026-09-28", "rubric": "v3.1", "reason": "v3.1", "complete": True}
    v32 = {"date": "2026-10-05", "rubric": "v3.2", "reason": "v3.2", "complete": True}
    assert RUBRIC_VERSION == "v3.2"
    assert calibration_due([june], RUBRIC_VERSION) is True
    assert calibration_due([june, v31], RUBRIC_VERSION) is True
    assert calibration_due([june, v31, v32], RUBRIC_VERSION) is False
