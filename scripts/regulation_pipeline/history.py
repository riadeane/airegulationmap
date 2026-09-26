"""History-snapshot append logic.

Kept as a pure function (given a fully-built snapshot dict) so the
change-detection rule is trivially testable in isolation. The dimension keys
compared for change are derived from the models, so they can't drift from the
snapshot the repository builds.
"""

from __future__ import annotations

import re

from .models import ResearchResult

# The five dimension keys in the history JSON (camelCase). averageScore and date
# are intentionally excluded from change detection - a snapshot exists to record
# a change in the underlying dimension scores.
DIMENSION_KEYS = tuple(dim.history_key for dim in ResearchResult.DIMENSIONS)


def append_snapshot(history: dict, country: str, snapshot: dict) -> bool:
    """Append ``snapshot`` for ``country`` only if its dimension scores changed
    from the last recorded snapshot. Returns ``True`` when it was appended.

    A snapshot is a change-point: its ``date`` is the run that produced those
    scores, and the frontend's timeline, changelog, "This week" strip and
    drift dashboard all read it that way. So an unchanged re-research leaves
    the history untouched; moving the last date forward would re-date an old
    change to the latest run. (Freshness lives in ``last_updated`` in
    regulation_data.csv.)

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
        if not any(snapshot.get(k) != last.get(k) for k in DIMENSION_KEYS):
            return False

    snapshots.append(snapshot)
    return True


def rubric_of(entry: dict) -> str | None:
    """The rubric generation a calibration break was recorded for: its
    ``rubric`` field, else the leading ``vN`` of its ``prompt_version``."""
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
