"""The post-run EU consistency check (consistency.py, #95)."""

from __future__ import annotations

import json

from regulation_pipeline.config import Settings
from regulation_pipeline.consistency import eu_members, eu_outliers, log_lines, markdown_summary


def entry(binding_force, ai_specificity, *, v21=True):
    def cell(score):
        return {"score": score, "rationale": "Fact."} if v21 else score

    return {
        "date": "2026-09-28",
        "regulation_status": {
            "binding_force": cell(binding_force), "scope": cell(5),
            "implementation": cell(3), "ai_specificity": cell(ai_specificity),
        },
    }


def doc(**countries):
    return {"schema_version": 1, "countries": countries}


def test_lists_members_that_differ_from_the_mode():
    subscores = doc(
        Austria=entry(5, 5), Belgium=entry(5, 5), Czechia=entry(4, 5, v21=False),
        Germany=entry(3, None), Norway=entry(1, 1),
    )
    [binding, specificity] = eu_outliers(subscores, ["Austria", "Belgium", "Czechia", "Germany", "France"])
    assert (binding.subindicator, binding.mode, binding.differ) == ("binding_force", 5, {"Czechia": 4, "Germany": 3})
    assert (specificity.mode, specificity.differ) == (5, {"Germany": None})
    lines = log_lines([binding, specificity])
    assert lines[0] == "eu: binding_force is 5 for most members; differs: Czechia 4, Germany 3"
    assert lines[1].endswith("Germany insufficient evidence")
    assert "| `regulation_status.binding_force` | 5 | Czechia (4), Germany (3) |" in markdown_summary(
        [binding, specificity],
    )


def test_agreement_reports_nothing():
    subscores = doc(Austria=entry(5, 5), Belgium=entry(5, 5))
    assert eu_outliers(subscores, ["Austria", "Belgium"]) == []
    assert markdown_summary([]) == ""


def test_a_tie_has_no_mode():
    subscores = doc(Austria=entry(5, 5), Belgium=entry(4, 5))
    [binding] = eu_outliers(subscores, ["Austria", "Belgium"])
    assert binding.mode is None
    assert "no single most common score" in log_lines([binding])[0]


def test_reads_the_eu_members_from_blocs_json(tmp_path):
    settings = Settings(root=tmp_path)
    settings.blocs_json.parent.mkdir(parents=True)
    settings.blocs_json.write_text(json.dumps({"EU": {"name": "European Union", "members": ["Austria"]}}))
    assert eu_members(settings.blocs_json) == ["Austria"]
    assert eu_members(tmp_path / "missing.json") == []


def test_the_committed_blocs_file_lists_27_members():
    assert len(eu_members(Settings().blocs_json)) == 27
