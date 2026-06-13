from regulation_pipeline.processor import (
    SUBSCORE_FIELDS,
    build_regulation_row,
    build_scores_row,
    build_subscores_entry,
    calculate_average_score,
    flatten_result,
    validate_result,
)


def dim_block(values, text="Justification."):
    """Build a sub-indicator block for a dimension from 4 values."""
    return dict(values, text=text)


def full_result(**overrides):
    result = {
        "regulation_status": dim_block(
            {"binding_force": 4, "scope": 3, "implementation": 4, "ai_specificity": 5}
        ),  # mean 4.0
        "policy_lever": dim_block(
            {"binding_instruments": 3, "soft_law": 3, "economic_tools": 2, "institutional_capacity": 4}
        ),  # mean 3.0
        "governance_type": dim_block(
            {"regulator_plurality": 2, "formal_coordination": 3, "subnational_role": 1, "nongovernmental_checks": 2}
        ),  # mean 2.0
        "actor_involvement": dim_block(
            {"industry": 4, "civil_society": 2, "academia": 3, "international": 3}
        ),  # mean 3.0
        "enforcement_level": dim_block(
            {"sanctions_framework": 5, "actions_taken": 4, "dedicated_authority": 4, "monitoring_practice": 3}
        ),  # mean 4.0
        "specific_laws": "AI Act (2024)",
        "sources": "https://example.gov/ai|https://example.gov/law",
        "confidence": "high",
    }
    result.update(overrides)
    return result


class TestValidateResult:
    def test_valid_result_passes(self):
        assert validate_result(full_result()) == []

    def test_missing_dimension_block_fails(self):
        result = full_result()
        del result["enforcement_level"]
        errors = validate_result(result)
        assert errors == ["enforcement_level missing or not an object"]

    def test_missing_subscore_fails(self):
        result = full_result()
        del result["regulation_status"]["scope"]
        errors = validate_result(result)
        assert len(errors) == 1
        assert "regulation_status.scope" in errors[0]

    def test_out_of_range_and_wrong_type_fail(self):
        result = full_result()
        result["policy_lever"]["soft_law"] = 6
        result["policy_lever"]["economic_tools"] = "3"
        result["actor_involvement"]["industry"] = True
        result["actor_involvement"]["academia"] = None
        assert len(validate_result(result)) == 4


class TestFlattenResult:
    def test_dimension_scores_are_subscore_means(self):
        flat = flatten_result(full_result())
        assert flat["regulation_status_score"] == 4.0
        assert flat["policy_lever_score"] == 3.0
        assert flat["governance_type_score"] == 2.0
        assert flat["enforcement_level_score"] == 4.0

    def test_quarter_point_granularity(self):
        result = full_result()
        result["regulation_status"] = dim_block(
            {"binding_force": 4, "scope": 3, "implementation": 3, "ai_specificity": 3}
        )
        assert flatten_result(result)["regulation_status_score"] == 3.25

    def test_carries_text_and_metadata(self):
        flat = flatten_result(full_result())
        assert flat["regulation_status_text"] == "Justification."
        assert flat["confidence"] == "high"
        assert flat["specific_laws"] == "AI Act (2024)"


class TestCalculateAverageScore:
    def test_maturity_index_uses_only_normative_dimensions(self):
        flat = flatten_result(full_result())
        # (regulation 4.0 + policy 3.0 + enforcement 4.0) / 3 — the
        # descriptive dims (governance 2.0, actors 3.0) must not count.
        assert calculate_average_score(flat) == 3.67

    def test_returns_none_with_no_scores(self):
        assert calculate_average_score({}) is None


class TestBuildScoresRow:
    def test_increments_version_and_stamps_date(self):
        flat = flatten_result(full_result())
        row = build_scores_row("Germany", flat, 2, "2026-06-11")
        assert row["Data Version"] == 3
        assert row["Last Updated"] == "2026-06-11"
        assert row["Average Score"] == 3.67
        assert row["Enforcement Level"] == 4.0


class TestBuildRegulationRow:
    def test_keeps_confidence_when_sources_present(self):
        row = build_regulation_row("Germany", flatten_result(full_result()), "2026-06-11")
        assert row["Confidence"] == "high"
        assert row["Sources"].startswith("https://example.gov")

    def test_downgrades_confidence_without_sources(self):
        for empty in ("", "   ", None):
            flat = flatten_result(full_result(sources=empty, confidence="high"))
            row = build_regulation_row("X", flat, "2026-06-11")
            assert row["Confidence"] == "low"

    def test_defaults_confidence_to_medium_when_sourced(self):
        result = full_result()
        del result["confidence"]
        row = build_regulation_row("X", flatten_result(result), "2026-06-11")
        assert row["Confidence"] == "medium"


class TestBuildSubscoresEntry:
    def test_records_every_subscore_with_date(self):
        entry = build_subscores_entry(full_result(), "2026-06-11")
        assert entry["date"] == "2026-06-11"
        for dim, subs in SUBSCORE_FIELDS.items():
            assert set(entry[dim].keys()) == set(subs)
        assert entry["regulation_status"]["ai_specificity"] == 5


class TestBuildOutputSchema:
    def test_schema_covers_every_dimension_and_subscore(self):
        from regulation_pipeline.processor import build_output_schema

        schema = build_output_schema()
        assert schema["additionalProperties"] is False
        for dim, subs in SUBSCORE_FIELDS.items():
            block = schema["properties"][dim]
            assert block["additionalProperties"] is False
            assert set(block["required"]) == set(subs) | {"text"}
            for sub in subs:
                assert block["properties"][sub] == {"type": "integer", "enum": [1, 2, 3, 4, 5]}
        assert schema["properties"]["confidence"]["enum"] == ["high", "medium", "low"]
        assert set(schema["required"]) == set(schema["properties"])
