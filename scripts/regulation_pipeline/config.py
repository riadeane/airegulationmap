"""Configuration for the regulation data pipeline.

Two kinds of thing live here:

* **Constants that are contracts** — the CSV column order/headers the frontend
  loader depends on, the staleness threshold, the priority-country set, and the
  default model. These are module-level so they read as the fixed contract they
  are.
* **:class:`Settings`** — the injectable bundle of *where things live* and
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

# Default research model. Deliberately Sonnet 4.6, not an Opus tier — a full
# ~196-country monthly run is cost-sensitive and this is the chosen tradeoff.
DEFAULT_MODEL = "claude-sonnet-4-6"

# Web search runs must use a model that supports the web_search_20260209 tool
# (dynamic filtering). Sonnet 4.6 does; keep search runs on it regardless of the
# --model flag.
SEARCH_MODEL = "claude-sonnet-4-6"

# Countries that get web search under --search (the two-tier priority system).
PRIORITY_COUNTRIES = frozenset({
    "United States of America", "United Kingdom", "China", "European Union",
    "Germany", "France", "Brazil", "India", "Japan", "Canada", "Australia",
    "Singapore", "South Korea", "United Arab Emirates", "Saudi Arabia", "South Africa",
    "Kenya", "Nigeria", "Indonesia", "Mexico", "Chile", "Argentina",
})


@dataclass(frozen=True)
class Settings:
    """Where the pipeline reads and writes, plus the run-wide knobs. Paths are
    derived from :attr:`root`; override ``root`` to redirect all I/O (tests do
    this with a temp directory)."""

    root: Path = REPO_ROOT
    staleness_days: int = STALENESS_DAYS
    default_model: str = DEFAULT_MODEL
    search_model: str = SEARCH_MODEL
    priority_countries: frozenset[str] = PRIORITY_COUNTRIES

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
