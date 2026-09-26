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

# Public origin of the deployed site. Absolute links in the digest feed
# (Atom ids, alternate links) are built from it.
SITE_URL = "https://airegulationmap.org"

# Default research model. The model must support the web_search_20260209
# tool and structured outputs (Opus 5, Opus 4.8, Sonnet 5, and Sonnet 4.6 do).
# Opus 5 thinks by default, which suits the judgment-heavy scoring rubric.
DEFAULT_MODEL = "claude-opus-5"

# List prices in USD per million tokens (input, output), for the rough
# per-run cost estimate in research_runs.est_cost_usd. Batch requests bill
# tokens at half these rates; web search bills per request. Prices change:
# the estimate is a guide, and a model missing here records no estimate.
MODEL_PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
WEB_SEARCH_USD_PER_REQUEST = 10.0 / 1000
BATCH_DISCOUNT = 0.5


def estimate_cost_usd(model: str, sync: dict[str, int], batch: dict[str, int]) -> float | None:
    """Rough USD cost of a run from its token and search counts: sync tokens
    at list price, batch tokens at half, every web search request at
    $10 per 1,000. ``None`` for a model without a listed price."""
    prices = MODEL_PRICES_PER_MTOK.get(model)
    if prices is None:
        return None
    price_in, price_out = prices

    def tokens(usage: dict[str, int]) -> float:
        return (usage.get("input", 0) * price_in + usage.get("output", 0) * price_out) / 1_000_000

    searches = sync.get("searches", 0) + batch.get("searches", 0)
    total = tokens(sync) + BATCH_DISCOUNT * tokens(batch) + searches * WEB_SEARCH_USD_PER_REQUEST
    return round(total, 2)


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

    @property
    def digest_dir(self) -> Path:
        """Weekly digest files: ``YYYY-Www.json``, ``index.json``, ``feed.xml``."""
        return self.root / "public" / "digest"

    @property
    def gold_set_json(self) -> Path:
        """Hand-verified sub-indicator scores for ten countries (see gold.py)."""
        return self.root / "public" / "data" / "gold_set.json"

    @property
    def drift_json(self) -> Path:
        """One row of gold-set agreement metrics per run (see gold.py)."""
        return self.root / "public" / "data" / "drift.json"
