"""The stability gate: decides whether a result's scores may land.

Weekly re-research of every country produces quarter-point jitter with no
policy cause. The gate lets numeric scores through only when the run gives
evidence for the change, or when the same change persists across two
consecutive runs. Text fields always apply; the gate covers only the
dimension scores, the sub-scores, and the history snapshot.

:func:`decide` is a pure function so every rule is testable without a
dataset. The service applies the decision; the repository stores the
pending candidates in ``public/data/pending.json``.

A dimension score may be ``None`` (insufficient evidence, rubric v3.1). A
move to or from ``None`` is a score change like any other: it needs new
evidence or has to repeat on the next run. Its direction is "to insufficient
evidence" or "from insufficient evidence" rather than up or down, and it
always goes on the review list, since no size can be measured.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from urllib.parse import urlparse

from .models import ResearchResult, format_score
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


@dataclass(frozen=True)
class LargeMove:
    """An applied move worth reviewing: 0.75 or more, or to or from
    insufficient evidence (``None``)."""

    dimension: str
    old: float | None
    new: float | None


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
                f"Review: {country} {move.dimension} {format_score(move.old)} -> "
                f"{format_score(move.new)} ({sources})"
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
        out.append(
            f"No applied move of {LARGE_MOVE} or more, or to or from insufficient "
            "evidence, on any dimension."
        )
    else:
        out.append("| Country | Dimension | Old | New | New sources |")
        out.append("|---------|-----------|-----|-----|-------------|")
        for country, decision in tally.review:
            sources = "<br>".join(decision.new_sources) or "none"
            for move in decision.large_moves:
                out.append(
                    f"| {country} | {move.dimension} | {format_score(move.old)} | "
                    f"{format_score(move.new)} | {sources} |"
                )
    return "\n".join(out) + "\n"


# -- the rules -------------------------------------------------------------------


def decide(
    existing_scores: dict | None,
    existing_reg: dict | None,
    result: ResearchResult,
    pending: dict | None,
    today: date,
    seen_sources: frozenset[str] = frozenset(),
) -> Decision:
    """Apply the evidence rule, then the persistence rule.

    ``existing_scores`` and ``existing_reg`` are the country's current CSV
    rows (``None`` for a new country). ``pending`` is the stored candidate
    from an earlier run: ``{"candidate_scores": {...}, "first_seen": "..."}``.
    ``seen_sources`` is every URL the country has cited before
    (:func:`normalise_url` form), so a URL dropped and re-cited is not new.
    """
    candidate = result.dimension_scores()
    old = _existing_dimension_scores(existing_scores)

    if old is None:
        return Decision(APPLIED_EVIDENCE, True, "no prior scores")

    changes = {key: (old[key], candidate[key]) for key in candidate if old[key] != candidate[key]}
    if not changes:
        return Decision(UNCHANGED, True, "scores unchanged")

    moves = _large_moves(changes)
    new_sources = new_source_urls(existing_reg, result, seen_sources)
    if new_sources:
        return Decision(
            APPLIED_EVIDENCE, True, f"new source: {new_sources[0]}",
            large_moves=moves, new_sources=new_sources,
        )
    if laws_changed(existing_reg, result):
        return Decision(APPLIED_EVIDENCE, True, "specific laws changed", large_moves=moves)

    directions = _directions(old, candidate)
    if pending is not None and _is_recent(pending, today):
        stored = _directions(old, pending.get("candidate_scores", {}))
        if stored == directions:
            return Decision(
                APPLIED_PERSISTED, True,
                f"same move as {pending.get('first_seen')}", large_moves=moves,
            )

    entry = {"candidate_scores": candidate, "first_seen": today.isoformat()}
    moved = ", ".join(f"{key} {direction}" for key, direction in sorted(directions.items()))
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
        f"{key} {direction}" for key, direction in sorted(_directions(old, stored).items())
    )
    return f"held since {pending.get('first_seen')} ({moved}): applies if the same move repeats"


# A held candidate confirms a move only on the NEXT run. Weekly runs are 7
# days apart; the slack covers a delayed or skipped week, not a stale
# candidate from months ago.
PENDING_MAX_AGE_DAYS = 14


def _is_recent(pending: dict, today: date) -> bool:
    try:
        first_seen = date.fromisoformat(str(pending.get("first_seen")))
    except ValueError:
        return False
    return 0 <= (today - first_seen).days <= PENDING_MAX_AGE_DAYS


# -- evidence helpers ------------------------------------------------------------


def normalise_url(url: str) -> str:
    """Strip scheme, ``www.``, and a trailing slash, like ``sources.py``."""
    text = url.strip()
    try:
        parsed = urlparse(text if "://" in text else "//" + text)
        host = (parsed.hostname or "").lower().removeprefix("www.")
    except ValueError:  # e.g. an unclosed IPv6 bracket; sources.py tolerates it too
        return text.lower()
    path = parsed.path.rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{host}{path}{query}"


def cited_urls(sources: str | None) -> frozenset[str]:
    """The URLs in a ``Sources`` value, in :func:`normalise_url` form."""
    return frozenset(normalise_url(s.url) for s in classify_sources(sources))


def new_source_urls(
    existing_reg: dict | None, result: ResearchResult, seen: frozenset[str] = frozenset(),
) -> tuple[str, ...]:
    """Cited URLs new to the country: in neither the existing ``Sources``
    column nor ``seen`` (every URL it cited on earlier runs). ``Sources``
    is rewritten on every run, so without ``seen`` a URL dropped one week
    and cited again the next would count as new evidence (#88)."""
    known = cited_urls((existing_reg or {}).get("Sources")) | seen
    fresh = []
    for source in classify_sources(result.sources):
        if normalise_url(source.url) not in known:
            fresh.append(source.url)
    return tuple(fresh)


def laws_changed(existing_reg: dict | None, result: ResearchResult) -> bool:
    """True when the result names a different set of instruments. The list
    is compared as a set of normalised names, so reordering it, or changing
    only punctuation, case or spacing, is no change (#88)."""
    return law_names((existing_reg or {}).get("Specific Laws", "")) != law_names(result.specific_laws)


# Separators between named instruments: a semicolon, a newline, or a comma
# followed by whitespace (a comma inside a number, "13,709/2018", is not).
_LAW_SEPARATOR_RE = re.compile(r";|\n|,(?=\s)")
_NON_WORD_RE = re.compile(r"[^\w]+")


def law_names(text: str | None) -> frozenset[str]:
    """The named instruments in a ``Specific Laws`` value, each normalised
    (case-folded, punctuation and spacing collapsed). Separators inside
    parentheses belong to the name: "AI Promotion Act (AI Act, 2025)" is
    one instrument."""
    names: set[str] = set()
    depth = 0
    start = 0
    raw = text or ""
    for i, char in enumerate(raw):
        if char in "([":
            depth += 1
        elif char in ")]":
            depth = max(depth - 1, 0)
        elif depth == 0 and _LAW_SEPARATOR_RE.match(raw, i):
            names.add(_law_key(raw[start:i]))
            start = i + 1
    names.add(_law_key(raw[start:]))
    names.discard("")
    return frozenset(names)


def _law_key(name: str) -> str:
    return _NON_WORD_RE.sub(" ", name.casefold()).strip()


# -- score helpers ---------------------------------------------------------------


_EMPTY_CELLS = ("", "NA", None)

# Direction labels for a dimension that moved (``_directions``).
UP = "up"
DOWN = "down"
TO_INSUFFICIENT = "to insufficient evidence"
FROM_INSUFFICIENT = "from insufficient evidence"


def _existing_dimension_scores(row: dict | None) -> dict[str, float | None] | None:
    """The five dimension scores from a scores.csv row. An empty cell is
    ``None`` (insufficient evidence). Returns ``None`` (no prior scores)
    when the row is missing, every score is empty, or any score is
    non-numeric."""
    if not row:
        return None
    scores: dict[str, float | None] = {}
    for key, column in SCORE_COLUMNS.items():
        value = row.get(column, "")
        if value in _EMPTY_CELLS:
            scores[key] = None
            continue
        try:
            scores[key] = round(float(value), 2)
        except (TypeError, ValueError):
            return None
    if all(value is None for value in scores.values()):
        return None
    return scores


def _as_score(value) -> float | None:
    """A candidate score (a number, ``None``, or a pending.json value)."""
    if value in _EMPTY_CELLS:
        return None
    return float(value)


def _directions(old: dict[str, float | None], new: dict) -> dict[str, str]:
    """Direction of the move per dimension, for dimensions that moved:
    ``up``, ``down``, or to or from insufficient evidence (``None``). A key
    missing from ``new`` or holding garbage is treated as unmoved."""
    out: dict[str, str] = {}
    for key, before in old.items():
        if key not in new:
            continue
        try:
            after = _as_score(new[key])
        except (TypeError, ValueError):
            continue
        if before is None and after is None:
            continue
        if after is None:
            out[key] = TO_INSUFFICIENT
        elif before is None:
            out[key] = FROM_INSUFFICIENT
        elif after > before:
            out[key] = UP
        elif after < before:
            out[key] = DOWN
    return out


def _large_moves(
    changes: dict[str, tuple[float | None, float | None]],
) -> tuple[LargeMove, ...]:
    """Moves of :data:`LARGE_MOVE` or more, plus every move to or from
    insufficient evidence (it has no size, and a score appearing or
    disappearing is worth a look)."""
    return tuple(
        LargeMove(key, before, after)
        for key, (before, after) in changes.items()
        if before is None or after is None or abs(after - before) >= LARGE_MOVE
    )
