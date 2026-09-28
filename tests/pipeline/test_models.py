import json

import pytest
from conftest import full_result
from pydantic import ValidationError
from regulation_pipeline.models import ResearchProvenance, ResearchResult


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
        result["policy_lever"]["soft_law"]["score"] = 6
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_boolean_rejected(self):
        # bool is an int subclass; must not sneak through as 1.
        result = full_result()
        result["actor_involvement"]["industry"]["score"] = True
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_string_score_rejected(self):
        result = full_result()
        result["policy_lever"]["economic_tools"]["score"] = "3"
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_bad_confidence_rejected(self):
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(full_result(confidence="unknown"))

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(full_result(surprise="x"))

    def test_bare_integer_subindicator_rejected(self):
        # The v2 shape (a bare int) is no longer a valid API response.
        result = full_result()
        result["regulation_status"]["scope"] = 3
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)


class TestRationale:
    def test_missing_rationale_fails(self):
        result = full_result()
        del result["regulation_status"]["scope"]["rationale"]
        with pytest.raises(ValidationError) as exc:
            ResearchResult.model_validate(result)
        assert "rationale" in str(exc.value)

    def test_overlong_rationale_is_shortened_not_rejected(self):
        # Failing one sentence would throw away the country's paid result.
        long = "The AI Act applies directly, " + "with obligations phased in over time " * 8
        result = full_result()
        result["enforcement_level"]["actions_taken"]["rationale"] = long
        kept = ResearchResult.model_validate(result).enforcement_level.actions_taken.rationale
        assert len(kept) <= 200
        assert kept.endswith("\u2026")
        assert long.startswith(kept[:-1])
        assert not kept[:-1].endswith(" ")

    def test_placeholder_sources_cap_confidence_and_are_dropped(self):
        model = ResearchResult.model_validate(full_result(sources="N/A", confidence="high"))
        assert model.confidence == "low"
        assert model.effective_confidence() == "low"
        mixed = ResearchResult.model_validate(
            full_result(sources="https://a.gov/x | - | https://b.org/y", confidence="high")
        )
        assert mixed.sources == "https://a.gov/x | https://b.org/y"
        assert mixed.confidence == "high"

    @pytest.mark.parametrize("bad", ["", "   "])
    def test_length_bounds(self, bad):
        result = full_result()
        result["enforcement_level"]["actions_taken"]["rationale"] = bad
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_trimmed_and_kept(self):
        result = full_result()
        result["policy_lever"]["soft_law"]["rationale"] = "  ISO/IEC 42001 adopted in 2024.  "
        model = ResearchResult.model_validate(result)
        assert model.policy_lever.soft_law.rationale == "ISO/IEC 42001 adopted in 2024."
        assert "x" * 200 == ResearchResult.model_validate(
            full_result(policy_lever={**result["policy_lever"], "soft_law": {"score": 3, "rationale": "x" * 200}})
        ).policy_lever.soft_law.rationale

    def test_rationales_projection_mirrors_subscores_keys(self):
        model = ResearchResult.model_validate(full_result())
        rationales = model.rationales()
        assert set(rationales) == set(model.dimension_scores())
        for key, dim in model.dimensions().items():
            assert set(rationales[key]) == set(dim.subscores())
            assert all(r == "Fact." for r in rationales[key].values())


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
            "binding_force": {"score": 4, "rationale": "f"},
            "scope": {"score": 3, "rationale": "f"},
            "implementation": {"score": 3, "rationale": "f"},
            "ai_specificity": {"score": 3, "rationale": "f"},
            "text": "j",
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

    def test_high_without_an_official_source_is_medium(self):
        # #93: "high" means primary sources; law firms and trackers alone
        # support "medium" at most.
        secondary = "https://cms.law/ai|https://www.twobirds.com/insights/ai"
        model = ResearchResult.model_validate(full_result(sources=secondary, confidence="high"))
        assert model.confidence == "medium"
        assert model.effective_confidence() == "medium"

    def test_one_official_source_keeps_high(self):
        mixed = "https://cms.law/ai|https://eur-lex.europa.eu/eli/reg/2024/1689/oj"
        model = ResearchResult.model_validate(full_result(sources=mixed, confidence="high"))
        assert model.effective_confidence() == "high"

    def test_medium_and_low_are_untouched_by_the_official_rule(self):
        secondary = "https://cms.law/ai"
        for level in ("medium", "low"):
            model = ResearchResult.model_validate(full_result(sources=secondary, confidence=level))
            assert model.effective_confidence() == level

    def test_downgrades_to_low_without_sources(self):
        for empty in ("", "   "):
            model = ResearchResult.model_validate(full_result(sources=empty, confidence="high"))
            assert model.effective_confidence() == "low"


def _with_nulls(dimension: str, *names: str, **overrides) -> dict:
    """``full_result`` with the named sub-indicators of ``dimension`` set to
    insufficient evidence (``score: null``)."""
    result = full_result(**overrides)
    for name in names:
        result[dimension][name] = {"score": None, "rationale": "Searched the gazette; nothing found."}
    return result


class TestInsufficientEvidence:
    """Rubric v3.1 (issue #162): a null sub-indicator score is insufficient
    evidence, never a 1."""

    def test_schema_accepts_null_score(self):
        result = ResearchResult.model_validate(_with_nulls("enforcement_level", "actions_taken"))
        assert result.enforcement_level.actions_taken.score is None
        assert result.enforcement_level.subscores()["actions_taken"] is None

    def test_null_needs_a_rationale(self):
        result = _with_nulls("enforcement_level", "actions_taken")
        result["enforcement_level"]["actions_taken"]["rationale"] = "  "
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_missing_score_key_still_fails(self):
        # null must be explicit: an absent score is a malformed answer.
        result = full_result()
        del result["enforcement_level"]["actions_taken"]["score"]
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(result)

    def test_one_null_is_the_mean_of_the_other_three(self):
        # enforcement 5, [4], 4, 3 -> mean of 5, 4, 3 = 4.0
        result = ResearchResult.model_validate(_with_nulls("enforcement_level", "actions_taken"))
        assert result.enforcement_level.score == 4.0
        # policy 3, 3, [2], 4 -> 3.33
        result = ResearchResult.model_validate(_with_nulls("policy_lever", "economic_tools"))
        assert result.policy_lever.score == 3.33

    def test_two_nulls_leave_the_dimension_unscored(self):
        result = ResearchResult.model_validate(
            _with_nulls("enforcement_level", "actions_taken", "monitoring_practice"),
        )
        assert result.enforcement_level.score is None
        assert result.dimension_scores()["enforcement_level"] is None

    def test_composite_skips_one_unscored_normative_dimension(self):
        # regulation 4.0, policy 3.0, enforcement None -> (4 + 3) / 2
        result = ResearchResult.model_validate(
            _with_nulls("enforcement_level", "actions_taken", "monitoring_practice"),
        )
        assert result.average_score() == 3.5

    def test_composite_needs_two_normative_dimensions(self):
        result = _with_nulls("enforcement_level", "actions_taken", "monitoring_practice")
        result["policy_lever"]["soft_law"] = {"score": None, "rationale": "Nothing found."}
        result["policy_lever"]["economic_tools"] = {"score": None, "rationale": "Nothing found."}
        model = ResearchResult.model_validate(result)
        assert model.policy_lever.score is None
        assert model.average_score() is None

    def test_descriptive_dimension_does_not_affect_composite(self):
        result = ResearchResult.model_validate(
            _with_nulls("governance_type", "regulator_plurality", "subnational_role"),
        )
        assert result.governance_type.score is None
        assert result.average_score() == 3.67

    def test_unscored_dimension_caps_confidence_low(self):
        result = ResearchResult.model_validate(
            _with_nulls("actor_involvement", "industry", "academia", confidence="high"),
        )
        assert result.confidence == "low"
        assert result.effective_confidence() == "low"

    def test_one_null_keeps_confidence(self):
        result = ResearchResult.model_validate(
            _with_nulls("actor_involvement", "industry", confidence="high"),
        )
        assert result.effective_confidence() == "high"

    def test_format_score(self):
        from regulation_pipeline.models import format_score

        assert format_score(None) == "insufficient evidence"
        assert format_score(2.5) == "2.5"


class TestOutputSchema:
    def test_schema_shape(self):
        schema = ResearchResult.output_schema()
        assert schema["additionalProperties"] is False
        assert "title" not in schema
        assert set(schema["required"]) == set(schema["properties"])

    def test_scores_are_integer_enums_or_null(self):
        # Structured outputs can't express minimum/maximum, so 1-5 is an enum;
        # null (insufficient evidence, rubric v3.1) is the other anyOf branch.
        defs = ResearchResult.output_schema()["$defs"]
        block = defs["RegulationStatus"]
        assert block["additionalProperties"] is False
        assert block["properties"]["binding_force"] == {"$ref": "#/$defs/SubIndicator"}
        assert defs["SubIndicator"]["properties"]["score"] == {
            "anyOf": [{"enum": [1, 2, 3, 4, 5], "type": "integer"}, {"type": "null"}],
        }
        # The score stays required: the model must choose a level or null.
        assert set(defs["SubIndicator"]["required"]) == {"score", "rationale"}

    def test_rationale_required_and_unconstrained_in_schema(self):
        # Structured outputs reject minLength/maxLength - the length rule
        # lives in pydantic, so the schema must say only "string".
        sub = ResearchResult.output_schema()["$defs"]["SubIndicator"]
        assert set(sub["required"]) == {"score", "rationale"}
        assert sub["additionalProperties"] is False
        assert sub["properties"]["rationale"] == {"type": "string"}

    def test_confidence_enum(self):
        schema = ResearchResult.output_schema()
        assert schema["properties"]["confidence"]["enum"] == ["high", "medium", "low"]


class TestProvenance:
    """PRD 14: the request facts ride on the result without touching the
    answer contract."""

    def test_not_in_output_schema(self):
        schema = ResearchResult.output_schema()
        assert set(schema["properties"]) == {
            "regulation_status", "policy_lever", "governance_type", "actor_involvement",
            "enforcement_level", "specific_laws", "sources", "confidence",
        }
        assert "provenance" not in json.dumps(schema)

    @pytest.mark.parametrize("key", ["provenance", "_provenance"])
    def test_answer_cannot_set_provenance(self, key):
        raw = full_result(**{key: {"initiatives_used": 15, "search": True, "model": "x"}})
        with pytest.raises(ValidationError):
            ResearchResult.model_validate(raw)

    def test_defaults_to_none_and_attaches(self):
        result = ResearchResult.model_validate(full_result())
        assert result.provenance is None
        provenance = ResearchProvenance(initiatives_used=7, search=True, model="claude-x")
        assert result.with_provenance(provenance) is result
        assert result.provenance == provenance
        # Not part of the answer: dumping the result never carries it.
        assert "provenance" not in result.model_dump()

    @pytest.mark.parametrize(("used", "grounded"), [(None, False), (0, False), (1, True), (15, True)])
    def test_grounded_is_derived_from_the_count(self, used, grounded):
        provenance = ResearchProvenance(initiatives_used=used, search=False, model="m")
        assert provenance.grounded is grounded
        assert provenance.record("run-1") == {
            "grounded": grounded, "initiatives_used": used, "search": False,
            "model": "m", "run_id": "run-1",
        }
