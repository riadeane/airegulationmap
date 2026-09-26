"""History-snapshot append logic.

Kept as a pure function (given a fully-built snapshot dict) so the
change-detection rule is trivially testable in isolation. The dimension keys
compared for change are derived from the models, so they can't drift from the
snapshot the repository builds.
"""

from __future__ import annotations

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
