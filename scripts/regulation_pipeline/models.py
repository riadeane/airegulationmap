"""Typed domain models for one country's AI-regulation research result.

These pydantic models are the single source of truth for the pipeline's core
data shape. They drive three things that previously drifted apart across
modules:

1. **Structured-output schema** - ``ResearchResult.output_schema()`` generates
   the JSON schema handed to the Claude API (``output_config.format``), so the
   API constrains responses to exactly these fields.
2. **Validation** - ``ResearchResult.model_validate()`` replaces the hand-rolled
   ``validate_result``; a malformed response raises instead of silently landing
   an empty cell in the CSV.
3. **Projection** - the model knows how to compute its own dimension scores,
   maturity composite, sub-score audit entry, and history snapshot.

Methodology v2 (2026-06): each of the five dimensions is scored through four
named sub-indicators (integers 1-5); the dimension score is their mean, giving
quarter-point decimals. The composite "average" is a maturity index over the
three *normative* dimensions only - ``governance_type`` and ``actor_involvement``
are descriptive scales and are excluded. See ``public/methodology.html``.

Methodology v2.1 (2026-09): every sub-indicator carries a one-sentence
``rationale`` that states the fact the score rests on, so a reader can check a
score without repeating the research.

Evidence coverage (PRD 14): a validated result can carry a
:class:`ResearchProvenance` - how many verified policy initiatives the prompt
embedded, whether the model had web search, and the model id. It is attached
by the strategy from the request it sent, never parsed from the model's answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, ClassVar, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    PrivateAttr,
    model_validator,
)

# Tag written to subscores.json and bumped whenever the audit-trail shape
# changes. v2 = integer sub-scores; v2.1 = ``{score, rationale}`` per sub-indicator.
METHODOLOGY_VERSION = "v2.1"

# Rationale length bounds. Enforced here, not in the output schema: structured
# outputs reject ``minLength``/``maxLength``, so the schema says only ``string``.
RATIONALE_MIN_CHARS = 1
RATIONALE_MAX_CHARS = 200


def _reject_bool(value: Any) -> Any:
    """Booleans are ``int`` subclasses in Python (``True == 1``), so a plain
    ``Literal[1..5]`` would accept ``True`` as ``1``. Reject them explicitly to
    match the old validator's strictness."""
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid 1-5 score")
    return value


# An integer sub-indicator score. Rendered as ``{"type": "integer",
# "enum": [1,2,3,4,5]}`` in the output schema - structured outputs don't support
# minimum/maximum, so the 1-5 range is an enum.
Score = Annotated[Literal[1, 2, 3, 4, 5], BeforeValidator(_reject_bool)]
Confidence = Literal["high", "medium", "low"]

_STRICT: ConfigDict = ConfigDict(extra="forbid")


def _check_rationale(value: str) -> str:
    """One sentence, 1-200 characters after trimming. A blank rationale is a
    missing rationale; an over-long one is an explanation, not a fact."""
    value = value.strip()
    if not RATIONALE_MIN_CHARS <= len(value) <= RATIONALE_MAX_CHARS:
        raise ValueError(
            f"rationale must be {RATIONALE_MIN_CHARS}-{RATIONALE_MAX_CHARS} characters, got {len(value)}"
        )
    return value


Rationale = Annotated[str, AfterValidator(_check_rationale)]


class SubIndicator(BaseModel):
    """One scored sub-indicator: the integer score and the single fact that
    justifies it."""

    model_config = _STRICT

    score: Score
    rationale: Rationale


class Dimension(BaseModel):
    """A scored dimension: four named sub-indicators plus a ``text``
    justification. Concrete subclasses name the sub-indicators as
    ``SubIndicator`` fields; the dimension score is the mean of their scores.
    ``text`` is always last."""

    model_config = _STRICT

    # Snake_case key used in scores/history projections, e.g. ``regulation_status``.
    key: ClassVar[str]
    # CamelCase key used in the history snapshot JSON, e.g. ``regulationStatus``.
    history_key: ClassVar[str]
    # Column header in scores.csv / regulation_data.csv, e.g. ``Regulation Status``.
    column: ClassVar[str]
    # Whether this dimension counts toward the maturity composite.
    normative: ClassVar[bool] = True

    @classmethod
    def subindicators(cls) -> tuple[str, ...]:
        """The four sub-indicator field names, in declaration order."""
        return tuple(name for name in cls.model_fields if name != "text")

    def subscores(self) -> dict[str, int]:
        """Map ``sub-indicator name -> integer score``."""
        return {name: getattr(self, name).score for name in self.subindicators()}

    def rationales(self) -> dict[str, str]:
        """Map ``sub-indicator name -> rationale sentence``."""
        return {name: getattr(self, name).rationale for name in self.subindicators()}

    @property
    def score(self) -> float:
        """Dimension score = mean of the four sub-indicators, to 2 decimals."""
        values = list(self.subscores().values())
        return round(sum(values) / len(values), 2)


class RegulationStatus(Dimension):
    key = "regulation_status"
    history_key = "regulationStatus"
    column = "Regulation Status"
    binding_force: SubIndicator
    scope: SubIndicator
    implementation: SubIndicator
    ai_specificity: SubIndicator
    text: str


class PolicyLever(Dimension):
    key = "policy_lever"
    history_key = "policyLever"
    column = "Policy Lever"
    binding_instruments: SubIndicator
    soft_law: SubIndicator
    economic_tools: SubIndicator
    institutional_capacity: SubIndicator
    text: str


class GovernanceType(Dimension):
    key = "governance_type"
    history_key = "governanceType"
    column = "Governance Type"
    normative = False  # descriptive scale - excluded from the composite
    regulator_plurality: SubIndicator
    formal_coordination: SubIndicator
    subnational_role: SubIndicator
    nongovernmental_checks: SubIndicator
    text: str


class ActorInvolvement(Dimension):
    key = "actor_involvement"
    history_key = "actorInvolvement"
    column = "Actor Involvement"
    normative = False  # descriptive scale - excluded from the composite
    industry: SubIndicator
    civil_society: SubIndicator
    academia: SubIndicator
    international: SubIndicator
    text: str


class EnforcementLevel(Dimension):
    key = "enforcement_level"
    history_key = "enforcementLevel"
    column = "Enforcement Level"
    sanctions_framework: SubIndicator
    actions_taken: SubIndicator
    dedicated_authority: SubIndicator
    monitoring_practice: SubIndicator
    text: str


@dataclass(frozen=True)
class ResearchProvenance:
    """How one country was researched: the facts of the request, not of the
    answer.

    ``initiatives_used`` is the number of verified policy initiatives the
    prompt embedded (capped at ``prompt.MAX_GROUNDED_INITIATIVES``). ``0``
    means the run consulted the evidence database and it held none for the
    country; ``None`` means the run had no evidence provider, so nothing was
    consulted. The frontend relies on that difference to never claim "no
    verified initiatives on record" when the run simply did not look.
    """

    initiatives_used: int | None
    search: bool
    model: str

    @property
    def grounded(self) -> bool:
        """The prompt embedded at least one initiative. Always derived from
        the count, so the two can never disagree."""
        return (self.initiatives_used or 0) > 0

    def record(self, run_id: str) -> dict[str, Any]:
        """The ``evidence`` block written into the country's subscores.json
        entry: ``{grounded, initiatives_used, search, model, run_id}``."""
        return {
            "grounded": self.grounded,
            "initiatives_used": self.initiatives_used,
            "search": self.search,
            "model": self.model,
            "run_id": run_id,
        }


class ResearchResult(BaseModel):
    """The full research answer for one country: five scored dimensions plus
    named laws, sources, and self-reported confidence."""

    model_config = _STRICT

    # How the answer was obtained (PRD 14). A private attribute: it stays out
    # of ``output_schema()`` and no key in the model's JSON answer can set it.
    # The strategy attaches it with ``with_provenance`` after validation.
    _provenance: ResearchProvenance | None = PrivateAttr(default=None)

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

    @property
    def provenance(self) -> ResearchProvenance | None:
        """The request facts behind this answer, or ``None`` when none were
        attached (a result validated outside a strategy)."""
        return self._provenance

    def with_provenance(self, provenance: ResearchProvenance | None) -> ResearchResult:
        """Attach ``provenance`` and return this result (for chaining)."""
        self._provenance = provenance
        return self

    def dimensions(self) -> dict[str, Dimension]:
        """Map ``dimension key -> Dimension instance`` in canonical order."""
        return {dim.key: getattr(self, dim.key) for dim in self.DIMENSIONS}

    def dimension_scores(self) -> dict[str, float]:
        """Map ``dimension key -> mean sub-indicator score``."""
        return {key: dim.score for key, dim in self.dimensions().items()}

    def rationales(self) -> dict[str, dict[str, str]]:
        """Map ``dimension key -> {sub-indicator name -> rationale}``."""
        return {key: dim.rationales() for key, dim in self.dimensions().items()}

    def average_score(self) -> float:
        """Maturity index: mean of the normative dimension scores
        (regulation_status, policy_lever, enforcement_level), to 2 decimals."""
        scores = [dim.score for dim in self.dimensions().values() if dim.normative]
        return round(sum(scores) / len(scores), 2)

    @model_validator(mode="after")
    def _cap_unsourced_confidence(self) -> ResearchResult:
        """Keep the model self-consistent with :meth:`effective_confidence`.
        An unsourced claim is not citable, so it cannot carry more than "low"
        confidence - enforce that at validation time, not only on write, so an
        in-memory result never advertises a confidence its sources don't
        support. (Using ``object.__setattr__`` to avoid re-triggering validation.)"""
        if self.confidence != "low" and not self.sources.strip():
            object.__setattr__(self, "confidence", "low")
        return self

    def effective_confidence(self) -> Confidence:
        """Unsourced claims are not citable - cap confidence at "low" so the UI
        flags them and staleness re-researches them. The model validator above
        already applies this, so this is now a stable, idempotent accessor."""
        return self.confidence if self.sources.strip() else "low"

    @classmethod
    def output_schema(cls) -> dict[str, Any]:
        """JSON schema for structured outputs (``output_config.format``).

        Derived from the models so the sub-indicator field names are defined in
        exactly one place. ``$title`` annotations pydantic adds are stripped to
        keep the schema minimal; the shape (``enum`` scores, ``additionalProperties:
        false``, every field ``required``) matches what the API expects.
        """
        return strip_titles(cls.model_json_schema())


def strip_titles(node: Any) -> Any:
    """Recursively drop pydantic's ``title`` keys from a generated schema."""
    if isinstance(node, dict):
        node.pop("title", None)
        for value in node.values():
            strip_titles(value)
    elif isinstance(node, list):
        for value in node:
            strip_titles(value)
    return node
