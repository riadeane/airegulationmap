from regulation_pipeline.processor import (
    build_regulation_row,
    build_scores_row,
    calculate_average_score,
    validate_result,
)


def full_result(**overrides):
    result = {
        "regulation_status_score": 4,
        "policy_lever_score": 3,
        "governance_type_score": 2,
        "actor_involvement_score": 3,
        "enforcement_level_score": 4,
        "regulation_status_text": "Comprehensive framework.",
        "confidence": "high",
        "sources": "https://example.gov/ai|https://example.gov/law",
    }
    result.update(overrides)
    return result


class TestValidateResult:
    def test_valid_result_passes(self):
        assert validate_result(full_result()) == []

    def test_missing_score_fails(self):
        result = full_result()
        del result["enforcement_level_score"]
        errors = validate_result(result)
        assert len(errors) == 1
        assert "enforcement_level_score" in errors[0]

    def test_out_of_range_and_wrong_type_fail(self):
        errors = validate_result(full_result(
            regulation_status_score=6,
            policy_lever_score=0,
            governance_type_score="3",
            actor_involvement_score=True,
        ))
        assert len(errors) == 4

    def test_none_score_fails(self):
        errors = validate_result(full_result(policy_lever_score=None))
        assert len(errors) == 1


class TestCalculateAverageScore:
    def test_averages_four_main_dimensions_excluding_enforcement(self):
        # (4 + 3 + 2 + 3) / 4 — enforcement (4) must not pull it up
        assert calculate_average_score(full_result()) == 3.0

    def test_ignores_missing_fields(self):
        assert calculate_average_score({"regulation_status_score": 5}) == 5.0

    def test_returns_none_with_no_scores(self):
        assert calculate_average_score({}) is None


class TestBuildScoresRow:
    def test_increments_version_and_stamps_date(self):
        row = build_scores_row("Germany", full_result(), 2, "2026-06-11")
        assert row["Data Version"] == 3
        assert row["Last Updated"] == "2026-06-11"
        assert row["Average Score"] == 3.0
        assert row["Enforcement Level"] == 4


class TestBuildRegulationRow:
    def test_keeps_confidence_when_sources_present(self):
        row = build_regulation_row("Germany", full_result(), "2026-06-11")
        assert row["Confidence"] == "high"
        assert row["Sources"].startswith("https://example.gov")

    def test_downgrades_confidence_without_sources(self):
        for empty in ("", "   ", None):
            row = build_regulation_row("X", full_result(sources=empty, confidence="high"), "2026-06-11")
            assert row["Confidence"] == "low"

    def test_defaults_confidence_to_medium_when_sourced(self):
        result = full_result()
        del result["confidence"]
        row = build_regulation_row("X", result, "2026-06-11")
        assert row["Confidence"] == "medium"
