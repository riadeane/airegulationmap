"""The gold set and the drift check.

Ten hand-verified countries in ``public/data/gold_set.json`` anchor the
scale. After every run, the raw sub-indicators the model returned for those
countries (before the stability gate, so the check measures the model and
not the gate) are compared with the gold scores. One row of agreement
metrics per run is appended to ``public/data/drift.json`` and mirrored to
the Supabase ``gold_checks`` table. The check costs no extra API calls on a
scheduled run and never fails one: drift is reported, not enforced.

Three metrics, all pure functions of the two score sets (:func:`compare`):

* ``mae_by_dimension`` - mean absolute error over the sub-indicators of each
  dimension, across the compared countries;
* ``within_one`` - the share of compared sub-indicators whose run score is
  within one point of the gold score;
* ``max_dev`` - the largest single deviation, with where it happened.

``python -m regulation_pipeline.gold --model <id>`` researches only the
gold countries with the given model and prints the same metrics without
touching the dataset: the model-comparison tool.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import typer

from .config import Settings
from .models import ResearchResult

if TYPE_CHECKING:  # the mirror is optional; keep the db layer out of the import graph
    from .db.mirror import SupabaseMirror
    from .service import RunResult
    from .strategies import ResearchStrategy

logger = logging.getLogger(__name__)

GOLD_SET_SCHEMA_VERSION = 1
DRIFT_SCHEMA_VERSION = 1

# A run whose within-one share falls below this prefixes its summary with
# "Calibration warning". It never changes the exit code.
WARN_WITHIN_ONE = 0.8

STATUSES = ("draft", "verified")

# Dimension key -> the four sub-indicator names, in the model's order. The
# gold file must carry exactly these 20 scores per country.
SUBINDICATORS: dict[str, tuple[str, ...]] = {
    dim.key: dim.subindicators() for dim in ResearchResult.DIMENSIONS
}
DIMENSIONS: tuple[str, ...] = tuple(SUBINDICATORS)


class GoldSetError(ValueError):
    """The gold set file is malformed."""


# -- the gold set ----------------------------------------------------------------


@dataclass(frozen=True)
class GoldCountry:
    """One hand-verified country: 20 sub-indicator scores (five dimensions
    times four), a one-line
    justification per dimension, the sources used, and its verification
    state. ``status`` is ``draft`` until the maintainer checks every score
    against the sources and records ``verified_on``."""

    country: str
    status: str
    subscores: dict[str, dict[str, int]]
    justification: dict[str, str]
    sources: tuple[str, ...]
    verified_on: str | None = None
    drafted_on: str | None = None


@dataclass(frozen=True)
class GoldSet:
    countries: tuple[GoldCountry, ...]

    def names(self) -> list[str]:
        return [c.country for c in self.countries]

    def __len__(self) -> int:
        return len(self.countries)

    def verified(self) -> list[str]:
        return [c.country for c in self.countries if c.status == "verified"]


def load_gold_set(path: Path) -> GoldSet:
    """Read and validate ``gold_set.json``. Raises :class:`GoldSetError` on
    any shape problem, so a broken file is loud rather than a silent skip."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise GoldSetError(f"cannot read {path}: {exc}") from exc
    return parse_gold_set(data)


def parse_gold_set(data: dict) -> GoldSet:
    """Validate the file's document shape. Every country needs the 20
    sub-indicators the models define, integer scores 1-5, a justification
    per dimension, at least one source, and a status; a verified country
    needs its verification date."""
    if not isinstance(data, dict) or not isinstance(data.get("countries"), list):
        raise GoldSetError("gold set must be an object with a 'countries' list")
    countries: list[GoldCountry] = []
    seen: set[str] = set()
    for i, entry in enumerate(data["countries"]):
        countries.append(_parse_country(entry, i))
        if countries[-1].country in seen:
            raise GoldSetError(f"duplicate gold country {countries[-1].country!r}")
        seen.add(countries[-1].country)
    if not countries:
        raise GoldSetError("gold set has no countries")
    return GoldSet(tuple(countries))


def _parse_country(entry: object, index: int) -> GoldCountry:
    if not isinstance(entry, dict):
        raise GoldSetError(f"countries[{index}] is not an object")
    name = entry.get("country")
    if not isinstance(name, str) or not name.strip():
        raise GoldSetError(f"countries[{index}] has no country name")
    label = f"gold country {name!r}"

    status = entry.get("status")
    if status not in STATUSES:
        raise GoldSetError(f"{label}: status must be one of {STATUSES}, got {status!r}")
    verified_on = entry.get("verified_on")
    if status == "verified" and not _is_date(verified_on):
        raise GoldSetError(f"{label}: a verified country needs verified_on (YYYY-MM-DD)")
    if verified_on is not None and not _is_date(verified_on):
        raise GoldSetError(f"{label}: verified_on must be YYYY-MM-DD or null")
    drafted_on = entry.get("drafted_on")
    if drafted_on is not None and not _is_date(drafted_on):
        raise GoldSetError(f"{label}: drafted_on must be YYYY-MM-DD or null")

    raw_scores = entry.get("subscores")
    if not isinstance(raw_scores, dict):
        raise GoldSetError(f"{label}: subscores must be an object")
    subscores: dict[str, dict[str, int]] = {}
    for dimension, names in SUBINDICATORS.items():
        block = raw_scores.get(dimension)
        if not isinstance(block, dict):
            raise GoldSetError(f"{label}: subscores.{dimension} is missing")
        if set(block) != set(names):
            raise GoldSetError(
                f"{label}: subscores.{dimension} must have exactly {list(names)}, "
                f"got {sorted(block)}"
            )
        subscores[dimension] = {}
        for sub in names:
            value = block[sub]
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
                raise GoldSetError(
                    f"{label}: subscores.{dimension}.{sub} must be an integer 1-5, got {value!r}"
                )
            subscores[dimension][sub] = value
    extra = set(raw_scores) - set(SUBINDICATORS)
    if extra:
        raise GoldSetError(f"{label}: unknown dimensions in subscores: {sorted(extra)}")

    justification = entry.get("justification")
    if not isinstance(justification, dict):
        raise GoldSetError(f"{label}: justification must be an object")
    for dimension in SUBINDICATORS:
        text = justification.get(dimension)
        if not isinstance(text, str) or not text.strip():
            raise GoldSetError(f"{label}: justification.{dimension} is missing")

    sources = entry.get("sources")
    if (
        not isinstance(sources, list)
        or not sources
        or not all(isinstance(s, str) and s.strip() for s in sources)
    ):
        raise GoldSetError(f"{label}: sources must be a non-empty list of URLs")

    return GoldCountry(
        country=name.strip(),
        status=status,
        subscores=subscores,
        justification={k: justification[k].strip() for k in SUBINDICATORS},
        sources=tuple(s.strip() for s in sources),
        verified_on=verified_on,
        drafted_on=drafted_on,
    )


def _is_date(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


# -- metrics ------------------------------------------------------------------


@dataclass(frozen=True)
class Deviation:
    """One compared sub-indicator: the gold score and the run's score."""

    country: str
    dimension: str
    subindicator: str
    gold: int
    run: int

    @property
    def delta(self) -> int:
        return abs(self.run - self.gold)

    def to_json(self) -> dict:
        return {
            "country": self.country,
            "dimension": self.dimension,
            "subindicator": self.subindicator,
            "gold": self.gold,
            "run": self.run,
        }


@dataclass(frozen=True)
class GoldMetrics:
    """Agreement between a run and the gold set.

    ``compared`` lists the gold countries the run returned a result for, in
    gold-set order; ``missing`` the rest. The three metrics cover every
    sub-indicator of every compared country. ``max_dev`` is ``None`` only
    when nothing was compared.
    """

    compared: tuple[str, ...]
    missing: tuple[str, ...]
    mae_by_dimension: dict[str, float]
    within_one: float
    max_dev: Deviation | None
    count: int

    @property
    def warning(self) -> bool:
        """True when the within-one share is below :data:`WARN_WITHIN_ONE`."""
        return bool(self.compared) and self.within_one < WARN_WITHIN_ONE


def deviations(gold: GoldSet, results: Mapping[str, ResearchResult]) -> Iterator[Deviation]:
    """Every (country, dimension, sub-indicator) pair the run and the gold
    set both score, in gold-set order."""
    for entry in gold.countries:
        result = results.get(entry.country)
        if result is None:
            continue
        run_dims = result.dimensions()
        for dimension, names in SUBINDICATORS.items():
            run_scores = run_dims[dimension].subscores()
            for sub in names:
                yield Deviation(
                    entry.country, dimension, sub, entry.subscores[dimension][sub], run_scores[sub],
                )


def compare(gold: GoldSet, results: Mapping[str, ResearchResult]) -> GoldMetrics:
    """The three metrics for ``results`` (raw, ungated ``ResearchResult`` per
    country) against ``gold``. Pure: no I/O, no logging."""
    devs = list(deviations(gold, results))
    compared = tuple(c for c in gold.names() if c in results)
    missing = tuple(c for c in gold.names() if c not in results)
    if not devs:
        return GoldMetrics(compared, missing, {}, 0.0, None, 0)

    mae: dict[str, float] = {}
    for dimension in DIMENSIONS:
        in_dim = [d.delta for d in devs if d.dimension == dimension]
        mae[dimension] = round(sum(in_dim) / len(in_dim), 3)
    within = sum(1 for d in devs if d.delta <= 1) / len(devs)
    # max() keeps the first of equal deltas, so ties resolve in gold-set order.
    worst = max(devs, key=lambda d: d.delta)
    return GoldMetrics(compared, missing, mae, round(within, 3), worst, len(devs))


# -- the drift record ----------------------------------------------------------


def drift_row(
    metrics: GoldMetrics, *, run_id: str, run_date: date, model: str, prompt_version: str,
) -> dict:
    """One ``drift.json`` row (and the shape mirrored to ``gold_checks``)."""
    return {
        "run_id": run_id,
        "date": run_date.isoformat(),
        "model": model,
        "prompt_version": prompt_version,
        "countries_compared": len(metrics.compared),
        "countries_missing": list(metrics.missing),
        "mae_by_dimension": dict(metrics.mae_by_dimension),
        "within_one": metrics.within_one,
        "max_dev": metrics.max_dev.delta if metrics.max_dev else None,
        "max_dev_at": metrics.max_dev.to_json() if metrics.max_dev else None,
    }


def load_drift(path: Path) -> dict:
    if not path.exists():
        return {"schema_version": DRIFT_SCHEMA_VERSION, "checks": []}
    return json.loads(path.read_text(encoding="utf-8"))


def append_drift_row(path: Path, row: dict) -> dict:
    """Append ``row`` to ``drift.json`` (creating it) and return the document."""
    document = load_drift(path)
    checks = document.setdefault("checks", [])
    checks.append(row)
    _write(path, json.dumps(document, ensure_ascii=False, indent=2))
    return document


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# -- reporting -------------------------------------------------------------------


def summary_line(metrics: GoldMetrics, gold: GoldSet) -> str:
    """One log line: ``gold: ...``, prefixed with the warning when due."""
    if not metrics.compared:
        return f"gold: none of the {len(gold)} gold countries in this run"
    parts = [
        f"{len(metrics.compared)}/{len(gold)} countries",
        f"within_one={metrics.within_one:.3f}",
        f"max_dev={_max_dev_text(metrics)}",
        "mae " + " ".join(f"{k}={v:.2f}" for k, v in metrics.mae_by_dimension.items()),
    ]
    line = "gold: " + ", ".join(parts)
    return f"Calibration warning: {line}" if metrics.warning else line


def markdown_summary(metrics: GoldMetrics, gold: GoldSet) -> str:
    """The gold-set block for the GitHub step summary. Starts with
    "Calibration warning" when the within-one share is below the threshold."""
    heading = "## Calibration warning: gold set" if metrics.warning else "## Gold set"
    out = ["", heading, ""]
    if not metrics.compared:
        out.append(f"None of the {len(gold)} gold countries were in this run.")
        return "\n".join(out) + "\n"
    if metrics.warning:
        out += [
            f"Only {metrics.within_one:.0%} of the compared sub-indicators are within one "
            f"point of the gold scores (threshold {WARN_WITHIN_ONE:.0%}). The run is not "
            "failed; check the model and prompt before trusting this week's scores.",
            "",
        ]
    verified = len(gold.verified())
    out.append("| Metric | Value |")
    out.append("|--------|-------|")
    out.append(
        f"| Countries compared | {len(metrics.compared)} of {len(gold)} "
        f"({verified} verified, {len(gold) - verified} draft) |"
    )
    out.append(f"| Sub-indicators compared | {metrics.count} |")
    out.append(f"| Within one point | {metrics.within_one:.3f} |")
    out.append(f"| Largest deviation | {_max_dev_text(metrics)} |")
    out += ["", "| Dimension | MAE |", "|-----------|-----|"]
    for dimension, value in metrics.mae_by_dimension.items():
        out.append(f"| `{dimension}` | {value:.2f} |")
    if metrics.missing:
        out += ["", "Missing from this run: " + ", ".join(metrics.missing)]
    return "\n".join(out) + "\n"


def _max_dev_text(metrics: GoldMetrics) -> str:
    dev = metrics.max_dev
    if dev is None:
        return "n/a"
    return f"{dev.delta} ({dev.country} {dev.dimension}.{dev.subindicator}: gold {dev.gold}, run {dev.run})"


def text_report(metrics: GoldMetrics, gold: GoldSet, results: Mapping[str, ResearchResult]) -> str:
    """Plain-text report for the CLI: the metrics, then one line per
    compared country with its deviations of two points or more."""
    lines = [summary_line(metrics, gold), ""]
    if not metrics.compared:
        return "\n".join(lines)
    lines.append(f"{'dimension':<20} {'MAE':>6}")
    for dimension, value in metrics.mae_by_dimension.items():
        lines.append(f"{dimension:<20} {value:>6.2f}")
    lines.append("")
    big = [d for d in deviations(gold, results) if d.delta >= 2]
    if big:
        lines.append("Deviations of two points or more:")
        for d in big:
            lines.append(f"  {d.country}: {d.dimension}.{d.subindicator} gold {d.gold}, run {d.run}")
    else:
        lines.append("No deviation of two points or more.")
    if metrics.missing:
        lines.append("Missing: " + ", ".join(metrics.missing))
    return "\n".join(lines)


# -- the post-run check ------------------------------------------------------


@dataclass(frozen=True)
class GoldCheck:
    metrics: GoldMetrics
    gold: GoldSet
    row: dict


def check_run(
    result: RunResult,
    settings: Settings,
    *,
    model: str,
    prompt_version: str,
    run_date: date,
    mirror: SupabaseMirror | None = None,
) -> GoldCheck | None:
    """Compare the run's raw results with the gold set, append the drift row,
    and mirror it. Returns ``None`` (after a log line) when the gold file is
    absent or none of the gold countries were in the run. Raises on a
    malformed gold file or an unwritable drift file; the CLI downgrades that
    to a warning so the check can never change a run's exit code."""
    if not settings.gold_set_json.exists():
        logger.info("gold: no gold set at %s - check skipped", settings.gold_set_json)
        return None
    gold = load_gold_set(settings.gold_set_json)
    metrics = compare(gold, result.raw_results)
    logger.info(summary_line(metrics, gold))
    if not metrics.compared:
        return None
    row = drift_row(
        metrics, run_id=result.run_id, run_date=run_date, model=model,
        prompt_version=prompt_version,
    )
    append_drift_row(settings.drift_json, row)
    logger.info("gold: drift row appended to %s", settings.drift_json.relative_to(settings.root))
    if mirror is not None:
        try:
            mirror.record_gold_check(row)
        except Exception:
            logger.warning("gold: mirror to gold_checks failed - continuing", exc_info=True)
    return GoldCheck(metrics, gold, row)


# -- the model-comparison CLI --------------------------------------------------


def research_gold(
    strategy: ResearchStrategy, gold: GoldSet, reg_rows: Mapping[str, dict],
) -> dict[str, ResearchResult]:
    """Research the gold countries with ``strategy`` and return the valid
    results by country. Nothing is written to the dataset."""
    countries = gold.names()
    results: dict[str, ResearchResult] = {}
    for country, result in strategy.research(countries, dict(reg_rows)):
        if result is None:
            logger.warning("gold: no valid result for %s", country)
            continue
        results[country] = result
    return results


def _compare_cli(
    model: str = typer.Option(..., "--model", help="Claude model to research the gold countries with"),
    search: bool = typer.Option(
        True, "--search/--no-search", help="Give the model web search (default), as the weekly run does.",
    ),
    batch: bool = typer.Option(
        False, "--batch/--no-batch",
        help="Use the Message Batches API (50% token pricing, results within ~1h). "
        "Default: synchronous, so ten countries answer in minutes.",
    ),
    json_out: bool = typer.Option(False, "--json", help="Print the drift row as JSON instead of the report."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose (DEBUG) logging"),
) -> None:
    """Research only the gold-set countries with MODEL and print the agreement
    metrics. The model-comparison tool: it never writes scores, history or
    drift.json. Needs ANTHROPIC_API_KEY."""
    import anthropic

    from .api import ResearchClient
    from .batch import BatchRunner
    from .cli import configure_logging
    from .names import CountryNames
    from .prompt import PROMPT_VERSION
    from .repository import Dataset
    from .strategies import BatchStrategy, SyncStrategy

    configure_logging(verbose)
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        raise typer.Exit(code=1)

    settings = Settings(default_model=model).validate()
    try:
        gold = load_gold_set(settings.gold_set_json)
    except GoldSetError as exc:
        logger.error("%s", exc)
        raise typer.Exit(code=1) from exc
    today = date.today()
    names = CountryNames.load(settings.country_names_json)
    dataset = Dataset.load(settings, names)
    reg_rows = {c: dataset.regulation_row(c) or {} for c in gold.names()}

    # SDK-level silent retries stay off; retry.py does explicit, logged retries.
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    research_client = ResearchClient(client, model=model, today=today)
    strategy = (
        BatchStrategy(research_client, BatchRunner(client), lambda _c: search)
        if batch
        else SyncStrategy(research_client, lambda _c: search)
    )
    logger.info("gold: researching %d countries with %s", len(gold), model)
    results = research_gold(strategy, gold, reg_rows)
    metrics = compare(gold, results)
    if json_out:
        row = drift_row(
            metrics, run_id=str(uuid.uuid4()), run_date=today, model=model,
            prompt_version=PROMPT_VERSION,
        )
        typer.echo(json.dumps(row, ensure_ascii=False, indent=2))
    else:
        typer.echo(text_report(metrics, gold, results))
    if not metrics.compared:
        raise typer.Exit(code=1)


def main() -> None:
    typer.run(_compare_cli)


if __name__ == "__main__":  # pragma: no cover - exercised via python -m
    main()
