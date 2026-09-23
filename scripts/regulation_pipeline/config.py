"""Configuration for the regulation data pipeline.

Two kinds of thing live here:

* **Constants that are contracts** - the CSV column order/headers the frontend
  loader depends on, the staleness threshold, and the default model. These are module-level so they read as the fixed contract they
  are.
* **:class:`Settings`** - the injectable bundle of *where things live* and
  *which model/thresholds to use*. Paths are anchored to the repository root via
  :data:`REPO_ROOT` rather than the process CWD, so the pipeline works from any
  working directory. Tests construct a ``Settings(root=tmp_path)`` to redirect
  all I/O without touching globals.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# scripts/regulation_pipeline/config.py -> parents[2] is the repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]

# Column order + exact headers for public/scores.csv and public/regulation_data.csv.
# This is the persistence contract the frontend CSV loader reads; a test asserts
# the repository emits exactly these keys so a typo can't silently drop a column.
SCORES_FIELDS = [
    "Country", "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Average Score", "Enforcement Level",
    "Last Updated", "Data Version",
]

REGULATION_FIELDS = [
    "Country", "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Enforcement Level", "Specific Laws",
    "Sources", "Last Updated", "Confidence",
]

# Countries stale after this many days without a fresh, confident answer.
STALENESS_DAYS = 90

# Default research model. The model must support the web_search_20260209
# tool and structured outputs (Opus 5, Opus 4.8, Sonnet 5, and Sonnet 4.6 do).
# Opus 5 thinks by default, which suits the judgment-heavy scoring rubric.
DEFAULT_MODEL = "claude-opus-5"


@dataclass(frozen=True)
class Settings:
    """Where the pipeline reads and writes, plus the run-wide knobs. Paths are
    derived from :attr:`root`; override ``root`` to redirect all I/O (tests do
    this with a temp directory)."""

    root: Path = REPO_ROOT
    staleness_days: int = STALENESS_DAYS
    default_model: str = DEFAULT_MODEL

    def validate(self) -> Settings:
        """Fail fast if ``root`` is misconfigured. Without this the error is
        deferred to the first write deep inside :meth:`Dataset.save`, far from
        the misconfiguration. Call once, right after construction."""
        if not self.root.is_dir():
            raise NotADirectoryError(f"Settings.root is not a directory: {self.root}")
        return self

    @property
    def scores_csv(self) -> Path:
        return self.root / "public" / "scores.csv"

    @property
    def regulation_csv(self) -> Path:
        return self.root / "public" / "regulation_data.csv"

    @property
    def history_json(self) -> Path:
        return self.root / "public" / "history.json"

    @property
    def country_names_json(self) -> Path:
        return self.root / "public" / "data" / "country_names.json"

    @property
    def subscores_json(self) -> Path:
        return self.root / "public" / "data" / "subscores.json"

    @property
    def country_iso_json(self) -> Path:
        return self.root / "public" / "data" / "country_iso.json"

    @property
    def pending_json(self) -> Path:
        """Score candidates the stability gate held for one run (see gate.py)."""
        return self.root / "public" / "data" / "pending.json"
