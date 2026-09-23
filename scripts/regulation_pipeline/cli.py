"""Command-line entry point.

A thin Typer command that wires the pieces together and translates the run
outcome into an exit code. All the real work lives in
:class:`~regulation_pipeline.service.PipelineService`; this layer only handles
argument parsing, logging setup, credentials, and dependency construction.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections.abc import Callable
from datetime import date
from pathlib import Path

import anthropic
import typer

from .api import ResearchClient
from .batch import BatchRunner
from . import gate
from .config import DEFAULT_MODEL, Settings
from .digest import write_run_digest
from .names import CountryNames
from .prompt import GROUNDED_PROMPT_VERSION, PROMPT_VERSION
from .repository import Dataset
from .service import PipelineService, RunResult
from .staleness import StalenessPolicy
from .strategies import BatchStrategy, SyncStrategy

logger = logging.getLogger("regulation_pipeline")


def configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)-7s %(message)s",
        stream=sys.stderr,
        force=True,
    )


def _run(
    countries: str = typer.Option("", help="Comma-separated countries to update"),
    force: bool = typer.Option(
        True, "--force/--no-force",
        help="Update every selected country regardless of staleness (default). "
        "--no-force updates only stale or low-confidence countries.",
    ),
    dry_run: bool = typer.Option(False, help="Show what would change without writing"),
    model: str = typer.Option(DEFAULT_MODEL, help="Claude model to use"),
    search: bool = typer.Option(
        True, "--search/--no-search",
        help="Give the model web search for every country (default).",
    ),
    batch: bool = typer.Option(
        True, "--batch/--no-batch",
        help="Use the Message Batches API: 50% token pricing, results within ~1h "
        "(default). --no-batch runs synchronously.",
    ),
    max_runtime_minutes: int = typer.Option(
        0, help="Abort a sync run after this many minutes (0 = unbounded). Bounds the "
        "worst case when the API is slow-but-not-failing. Ignored with --batch."
    ),
    mirror: bool | None = typer.Option(
        None, "--mirror/--no-mirror",
        help="Dual-write results to Supabase (research_runs provenance, scores, "
        "summaries, history, sources). Default: on when SUPABASE_URL and "
        "SUPABASE_SERVICE_KEY are set. Mirror failures never fail the run.",
    ),
    grounded: bool = typer.Option(
        False, "--grounded",
        help="Ground research in verified policy initiatives (from Supabase, or "
        "--evidence-file). Countries without evidence fall back to the plain "
        "prompt. Grounded prompts are longer - pair with --batch.",
    ),
    evidence_file: str = typer.Option(
        "", "--evidence-file",
        help='Offline evidence for --grounded: JSON {"<country>": [initiative, ...]}.',
    ),
    gate_enabled: bool = typer.Option(
        True, "--gate/--no-gate",
        help="Stability gate (default on): a score change lands only with new "
        "evidence (a new source URL or changed laws) or when the same change "
        "repeats on the next run. --no-gate applies every score; on a full run "
        "it needs --break-reason.",
    ),
    break_reason: str = typer.Option(
        "", "--break-reason",
        help="With --no-gate: record a calibration break {date, model, "
        "prompt_version, reason} in history.json so the frontend labels the "
        "shift as a recalibration, not as policy change.",
    ),
    digest: bool | None = typer.Option(
        None, "--digest/--no-digest",
        help="Write the weekly digest (public/digest/) after the run. Default: on "
        "for scheduled runs (GITHUB_EVENT_NAME=schedule), off otherwise. A digest "
        "failure never fails the run.",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose (DEBUG) logging"),
) -> None:
    """Update AI regulation data using the Claude API."""
    configure_logging(verbose)

    full_run = not countries.strip()
    if not gate_enabled and full_run and not break_reason.strip():
        logger.error(
            "--no-gate on a full run needs --break-reason \"<why the scale moved>\" "
            "(a calibration reset is a recorded break, never silent drift)"
        )
        raise typer.Exit(code=1)
    if break_reason.strip() and gate_enabled:
        logger.error("--break-reason only applies with --no-gate")
        raise typer.Exit(code=1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        raise typer.Exit(code=1)

    settings = Settings(default_model=model).validate()
    today = date.today()

    # SDK-level silent retries are disabled - retry.py does explicit, logged
    # retries with backoff, and the two must not multiply.
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    names = CountryNames.load(settings.country_names_json)

    evidence_provider = None
    if grounded:
        evidence_provider = _build_evidence_provider(evidence_file)
        if evidence_provider is None:
            logger.error(
                "--grounded needs either SUPABASE_URL + SUPABASE_SERVICE_KEY or --evidence-file"
            )
            raise typer.Exit(code=1)

    research_client = ResearchClient(
        client, model=model, today=today, evidence_provider=evidence_provider,
    )

    def use_search_for(country: str) -> bool:
        return search

    batch_runner = BatchRunner(client) if batch else None
    strategy = (
        BatchStrategy(research_client, batch_runner, use_search_for)
        if batch_runner
        else SyncStrategy(
            research_client,
            use_search_for,
            max_wall_seconds=max_runtime_minutes * 60 if max_runtime_minutes > 0 else None,
        )
    )

    logger.info("Loading existing data...")
    dataset = Dataset.load(settings, names)
    supabase_mirror = _build_mirror(
        mirror, settings, model=model, batch=batch, grounded=grounded,
        research_client=research_client, batch_runner=batch_runner,
    )
    prompt_version = GROUNDED_PROMPT_VERSION if grounded else PROMPT_VERSION
    calibration_break = None
    if not gate_enabled and break_reason.strip():
        calibration_break = {
            "date": today.isoformat(),
            "model": model,
            "prompt_version": prompt_version,
            "reason": break_reason.strip(),
        }
    service = PipelineService(
        dataset, StalenessPolicy(settings.staleness_days, today), today,
        mirror=supabase_mirror,
        gate_enabled=gate_enabled,
        calibration_break=calibration_break,
        run_id=supabase_mirror.run_id if supabase_mirror is not None else None,
    )
    write_digest = digest if digest is not None else _is_scheduled()

    targets = None
    if not full_run:
        targets = [names.canonical(c) for c in countries.split(",") if c.strip()]

    all_targets, to_update = service.select(targets, force=force)
    logger.info("Countries to update: %d / %d", len(to_update), len(all_targets))
    if not to_update:
        logger.info("Nothing to update.")
        if write_digest and not dry_run:
            _write_digest(RunResult(updated=0, failed=[]), client, settings, model, today)
        return

    if dry_run:
        logger.info("DRY RUN - would update (with the gate's standing per country):")
        for country in to_update:
            logger.info("  %s: %s", country, service.standing(country))
        if calibration_break:
            logger.info("DRY RUN - would record break: %s", calibration_break["reason"])
        return

    result = service.run(strategy, to_update)
    logger.info(result.gate.summary_line())
    for line in gate.review_lines(result.gate):
        logger.warning(line)
    _write_step_summary(gate.markdown_summary(result.gate, calibration_break))
    if write_digest:
        _write_digest(result, client, settings, model, today)
    if result.fatal:
        raise typer.Exit(code=2)

    logger.info("Done. Updated %d countries.", result.updated)
    if result.failed:
        logger.warning(
            "Failed countries (%d): %s", len(result.failed), ", ".join(result.failed)
        )
        raise typer.Exit(code=1)


def _is_scheduled() -> bool:
    return os.environ.get("GITHUB_EVENT_NAME") == "schedule"


def _write_digest(
    result: RunResult, client: anthropic.Anthropic, settings: Settings, model: str, today: date,
) -> None:
    """Post-run digest. Downgraded to a warning on any failure: the data
    files are already saved, and a missing digest must not change the exit
    code that drives the workflow's commit step."""
    try:
        write_run_digest(result, client=client, settings=settings, model=model, run_date=today)
    except Exception:
        logger.warning("digest: failed - continuing", exc_info=True)


def _write_step_summary(markdown: str) -> None:
    """Append to the GitHub Actions step summary when the workflow set
    ``GITHUB_STEP_SUMMARY``; a no-op elsewhere."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(markdown)
    except OSError:
        logger.warning("could not write GITHUB_STEP_SUMMARY", exc_info=True)


def _build_evidence_provider(evidence_file: str) -> Callable[[str], list[dict]] | None:
    """Evidence for --grounded: an offline JSON file, or ONE up-front
    PostgREST fetch of every linked initiative, grouped by country.

    Prefetching (rather than a per-country select at prompt-build time) is a
    correctness property, not an optimization: the provider runs inside
    request_params, deep in the research loop, where the service only knows
    how to handle FatalAPIError - a transient Supabase error there would
    crash the run AFTER countries were researched but BEFORE dataset.save(),
    losing paid-for results. Failing here, before any research starts, is
    cheap and loud."""
    if evidence_file:
        data = json.loads(Path(evidence_file).read_text(encoding="utf-8"))
        return lambda country: data.get(country, [])

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None

    from .db.client import SupabaseClient

    with SupabaseClient(url, key) as client:
        names_by_id = {
            r["id"]: r["name"]
            for r in client.select_all("countries", {"select": "id,name"})
        }
        by_country: dict[str, list[dict]] = {}
        rows = client.select_all("policy_initiatives", {
            "select": "country_id,name,start_year,initiative_type,binding,status,overview,source_url",
            "country_id": "not.is.null",
            "order": "start_year.desc.nullslast",
        })
        for row in rows:
            country = names_by_id.get(row.pop("country_id"))
            if country:
                by_country.setdefault(country, []).append(row)

    logger.info(
        "grounded: evidence loaded for %d countries (%d initiatives)",
        len(by_country), sum(len(v) for v in by_country.values()),
    )
    return lambda country: by_country.get(country, [])


def _build_mirror(
    flag: bool | None,
    settings: Settings,
    *,
    model: str,
    batch: bool,
    grounded: bool,
    research_client: ResearchClient,
    batch_runner: BatchRunner | None,
):
    """Construct the Supabase dual-write mirror when configured.

    ``flag`` is the tri-state --mirror/--no-mirror option: None means "auto"
    (mirror iff the env credentials exist); an explicit --mirror without
    credentials is a configuration error worth failing loudly on.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if flag is False:
        return None
    if not (url and key):
        if flag is True:
            logger.error("--mirror requires SUPABASE_URL and SUPABASE_SERVICE_KEY")
            raise typer.Exit(code=1)
        return None

    from .db.client import SupabaseClient
    from .db.mirror import RunMeta, SupabaseMirror

    def usage_totals() -> dict[str, int]:
        totals = research_client.usage()
        if batch_runner is not None:
            batch_usage = batch_runner.usage()
            totals = {
                "input": totals["input"] + batch_usage["input"],
                "output": totals["output"] + batch_usage["output"],
            }
        return totals

    meta = RunMeta(
        trigger="schedule" if _is_scheduled() else "manual",
        model=model,
        strategy="batch" if batch else "sync",
        prompt_version=GROUNDED_PROMPT_VERSION if grounded else PROMPT_VERSION,
        grounded=grounded,
        git_sha=os.environ.get("GITHUB_SHA"),
    )
    logger.info("Supabase mirror enabled (%s run)", meta.trigger)
    return SupabaseMirror(
        SupabaseClient(url, key), meta,
        iso_path=settings.country_iso_json,
        usage_provider=usage_totals,
    )


def main() -> None:
    typer.run(_run)


if __name__ == "__main__":
    main()
