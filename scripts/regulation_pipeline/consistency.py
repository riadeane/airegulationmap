"""Post-run consistency check for EU members (#95).

The EU AI Act applies directly in every member state, so sub-indicators
that describe the Act itself should score the same across the 27: a
member whose ``regulation_status.binding_force`` or ``ai_specificity``
differs from the EU's most common score is a difference the law does not
contain. The check never changes a score; it lists the outliers in the run
log (``eu:`` lines) and the GitHub step summary for a reviewer.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .repository import split_subscores_entry

# Sub-indicators the AI Act fixes for every member state.
EU_SHARED = (
    ("regulation_status", "binding_force"),
    ("regulation_status", "ai_specificity"),
)


@dataclass(frozen=True)
class Outliers:
    """One sub-indicator's EU spread: the most common score and the
    members that differ from it (``{country: score}``). ``mode`` is
    ``None`` when two scores tie for most common."""

    dimension: str
    subindicator: str
    mode: int | None
    differ: dict[str, int | None]


def eu_members(blocs_path: Path) -> list[str]:
    if not blocs_path.exists():
        return []
    return list(json.loads(blocs_path.read_text(encoding="utf-8")).get("EU", {}).get("members", []))


def eu_outliers(subscores: dict, members: list[str]) -> list[Outliers]:
    """The EU spread of each :data:`EU_SHARED` sub-indicator, from a
    ``subscores.json`` document (v2 integers and v2.1 ``{score, rationale}``
    both read). Members with no entry are skipped; an insufficient-evidence
    score (``None``) counts as a score of its own, so it is listed when the
    mode is a number."""
    entries = subscores.get("countries", {})
    out: list[Outliers] = []
    for dimension, name in EU_SHARED:
        scores: dict[str, int | None] = {}
        for member in members:
            entry = entries.get(member)
            if entry is None:
                continue
            sub = split_subscores_entry(entry)[0].get(dimension)
            if isinstance(sub, dict) and name in sub:
                scores[member] = sub[name]
        if not scores:
            continue
        ranked = Counter(scores.values()).most_common()
        mode = ranked[0][0] if len(ranked) == 1 or ranked[0][1] > ranked[1][1] else None
        differ = {c: v for c, v in sorted(scores.items()) if mode is None or v != mode}
        if mode is not None and not differ:
            continue
        out.append(Outliers(dimension, name, mode, differ if mode is not None else {}))
    return out


def log_lines(outliers: list[Outliers]) -> list[str]:
    lines = []
    for o in outliers:
        if o.mode is None:
            lines.append(f"eu: {o.subindicator} has no single most common score across members")
            continue
        listed = ", ".join(f"{c} {_fmt(v)}" for c, v in o.differ.items())
        lines.append(f"eu: {o.subindicator} is {o.mode} for most members; differs: {listed}")
    return lines


def markdown_summary(outliers: list[Outliers]) -> str:
    """The step-summary block; empty when every shared sub-indicator agrees."""
    if not outliers:
        return ""
    out = [
        "", "## EU consistency", "",
        "The AI Act applies directly in every member state, so these sub-indicators "
        "should agree across the EU. Members that differ from the most common score:", "",
        "| Sub-indicator | Most common | Members that differ |",
        "|---------------|-------------|---------------------|",
    ]
    for o in outliers:
        if o.mode is None:
            out.append(f"| `{o.dimension}.{o.subindicator}` | tie | (no single most common score) |")
            continue
        listed = ", ".join(f"{c} ({_fmt(v)})" for c, v in o.differ.items())
        out.append(f"| `{o.dimension}.{o.subindicator}` | {o.mode} | {listed} |")
    return "\n".join(out) + "\n"


def _fmt(value: int | None) -> str:
    return "insufficient evidence" if value is None else str(value)
