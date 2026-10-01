"""History-snapshot append logic.

Kept as a pure function (given a fully-built snapshot dict) so the
change-detection rule is trivially testable in isolation. The dimension keys
compared for change are derived from the models, so they can't drift from the
snapshot the repository builds.
"""

from __future__ import annotations

import re

from .models import FRONTIER_HISTORY_KEY, FRONTIER_TRACK_HISTORY_KEY, ResearchResult

# The five dimension keys in the history JSON (camelCase). averageScore and date
# are intentionally excluded from change detection - a snapshot exists to record
# a change in the underlying dimension scores.
DIMENSION_KEYS = tuple(dim.history_key for dim in ResearchResult.DIMENSIONS)

# The research confidence ("high" | "medium" | "low") the run wrote to
# regulation_data.csv, recorded so the map's low-confidence hatch can follow
# past ratings on the timeline. A change in it alone is a change-point too:
# the map shows it. Snapshots written before it was recorded carry no key.
CONFIDENCE_KEY = "confidence"
# Frontier Risk Governance (PRD 15): the lens score and the track it was
# scored on, present once a country has been scored on the lens.
FRONTIER_KEYS = (FRONTIER_HISTORY_KEY, FRONTIER_TRACK_HISTORY_KEY)
CHANGE_KEYS = (*DIMENSION_KEYS, CONFIDENCE_KEY, *FRONTIER_KEYS)


def append_snapshot(history: dict, country: str, snapshot: dict) -> bool:
    """Append ``snapshot`` for ``country`` only if its dimension scores or its
    confidence changed from the last recorded snapshot. Returns ``True`` when
    it was appended.

    A snapshot is a change-point: its ``date`` is the run that produced those
    scores, and the frontend's timeline, changelog, "This week" strip and
    drift dashboard all read it that way. So an unchanged re-research leaves
    the history untouched; moving the last date forward would re-date an old
    change to the latest run. (Freshness lives in ``last_updated`` in
    regulation_data.csv.)

    A dimension value may be ``None`` (insufficient evidence, written as
    ``null``). ``None`` against a number is a change; ``None`` against
    ``None`` is not.

    A confidence-only change appends a snapshot with the same scores: the
    map's hatch follows it on the timeline, while the changelog, "This
    week" strip and drift dashboard skip snapshots whose dimension scores
    equal the previous one's. A last snapshot written before confidence was
    recorded has none, so the first run that records it appends once per
    country; older snapshots are not backfilled.

    A second run on the same day supersedes that day's snapshot instead of
    adding another with the same date (``score_history`` allows one per
    country and date): the day's snapshot is dropped, and the new scores are
    compared with the one before it.
    """
    snapshots = history["countries"].setdefault(country, [])

    if snapshots and snapshots[-1].get("date") == snapshot["date"]:
        snapshots.pop()

    if snapshots:
        last = snapshots[-1]
        if not any(snapshot.get(k) != last.get(k) for k in CHANGE_KEYS):
            return False

    snapshots.append(snapshot)
    return True


def set_frontier(history: dict, country: str, day: str, values: dict) -> bool:
    """Record the lens's ``values`` (``frontierRisk``, ``frontierTrack``)
    for ``country`` as of ``day``. Returns ``True`` when history changed.

    The lens lands after the five dimensions (a separate gate decision), so
    the snapshot for ``day`` may already exist: it is amended in place, and
    stays a change-point because its values differ from the one before or
    the main apply already made it one. Otherwise a copy of the latest
    snapshot, dated ``day`` and carrying the new values, is appended. Equal
    values change nothing. A country with no snapshot yet gets none here:
    its first main apply always writes one."""
    snapshots = history["countries"].setdefault(country, [])
    if not snapshots:
        return False
    last = snapshots[-1]
    if all(last.get(k) == v for k, v in values.items()):
        return False
    if last.get("date") == day:
        last.update(values)
        previous = snapshots[-2] if len(snapshots) > 1 else None
        if previous is not None and not any(last.get(k) != previous.get(k) for k in CHANGE_KEYS):
            snapshots.pop()  # the amendment undid today's only change
        return True
    snapshots.append({**last, "date": day, **values})
    return True


def rubric_of(entry: dict) -> str | None:
    """The rubric generation a calibration break was recorded for: its
    ``rubric`` field (e.g. ``"v3.1"``), else the leading ``vN`` of its
    ``prompt_version``. The fallback serves legacy entries only: prompt and
    rubric versions diverge after v3 (prompt v3.3 is rubric v3.1), so every
    break written since records ``rubric`` explicitly."""
    if entry.get("rubric"):
        return str(entry["rubric"])
    match = re.match(r"(v\d+)", str(entry.get("prompt_version") or ""))
    return match.group(1) if match else None


def calibration_due(breaks: list[dict], rubric: str) -> bool:
    """True when the newest recorded break is for an older rubric than
    ``rubric``, or when the newest break for ``rubric`` is marked incomplete:
    the next full run must then run as a calibration run. A history with no
    breaks at all (a fresh dataset) never triggers it."""
    if not breaks:
        return False
    latest = max(breaks, key=lambda entry: str(entry.get("date") or ""))
    # A break the run could not finish (some countries kept older-rubric
    # scores) leaves the switch due; entries without the flag are complete.
    return rubric_of(latest) != rubric or latest.get("complete") is False
