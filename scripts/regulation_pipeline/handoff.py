"""The open-batch state file (#194).

A full weekly batch can take longer than one GitHub Actions job may run. When
the run's main batch is still processing at the end of its wait, the run
leaves it running and records it here; the next run (the collect schedule, a
manual dispatch, or the next weekly run) collects its results instead of
submitting anything new, then deletes the file. The file also carries the
options the batch was submitted with (model, search, the gate and a
calibration break, whether it was a full run, the digest), so the results
are applied exactly as the submitting run would have applied them.

The file lives in ``state/`` at the repository root, outside ``public/``: it
is pipeline state, not published data.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .batch import OpenBatch

logger = logging.getLogger(__name__)

STATE_VERSION = 1
# The Batches API keeps a batch's results for 29 days after creation.
RESULTS_RETENTION = timedelta(days=29)


@dataclass(frozen=True)
class Handoff:
    """An open batch plus the options of the run that submitted it."""

    batch: OpenBatch
    run_id: str | None = None
    options: dict = field(default_factory=dict)

    @property
    def countries(self) -> list[str]:
        return sorted(self.batch.id_map.values())

    def expired(self, now: datetime) -> bool:
        """True once the batch's results can no longer be read."""
        submitted = self.batch.submitted_at
        return submitted is not None and now - submitted > RESULTS_RETENTION

    def to_json(self) -> dict:
        submitted = self.batch.submitted_at
        return {
            "version": STATE_VERSION,
            "batch_id": self.batch.batch_id,
            "submitted_at": submitted.isoformat() if submitted else None,
            "run_id": self.run_id,
            "options": dict(sorted(self.options.items())),
            "id_map": dict(sorted(self.batch.id_map.items())),
        }

    @classmethod
    def from_json(cls, data: dict) -> Handoff:
        if data.get("version") != STATE_VERSION:
            raise ValueError(f"unknown open-batch state version: {data.get('version')!r}")
        submitted = data.get("submitted_at")
        when = datetime.fromisoformat(submitted) if submitted else None
        if when is not None and when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        id_map = data.get("id_map") or {}
        if not data.get("batch_id") or not id_map:
            raise ValueError("open-batch state needs a batch_id and an id_map")
        return cls(
            batch=OpenBatch(str(data["batch_id"]), {str(k): str(v) for k, v in id_map.items()}, when),
            run_id=data.get("run_id"),
            options=dict(data.get("options") or {}),
        )


def load(path: Path) -> Handoff | None:
    """The recorded open batch, or ``None`` when there is none. A file that
    cannot be read is an error, never "no batch": skipping it would submit a
    second batch and pay twice."""
    if not path.exists():
        return None
    return Handoff.from_json(json.loads(path.read_text(encoding="utf-8")))


def save(path: Path, handoff: Handoff) -> None:
    """Write the state file atomically (temp file, then rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(handoff.to_json(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def clear(path: Path) -> None:
    path.unlink(missing_ok=True)
