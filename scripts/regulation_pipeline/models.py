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

Rubric v3.1 (2026-09, issue #162): a sub-indicator score may be ``None``,
meaning *insufficient evidence*: no source the model found confirms either
the presence or the absence of what the sub-indicator asks about. It is not a
1 (a 1 is a verified absence). The rationale then says what was searched. A
dimension with two or more insufficient sub-indicators has no score, the
composite needs two of its three normative dimensions, and any unscored
dimension caps confidence at "low".

Evidence coverage (PRD 14): a validated result can carry a
:class:`ResearchProvenance` - how many verified policy initiatives the prompt
embedded, whether the model had web search, and the model id. It is attached
by the strategy from the request it sent, never parsed from the model's answer.

Frontier Risk Governance (PRD 15): a seventh, separately presented lens. A
country sits on one track (``H`` frontier host, ``C`` compute or chokepoint,
``G`` global), assigned by the maintainer in ``frontier_tracks.json``. The
research answer for a country carries a ``frontier_risk`` block holding only
the sub-indicators its track asks the model to research
(:class:`FrontierAnswerH` / ``C`` / ``G``); ``international_coordination`` is
computed from public lists (:mod:`frontier`), and the rest are ``"na"``. The
assembled :class:`FrontierRecord` scores the lens: the mean of the applicable
sub-indicators capped at the lowest plus one, or ``None`` when any of them is
insufficient evidence. It never enters the composite.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, ClassVar, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    PrivateAttr,
    model_validator,
)

logger = logging.getLogger(__name__)

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

# A dimension needs at least this many numeric sub-indicators (of four) to
# carry a score; with fewer it is "insufficient evidence" (``None``).
MIN_SCORED_SUBINDICATORS = 3
# The maturity composite needs at least this many of its three normative
# dimensions scored; with fewer it is ``None``.
MIN_SCORED_NORMATIVE = 2

# How a ``None`` score reads in logs, the step summary and the digest prompt.
INSUFFICIENT_EVIDENCE = "insufficient evidence"


def format_score(value: float | None) -> str:
    """A score for the run log and step summary: the number as Python prints
    it (``2.5``, ``4.0``) or "insufficient evidence" for ``None``."""
    return INSUFFICIENT_EVIDENCE if value is None else str(value)

_STRICT: ConfigDict = ConfigDict(extra="forbid")


def _check_rationale(value: str) -> str:
    """One sentence, 1-200 characters after trimming. A blank rationale is a
    missing rationale and fails. An over-long one is shortened at a word
    boundary with an ellipsis: failing it would throw away the whole
    country's paid-for result over one sentence."""
    value = value.strip()
    if len(value) < RATIONALE_MIN_CHARS:
        raise ValueError(f"rationale must be at least {RATIONALE_MIN_CHARS} character")
    if len(value) > RATIONALE_MAX_CHARS:
        logger.warning("rationale over %d characters shortened: %r", RATIONALE_MAX_CHARS, value)
        cut = value[: RATIONALE_MAX_CHARS - 1]
        space = cut.rfind(" ")
        if space > RATIONALE_MAX_CHARS // 2:
            cut = cut[:space]
        value = cut.rstrip(" ,;:") + "\u2026"
    return value


Rationale = Annotated[str, AfterValidator(_check_rationale)]


class SubIndicator(BaseModel):
    """One scored sub-indicator: the integer score and the single fact that
    justifies it.

    ``score`` is ``None`` when the evidence is insufficient: no source
    confirms either the presence or the absence of what the sub-indicator
    asks about. The rationale stays required (non-empty) and then says what
    was searched and not found. In the output schema the field is
    ``anyOf: [enum 1-5, null]``; it stays required, so the model must choose
    explicitly."""

    model_config = _STRICT

    score: Score | None
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

    def subscores(self) -> dict[str, int | None]:
        """Map ``sub-indicator name -> integer score`` (``None`` =
        insufficient evidence)."""
        return {name: getattr(self, name).score for name in self.subindicators()}

    def rationales(self) -> dict[str, str]:
        """Map ``sub-indicator name -> rationale sentence``."""
        return {name: getattr(self, name).rationale for name in self.subindicators()}

    @property
    def score(self) -> float | None:
        """Dimension score = mean of the numeric sub-indicators, to 2
        decimals. ``None`` (insufficient evidence) when fewer than
        :data:`MIN_SCORED_SUBINDICATORS` of the four are numeric, so two
        unverifiable sub-indicators never turn into a number."""
        values = [v for v in self.subscores().values() if v is not None]
        if len(values) < MIN_SCORED_SUBINDICATORS:
            return None
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
    # Page titles of the cited URLs the link check reached (``links.py``),
    # for the sources database. Private for the same reason.
    _source_titles: dict[str, str] = PrivateAttr(default_factory=dict)

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

    @property
    def source_titles(self) -> dict[str, str]:
        """``url -> page title`` for the cited URLs the link check reached."""
        return dict(self._source_titles)

    def with_source_titles(self, titles: dict[str, str]) -> ResearchResult:
        """Attach the cited pages' titles and return this result."""
        self._source_titles = dict(titles)
        return self

    def dimensions(self) -> dict[str, Dimension]:
        """Map ``dimension key -> Dimension instance`` in canonical order."""
        return {dim.key: getattr(self, dim.key) for dim in self.DIMENSIONS}

    def dimension_scores(self) -> dict[str, float | None]:
        """Map ``dimension key -> mean sub-indicator score`` (``None`` =
        insufficient evidence)."""
        return {key: dim.score for key, dim in self.dimensions().items()}

    def rationales(self) -> dict[str, dict[str, str]]:
        """Map ``dimension key -> {sub-indicator name -> rationale}``."""
        return {key: dim.rationales() for key, dim in self.dimensions().items()}

    def average_score(self) -> float | None:
        """Maturity index: mean of the normative dimension scores
        (regulation_status, policy_lever, enforcement_level), to 2 decimals.
        An unscored dimension is left out; with fewer than
        :data:`MIN_SCORED_NORMATIVE` of the three scored the index is
        ``None``."""
        scores = [
            dim.score for dim in self.dimensions().values()
            if dim.normative and dim.score is not None
        ]
        if len(scores) < MIN_SCORED_NORMATIVE:
            return None
        return round(sum(scores) / len(scores), 2)

    def has_unscored_dimension(self) -> bool:
        """True when any dimension is ``None`` (insufficient evidence)."""
        return any(dim.score is None for dim in self.dimensions().values())

    def frontier_answer(self) -> FrontierAnswer | None:
        """The model's Frontier Risk Governance block, or ``None`` for a
        result researched without the lens (a plain :class:`ResearchResult`)."""
        return getattr(self, "frontier_risk", None)

    @classmethod
    def parse(cls, raw: Any) -> ResearchResult:
        """Validate a raw answer into the result class its shape names: a
        ``frontier_risk`` block holding ``developer_obligations`` is a track H
        answer, one holding ``evaluation_oversight`` but not that a track C
        answer, any other a track G answer; no block is a plain result. The
        request's structured-output schema fixes the shape, so the shape
        names the track the request asked for; :meth:`frontier.FrontierContext.assemble`
        still checks it against the country's track."""
        block = raw.get("frontier_risk") if isinstance(raw, dict) else None
        if not isinstance(block, dict):
            return ResearchResult.model_validate(raw)
        if "developer_obligations" in block:
            return ResearchResultH.model_validate(raw)
        if "evaluation_oversight" in block:
            return ResearchResultC.model_validate(raw)
        return ResearchResultG.model_validate(raw)

    @model_validator(mode="after")
    def _cap_unsourced_confidence(self) -> ResearchResult:
        """Keep the model self-consistent with :meth:`effective_confidence`.
        An unsourced claim is not citable, so it cannot carry more than "low"
        confidence - enforce that at validation time, not only on write, so an
        in-memory result never advertises a confidence its sources don't
        support. "Unsourced" means no citable URL: a Sources field of "N/A"
        or "-" counts as empty. Placeholder segments ("-", "N/A") are dropped
        from the field. A dimension without a score (insufficient evidence)
        caps confidence at "low" too: the entry is incomplete, and a low
        rating makes staleness re-research it. "High" without an official
        source is capped at "medium". (``object.__setattr__`` avoids
        re-triggering validation.)"""
        object.__setattr__(self, "sources", _drop_placeholder_sources(self.sources))
        object.__setattr__(self, "confidence", self.effective_confidence())
        return self

    def effective_confidence(self) -> Confidence:
        """Unsourced claims are not citable, and an unscored dimension leaves
        the entry incomplete - cap confidence at "low" in both cases so the UI
        flags them and staleness re-researches them. "High" means backed by
        primary sources (the methodology's definition), so without at least
        one official source (a government, legislature, regulator or EU
        institution URL, ``sources.classify_source``) it is capped at
        "medium" (#93). The model validator above already applies this, so
        this is a stable, idempotent accessor."""
        if not _has_citable_url(self.sources) or self.has_unscored_dimension():
            return "low"
        if self.confidence == "high" and not _has_official_source(self.sources):
            return "medium"
        return self.confidence

    @classmethod
    def output_schema(cls) -> dict[str, Any]:
        """JSON schema for structured outputs (``output_config.format``).

        Derived from the models so the sub-indicator field names are defined in
        exactly one place. ``$title`` annotations pydantic adds are stripped to
        keep the schema minimal; the shape (``enum`` scores, ``anyOf`` enum-or-null
        for a sub-indicator score, ``additionalProperties: false``, every field
        ``required``) matches what the API expects.
        """
        return strip_titles(cls.model_json_schema())


# -- Frontier Risk Governance (PRD 15) -------------------------------------------

# The anchors' generation, written into every frontier record. Bump it when
# the frontier anchors change: the lens then has a break of its own, and the
# five dimensions' RUBRIC_VERSION stays where it is.
FRONTIER_RUBRIC_VERSION = "f1"

Track = Literal["H", "C", "G"]
TRACKS: tuple[str, ...] = ("H", "C", "G")
DEFAULT_TRACK = "G"

# A sub-indicator that does not apply to the country's track. Assigned from
# the track file, never by the model, and never counted as a score.
NA = "na"

# The four sub-indicators in display order, and the tracks each applies to.
FRONTIER_SUBINDICATORS: tuple[str, ...] = (
    "developer_obligations",
    "evaluation_oversight",
    "incident_emergency_preparedness",
    "international_coordination",
)
FRONTIER_APPLIES: dict[str, frozenset[str]] = {
    "developer_obligations": frozenset({"H"}),
    "evaluation_oversight": frozenset({"H", "C"}),
    "incident_emergency_preparedness": frozenset({"H", "C", "G"}),
    "international_coordination": frozenset({"H", "C", "G"}),
}
# Computed from the committed public lists (frontier.py), never researched.
COMPUTED_SUBINDICATORS: tuple[str, ...] = ("international_coordination",)

# Column headers (scores.csv: score and track; regulation_data.csv: text and
# sources) and history.json keys of the lens.
FRONTIER_COLUMN = "Frontier Risk"
FRONTIER_TRACK_COLUMN = "Frontier Track"
FRONTIER_SOURCES_COLUMN = "Frontier Sources"
FRONTIER_HISTORY_KEY = "frontierRisk"
FRONTIER_TRACK_HISTORY_KEY = "frontierTrack"

_TRACK_WORDS = {"H": "frontier host", "C": "compute or chokepoint", "G": "global"}


def applies(subindicator: str, track: str) -> bool:
    """True when ``subindicator`` is scored on ``track``."""
    return track in FRONTIER_APPLIES[subindicator]


def researched_subindicators(track: str) -> tuple[str, ...]:
    """The sub-indicators the model researches on ``track``: the applicable
    ones minus the computed ``international_coordination``."""
    return tuple(
        name for name in FRONTIER_SUBINDICATORS
        if applies(name, track) and name not in COMPUTED_SUBINDICATORS
    )


def na_rationale(track: str) -> str:
    """The fixed rationale of a sub-indicator that does not apply."""
    if track == "C":
        return "Does not apply on the compute or chokepoint track: no frontier developer is based here."
    return (
        "Does not apply on the global track: no frontier developer or frontier-scale "
        "compute is based here."
    )


def frontier_score(subscores: dict[str, int | str | None]) -> float | None:
    """The lens score from the four sub-indicator values (an integer 1-5,
    ``None`` for insufficient evidence, or :data:`NA`).

    The mean of the applicable values, capped at the lowest applicable value
    plus one, to 2 decimals: one weak element caps the score, so strength
    elsewhere cannot hide it (the OECD/JRC Handbook's warning about
    compensatory aggregation). ``None`` when any applicable value is
    insufficient evidence or nothing applies."""
    values = [value for value in subscores.values() if value != NA]
    if not values or any(value is None for value in values):
        return None
    numbers = [int(value) for value in values]  # type: ignore[arg-type]
    mean = sum(numbers) / len(numbers)
    return round(min(mean, min(numbers) + 1), 2)


class FrontierAnswer(BaseModel):
    """The model's Frontier Risk Governance block: the researched
    sub-indicators of one track, a short ``text`` and the ``sources`` behind
    the frontier claims (pipe-separated URLs, kept apart from the main
    ``sources`` so frontier evidence never moves the five dimensions'
    stability gate). Concrete subclasses name the track's sub-indicators."""

    model_config = _STRICT

    track: ClassVar[str]

    def subscores(self) -> dict[str, int | None]:
        return {name: getattr(self, name).score for name in researched_subindicators(self.track)}

    def rationales(self) -> dict[str, str]:
        return {name: getattr(self, name).rationale for name in researched_subindicators(self.track)}

    def cleaned_sources(self) -> str:
        """``sources`` without placeholder segments ("-", "N/A")."""
        return _drop_placeholder_sources(self.sources)


class FrontierAnswerH(FrontierAnswer):
    track = "H"
    developer_obligations: SubIndicator
    evaluation_oversight: SubIndicator
    incident_emergency_preparedness: SubIndicator
    text: str
    sources: str


class FrontierAnswerC(FrontierAnswer):
    track = "C"
    evaluation_oversight: SubIndicator
    incident_emergency_preparedness: SubIndicator
    text: str
    sources: str


class FrontierAnswerG(FrontierAnswer):
    track = "G"
    incident_emergency_preparedness: SubIndicator
    text: str
    sources: str


class ResearchResultH(ResearchResult):
    """A research answer for a track H country: the five dimensions plus the
    frontier block. The schema puts ``frontier_risk`` last."""

    frontier_risk: FrontierAnswerH


class ResearchResultC(ResearchResult):
    frontier_risk: FrontierAnswerC


class ResearchResultG(ResearchResult):
    frontier_risk: FrontierAnswerG


_RESULT_MODELS: dict[str, type[ResearchResult]] = {
    "H": ResearchResultH, "C": ResearchResultC, "G": ResearchResultG,
}


def result_model_for(track: str | None) -> type[ResearchResult]:
    """The result class whose output schema a request for ``track`` sends;
    the plain :class:`ResearchResult` without a track."""
    if track is None:
        return ResearchResult
    return _RESULT_MODELS[track]


@dataclass(frozen=True)
class FrontierRecord:
    """One country's assembled Frontier Risk Governance entry: all four
    sub-indicators (researched, computed, or :data:`NA`), their rationales,
    the track it was scored on, the EU-level flag, and the text and sources
    the model gave. Built by :meth:`frontier.FrontierContext.assemble`."""

    track: str
    subscores: dict[str, int | str | None]
    rationales: dict[str, str]
    text: str
    sources: str
    eu_level: bool = False

    @property
    def score(self) -> float | None:
        return frontier_score(self.subscores)

    def entry(self, today: date) -> dict:
        """The ``frontier`` block of the country's subscores.json entry."""
        block: dict[str, Any] = {
            "date": today.isoformat(),
            "track": self.track,
            "rubric": FRONTIER_RUBRIC_VERSION,
        }
        for name in FRONTIER_SUBINDICATORS:
            item: dict[str, Any] = {"score": self.subscores[name], "rationale": self.rationales[name]}
            if name == "developer_obligations" and self.eu_level:
                item["eu_level"] = True
            if name in COMPUTED_SUBINDICATORS:
                item["computed"] = True
            block[name] = item
        return block

    def describe(self) -> str:
        """One log line: the score and the track in words."""
        return f"{format_score(self.score)} ({_TRACK_WORDS[self.track]} track)"


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


def _drop_placeholder_sources(sources: str) -> str:
    """Drop Sources segments that name nothing ("-", "N/A"), keeping the rest
    in order."""
    from .sources import is_placeholder  # local: keeps models free of import cycles

    segments = [segment.strip() for segment in sources.split("|")]
    return " | ".join(segment for segment in segments if not is_placeholder(segment))


def _has_official_source(sources: str) -> bool:
    from .sources import classify_sources

    return any(source.kind == "official" for source in classify_sources(sources))


def _has_citable_url(sources: str) -> bool:
    from .sources import classify_sources

    return bool(classify_sources(sources))
