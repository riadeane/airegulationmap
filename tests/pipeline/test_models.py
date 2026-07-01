import pytest
from conftest import full_result
from pydantic import ValidationError
from regulation_pipeline.models import ResearchResult


class TestValidation:
    def test_valid_result_parses(self):
        assert ResearchResult.model_validate(full_result()) is not None

    def test_missing_dimension_block_fails(self):
        result = full_result()
        del result["enforcement_level"]
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_missing_subscore_fails(self):
        result = full_result()
        del result["regulation_status"]["scope"]
        with pytest.raises(ValidationError) as exc:
            ResearchResult.model_validate(result)
        assert "regulation_status" in str(exc.value)

    def test_out_of_range_rejected(self):
        result = full_result()
        result["policy_lever"]["soft_law"] = 6
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_boolean_rejected(self):
        # bool is an int subclass; must not sneak through as 1.
        result = full_result()
        result["actor_involvement"]["industry"] = True
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_string_score_rejected(self):
        result = full_result()
        result["policy_lever"]["economic_tools"] = "3"
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_bad_confidence_rejected(self):
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(full_result(confidence="unknown"))

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(full_result(surprise="x"))


class TestScores:
    def test_dimension_scores_are_subscore_means(self):
        scores = ResearchResult.model_validate(full_result()).dimension_scores()
        assert scores["regulation_status"] == 4.0
        assert scores["policy_lever"] == 3.0
        assert scores["governance_type"] == 2.0
        assert scores["enforcement_level"] == 4.0

    def test_quarter_point_granularity(self):
        result = full_result()
        result["regulation_status"] = {
            "binding_force": 4, "scope": 3, "implementation": 3,
            "ai_specificity": 3, "text": "j",
        }
        model = ResearchResult.model_validate(result)
        assert model.regulation_status.score == 3.25

    def test_maturity_index_uses_only_normative_dimensions(self):
        # (regulation 4.0 + policy 3.0 + enforcement 4.0) / 3; descriptive dims
        # (governance 2.0, actors 3.0) excluded.
        assert ResearchResult.model_validate(full_result()).average_score() == 3.67


class TestConfidence:
    def test_keeps_confidence_when_sourced(self):
        assert ResearchResult.model_validate(full_result()).effective_confidence() == "high"

    def test_downgrades_to_low_without_sources(self):
        for empty in ("", "   "):
            model = ResearchResult.model_validate(full_result(sources=empty, confidence="high"))
            assert model.effective_confidence() == "low"


class TestOutputSchema:
    def test_schema_shape(self):
        schema = ResearchResult.output_schema()
        assert schema["additionalProperties"] is False
        assert "title" not in schema
        assert set(schema["required"]) == set(schema["properties"])

    def test_scores_are_integer_enums(self):
        # Structured outputs can't express minimum/maximum, so 1-5 is an enum.
        defs = ResearchResult.output_schema()["$defs"]
        block = defs["RegulationStatus"]
        assert block["additionalProperties"] is False
        assert block["properties"]["binding_force"] == {"enum": [1, 2, 3, 4, 5], "type": "integer"}

    def test_confidence_enum(self):
        schema = ResearchResult.output_schema()
        assert schema["properties"]["confidence"]["enum"] == ["high", "medium", "low"]
