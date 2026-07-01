"""History-snapshot append logic.

Kept as a pure function (given a fully-built snapshot dict) so the
change-detection rule is trivially testable in isolation. The dimension keys
compared for change are derived from the models, so they can't drift from the
snapshot the repository builds.
"""

from __future__ import annotations

from .models import ResearchResult

# The five dimension keys in the history JSON (camelCase). averageScore and date
# are intentionally excluded from change detection — a snapshot exists to record
# a change in the underlying dimension scores.
DIMENSION_KEYS = tuple(dim.history_key for dim in ResearchResult.DIMENSIONS)


def append_snapshot(history: dict, country: str, snapshot: dict) -> bool:
    """Append ``snapshot`` for ``country`` only if its dimension scores changed
    from the last recorded snapshot.

    If nothing changed, the last snapshot's ``date`` is advanced to the new
    snapshot's date (documenting "still true as of this re-research") and the
    function returns ``False``. Returns ``True`` when a new snapshot is appended.
    """
    snapshots = history["countries"].setdefault(country, [])

    if snapshots:
        last = snapshots[-1]
        changed = any(snapshot.get(k) != last.get(k) for k in DIMENSION_KEYS)
        if not changed:
            last["date"] = snapshot["date"]
            return False

    snapshots.append(snapshot)
    return True
