"""The stability gate: decides whether a result's scores may land.

Weekly re-research of every country produces quarter-point jitter with no
policy cause. The gate lets numeric scores through only when the run gives
evidence for the change, or when the same change persists across two
consecutive runs. Text fields always apply; the gate covers only the
dimension scores, the sub-scores, and the history snapshot.

:func:`decide` is a pure function so every rule is testable without a
dataset. The service applies the decision; the repository stores the
pending candidates in ``public/data/pending.json``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from urllib.parse import urlparse

from .models import ResearchResult
from .sources import classify_sources

# Provenance labels, one per country per run.
APPLIED_EVIDENCE = "applied:evidence"
APPLIED_PERSISTED = "applied:persisted"
APPLIED_UNGATED = "applied:ungated"
HELD = "held"
UNCHANGED = "unchanged"
RULES = (APPLIED_EVIDENCE, APPLIED_PERSISTED, APPLIED_UNGATED, HELD, UNCHANGED)

# An applied move of this size or more on one dimension goes on the
# "Review these" list in the run summary.
LARGE_MOVE = 0.75

# Maps a dimension key to its scores.csv column.
SCORE_COLUMNS = {
    "regulation_status": "Regulation Status",
    "policy_lever": "Policy Lever",
    "governance_type": "Governance Type",
    "actor_involvement": "Actor Involvement",
    "enforcement_level": "Enforcement Level",
}

_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class LargeMove:
    dimension: str
    old: float
    new: float


@dataclass(frozen=True)
class Decision:
    """What the gate decided for one country.

    ``apply_scores`` says whether the numeric scores, sub-scores, and history
    snapshot may land. ``pending`` is the candidate to store for the next run
    (``None`` clears any stored candidate). ``reason`` is a short human
    explanation for the log.
    """

    rule: str
    apply_scores: bool
    reason: str
    pending: dict | None = None
    large_moves: tuple[LargeMove, ...] = ()
    new_sources: tuple[str, ...] = ()


@dataclass
class GateTally:
    """Per-run counts and the review list, for the run summary."""

    counts: dict[str, int] = field(default_factory=lambda: dict.fromkeys(RULES, 0))
    review: list[tuple[str, Decision]] = field(default_factory=list)

    def add(self, country: str, decision: Decision) -> None:
        self.counts[decision.rule] = self.counts.get(decision.rule, 0) + 1
        if decision.large_moves:
            self.review.append((country, decision))

    def summary_line(self) -> str:
        parts = [f"{rule}={self.counts.get(rule, 0)}" for rule in RULES]
        return "Gate: " + " ".join(parts)


# -- run summary -----------------------------------------------------------------


def review_lines(tally: GateTally) -> list[str]:
    """One log line per applied large move, for the run log."""
    lines = []
    for country, decision in tally.review:
        for move in decision.large_moves:
            sources = ", ".join(decision.new_sources) or "no new source"
            lines.append(
                f"Review: {country} {move.dimension} {move.old} -> {move.new} ({sources})"
            )
    return lines


def markdown_summary(tally: GateTally, calibration_break: dict | None = None) -> str:
    """The stability-gate block for the GitHub step summary."""
    out = ["", "## Stability gate", ""]
    out.append("| Rule | Countries |")
    out.append("|------|-----------|")
    for rule in RULES:
        out.append(f"| `{rule}` | {tally.counts.get(rule, 0)} |")
    if calibration_break:
        out += ["", f"Calibration break recorded: {calibration_break['reason']}"]
    out += ["", "### Review these", ""]
    if not tally.review:
        out.append(f"No applied move of {LARGE_MOVE} or more on any dimension.")
    else:
        out.append("| Country | Dimension | Old | New | New sources |")
        out.append("|---------|-----------|-----|-----|-------------|")
        for country, decision in tally.review:
            sources = "<br>".join(decision.new_sources) or "none"
            for move in decision.large_moves:
                out.append(
                    f"| {country} | {move.dimension} | {move.old} | {move.new} | {sources} |"
                )
    return "\n".join(out) + "\n"


# -- the rules -------------------------------------------------------------------


def decide(
    existing_scores: dict | None,
    existing_reg: dict | None,
    result: ResearchResult,
    pending: dict | None,
    today: date,
) -> Decision:
    """Apply the evidence rule, then the persistence rule.

    ``existing_scores`` and ``existing_reg`` are the country's current CSV
    rows (``None`` for a new country). ``pending`` is the stored candidate
    from an earlier run: ``{"candidate_scores": {...}, "first_seen": "..."}``.
    """
    candidate = result.dimension_scores()
    old = _existing_dimension_scores(existing_scores)

    if old is None:
        return Decision(APPLIED_EVIDENCE, True, "no prior scores")

    changes = {key: (old[key], candidate[key]) for key in candidate if old[key] != candidate[key]}
    if not changes:
        return Decision(UNCHANGED, True, "scores unchanged")

    moves = _large_moves(changes)
    new_sources = new_source_urls(existing_reg, result)
    if new_sources:
        return Decision(
            APPLIED_EVIDENCE, True, f"new source: {new_sources[0]}",
            large_moves=moves, new_sources=new_sources,
        )
    if laws_changed(existing_reg, result):
        return Decision(APPLIED_EVIDENCE, True, "specific laws changed", large_moves=moves)

    directions = _directions(old, candidate)
    if pending is not None:
        stored = _directions(old, pending.get("candidate_scores", {}))
        if stored == directions:
            return Decision(
                APPLIED_PERSISTED, True,
                f"same move as {pending.get('first_seen')}", large_moves=moves,
            )

    entry = {"candidate_scores": candidate, "first_seen": today.isoformat()}
    moved = ", ".join(f"{key} {_arrow(sign)}" for key, sign in sorted(directions.items()))
    return Decision(HELD, False, f"no evidence ({moved})", pending=entry)


def ungated(existing_scores: dict | None, result: ResearchResult) -> Decision:
    """The ``--no-gate`` decision: every score lands, but the labels and the
    review list still work so a calibration run is auditable."""
    candidate = result.dimension_scores()
    old = _existing_dimension_scores(existing_scores)
    if old is None:
        return Decision(APPLIED_EVIDENCE, True, "no prior scores")
    changes = {key: (old[key], candidate[key]) for key in candidate if old[key] != candidate[key]}
    if not changes:
        return Decision(UNCHANGED, True, "scores unchanged")
    return Decision(APPLIED_UNGATED, True, "gate off", large_moves=_large_moves(changes))


def standing(existing_scores: dict | None, pending: dict | None) -> str:
    """What the gate will do with the next result, for ``--dry-run``."""
    if _existing_dimension_scores(existing_scores) is None:
        return "no prior scores: any result applies"
    if pending is None:
        return "gate on: a score change needs a new source or changed laws, else it is held"
    stored = pending.get("candidate_scores", {})
    old = _existing_dimension_scores(existing_scores) or {}
    moved = ", ".join(
        f"{key} {_arrow(sign)}" for key, sign in sorted(_directions(old, stored).items())
    )
    return f"held since {pending.get('first_seen')} ({moved}): applies if the same move repeats"


# -- evidence helpers ------------------------------------------------------------


def normalise_url(url: str) -> str:
    """Strip scheme, ``www.``, and a trailing slash, like ``sources.py``."""
    text = url.strip()
    parsed = urlparse(text if "://" in text else "//" + text)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    path = parsed.path.rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{host}{path}{query}"


def new_source_urls(existing_reg: dict | None, result: ResearchResult) -> tuple[str, ...]:
    """Cited URLs that the existing ``Sources`` column does not contain."""
    known = {normalise_url(s.url) for s in classify_sources((existing_reg or {}).get("Sources"))}
    fresh = []
    for source in classify_sources(result.sources):
        if normalise_url(source.url) not in known:
            fresh.append(source.url)
    return tuple(fresh)


def laws_changed(existing_reg: dict | None, result: ResearchResult) -> bool:
    before = _squash((existing_reg or {}).get("Specific Laws", ""))
    after = _squash(result.specific_laws)
    return before != after


def _squash(text: str | None) -> str:
    return _WHITESPACE_RE.sub(" ", (text or "")).strip()


# -- score helpers ---------------------------------------------------------------


def _existing_dimension_scores(row: dict | None) -> dict[str, float] | None:
    """The five dimension scores from a scores.csv row, or ``None`` when the
    row is missing or any score is empty or non-numeric."""
    if not row:
        return None
    scores: dict[str, float] = {}
    for key, column in SCORE_COLUMNS.items():
        try:
            scores[key] = round(float(row.get(column, "")), 2)
        except (TypeError, ValueError):
            return None
    return scores


def _directions(old: dict[str, float], new: dict) -> dict[str, int]:
    """Sign of the move per dimension, for dimensions that moved."""
    out: dict[str, int] = {}
    for key, before in old.items():
        try:
            after = float(new[key])
        except (KeyError, TypeError, ValueError):
            continue
        if after > before:
            out[key] = 1
        elif after < before:
            out[key] = -1
    return out


def _large_moves(changes: dict[str, tuple[float, float]]) -> tuple[LargeMove, ...]:
    return tuple(
        LargeMove(key, before, after)
        for key, (before, after) in changes.items()
        if abs(after - before) >= LARGE_MOVE
    )


def _arrow(sign: int) -> str:
    return "up" if sign > 0 else "down"
