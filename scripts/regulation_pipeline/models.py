"""Typed domain models for one country's AI-regulation research result.

These pydantic models are the single source of truth for the pipeline's core
data shape. They drive three things that previously drifted apart across
modules:

1. **Structured-output schema** — ``ResearchResult.output_schema()`` generates
   the JSON schema handed to the Claude API (``output_config.format``), so the
   API constrains responses to exactly these fields.
2. **Validation** — ``ResearchResult.model_validate()`` replaces the hand-rolled
   ``validate_result``; a malformed response raises instead of silently landing
   an empty cell in the CSV.
3. **Projection** — the model knows how to compute its own dimension scores,
   maturity composite, sub-score audit entry, and history snapshot.

Methodology v2 (2026-06): each of the five dimensions is scored through four
named sub-indicators (integers 1-5); the dimension score is their mean, giving
quarter-point decimals. The composite "average" is a maturity index over the
three *normative* dimensions only — ``governance_type`` and ``actor_involvement``
are descriptive scales and are excluded. See ``public/methodology.html``.
"""

from __future__ import annotations

from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict


def _reject_bool(value: Any) -> Any:
    """Booleans are ``int`` subclasses in Python (``True == 1``), so a plain
    ``Literal[1..5]`` would accept ``True`` as ``1``. Reject them explicitly to
    match the old validator's strictness."""
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid 1-5 score")
    return value


# An integer sub-indicator score. Rendered as ``{"type": "integer",
# "enum": [1,2,3,4,5]}`` in the output schema — structured outputs don't support
# minimum/maximum, so the 1-5 range is an enum.
Score = Annotated[Literal[1, 2, 3, 4, 5], BeforeValidator(_reject_bool)]
Confidence = Literal["high", "medium", "low"]

_STRICT: ConfigDict = ConfigDict(extra="forbid")


class Dimension(BaseModel):
    """A scored dimension: four named sub-indicators plus a ``text``
    justification. Concrete subclasses name the sub-indicators as ``Score``
    fields; the dimension score is their mean. ``text`` is always last."""

    model_config = _STRICT

    # Snake_case key used in scores/history projections, e.g. ``regulation_status``.
    key: ClassVar[str]
    # CamelCase key used in the history snapshot JSON, e.g. ``regulationStatus``.
    history_key: ClassVar[str]
    # Whether this dimension counts toward the maturity composite.
    normative: ClassVar[bool] = True

    @classmethod
    def subindicators(cls) -> tuple[str, ...]:
        """The four sub-indicator field names, in declaration order."""
        return tuple(name for name in cls.model_fields if name != "text")

    def subscores(self) -> dict[str, int]:
        return {name: getattr(self, name) for name in self.subindicators()}

    @property
    def score(self) -> float:
        """Dimension score = mean of the four sub-indicators, to 2 decimals."""
        values = list(self.subscores().values())
        return round(sum(values) / len(values), 2)


class RegulationStatus(Dimension):
    key = "regulation_status"
    history_key = "regulationStatus"
    binding_force: Score
    scope: Score
    implementation: Score
    ai_specificity: Score
    text: str


class PolicyLever(Dimension):
    key = "policy_lever"
    history_key = "policyLever"
    binding_instruments: Score
    soft_law: Score
    economic_tools: Score
    institutional_capacity: Score
    text: str


class GovernanceType(Dimension):
    key = "governance_type"
    history_key = "governanceType"
    normative = False  # descriptive scale — excluded from the composite
    regulator_plurality: Score
    formal_coordination: Score
    subnational_role: Score
    nongovernmental_checks: Score
    text: str


class ActorInvolvement(Dimension):
    key = "actor_involvement"
    history_key = "actorInvolvement"
    normative = False  # descriptive scale — excluded from the composite
    industry: Score
    civil_society: Score
    academia: Score
    international: Score
    text: str


class EnforcementLevel(Dimension):
    key = "enforcement_level"
    history_key = "enforcementLevel"
    sanctions_framework: Score
    actions_taken: Score
    dedicated_authority: Score
    monitoring_practice: Score
    text: str


class ResearchResult(BaseModel):
    """The full research answer for one country: five scored dimensions plus
    named laws, sources, and self-reported confidence."""

    model_config = _STRICT

    regulation_status: RegulationStatus
    policy_lever: PolicyLever
    governance_type: GovernanceType
    actor_involvement: ActorInvolvement
    enforcement_level: EnforcementLevel
    specific_laws: str
    sources: str
    confidence: Confidence

    # Declaration order = the order dimensions appear everywhere downstream.
    DIMENSIONS: ClassVar[tuple[type[Dimension], ...]] = (
        RegulationStatus,
        PolicyLever,
        GovernanceType,
        ActorInvolvement,
        EnforcementLevel,
    )

    def dimensions(self) -> dict[str, Dimension]:
        """Map ``dimension key -> Dimension instance`` in canonical order."""
        return {dim.key: getattr(self, dim.key) for dim in self.DIMENSIONS}

    def dimension_scores(self) -> dict[str, float]:
        """Map ``dimension key -> mean sub-indicator score``."""
        return {key: dim.score for key, dim in self.dimensions().items()}

    def average_score(self) -> float:
        """Maturity index: mean of the normative dimension scores
        (regulation_status, policy_lever, enforcement_level), to 2 decimals."""
        scores = [dim.score for dim in self.dimensions().values() if dim.normative]
        return round(sum(scores) / len(scores), 2)

    def effective_confidence(self) -> Confidence:
        """Unsourced claims are not citable — cap confidence at "low" so the UI
        flags them and staleness re-researches them."""
        return self.confidence if self.sources.strip() else "low"

    @classmethod
    def output_schema(cls) -> dict[str, Any]:
        """JSON schema for structured outputs (``output_config.format``).

        Derived from the models so the sub-indicator field names are defined in
        exactly one place. ``$title`` annotations pydantic adds are stripped to
        keep the schema minimal; the shape (``enum`` scores, ``additionalProperties:
        false``, every field ``required``) matches what the API expects.
        """
        return _strip_titles(cls.model_json_schema())


def _strip_titles(node: Any) -> Any:
    """Recursively drop pydantic's ``title`` keys from a generated schema."""
    if isinstance(node, dict):
        node.pop("title", None)
        for value in node.values():
            _strip_titles(value)
    elif isinstance(node, list):
        for value in node:
            _strip_titles(value)
    return node
