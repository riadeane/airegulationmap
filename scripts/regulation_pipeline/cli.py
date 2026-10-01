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
from datetime import UTC, date, datetime
from pathlib import Path

import anthropic
import typer

from . import gate, handoff
from . import history as history_mod
from .api import ResearchClient
from .batch import BatchPending, BatchRunner
from .config import DEFAULT_MODEL, Settings, estimate_cost_usd
from .consistency import eu_members, eu_outliers
from .consistency import log_lines as eu_log_lines
from .consistency import markdown_summary as eu_markdown_summary
from .digest import write_run_digest
from .frontier import FrontierContext, FrontierDataError
from .gold import check_run, frontier_markdown, markdown_summary
from .links import LinkChecker
from .names import CountryNames
from .prompt import GROUNDED_PROMPT_VERSION, PROMPT_VERSION, RUBRIC_VERSION
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
    # httpx logs every request at INFO; the link check alone makes one per
    # cited URL. Keep them for --verbose.
    logging.getLogger("httpx").setLevel(logging.DEBUG if verbose else logging.WARNING)


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
        help="Use the Message Batches API: 50% token pricing, results within 24h "
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
    link_check: bool = typer.Option(
        True, "--link-check/--no-link-check",
        help="Fetch every cited URL after research and drop the dead ones (404, "
        "410, a not-found page, a known-bad pattern) before they are written "
        "(default). Blocked or unreachable URLs are kept.",
    ),
    digest: bool | None = typer.Option(
        None, "--digest/--no-digest",
        help="Write the weekly digest (public/digest/) after the run. Default: on "
        "for scheduled runs (GITHUB_EVENT_NAME=schedule), off otherwise. A digest "
        "failure never fails the run.",
    ),
    collect_only: bool = typer.Option(
        False, "--collect-only",
        help="Only collect a batch an earlier run left running (state/open_batch.json); "
        "exit 0 without any API call when there is none. Any run collects an open "
        "batch first and submits nothing new while one is recorded.",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose (DEBUG) logging"),
) -> None:
    """Update AI regulation data using the Claude API."""
    configure_logging(verbose)

    # A batch an earlier run left running is collected before anything else,
    # with the options it was submitted with, and nothing new is submitted
    # while one is recorded (#194).
    state_path = Settings().open_batch_json
    open_batch = handoff.load(state_path)
    if open_batch is None and collect_only:
        logger.info("No open batch to collect.")
        return
    if open_batch is not None:
        if open_batch.expired(datetime.now(UTC)):
            logger.error(
                "Open batch %s was submitted more than 29 days ago; its results are gone. "
                "Removing the record. %d countries were not updated.",
                open_batch.batch.batch_id, len(open_batch.countries),
            )
            handoff.clear(state_path)
            raise typer.Exit(code=1)
        options = open_batch.options
        logger.warning(
            "Open batch %s (%d countries, submitted %s): collecting it with the options it "
            "was submitted with; this run's other flags are ignored.",
            open_batch.batch.batch_id, len(open_batch.countries),
            open_batch.batch.submitted_at.isoformat() if open_batch.batch.submitted_at else "?",
        )
        if dry_run:
            logger.info("DRY RUN - would collect batch %s", open_batch.batch.batch_id)
            return
        model = options.get("model", model)
        search = options.get("search", search)
        grounded = options.get("grounded", grounded)
        gate_enabled = options.get("gate_enabled", gate_enabled)
        break_reason = options.get("break_reason", "")
        digest = options.get("digest", False)
        countries = "" if options.get("full_run", True) else ",".join(open_batch.countries)
        batch, force = True, True

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

    try:
        frontier = FrontierContext.load(settings)
    except FrontierDataError as exc:
        logger.error("frontier reference data is malformed: %s. Nothing was researched.", exc)
        raise typer.Exit(code=1) from exc

    research_client = ResearchClient(
        client, model=model, today=today, evidence_provider=evidence_provider, frontier=frontier,
    )

    def use_search_for(country: str) -> bool:
        return search

    batch_runner = BatchRunner(client, handoff=True) if batch else None
    strategy = (
        BatchStrategy(
            research_client, batch_runner, use_search_for,
            resume=open_batch.batch if open_batch is not None else None,
        )
        if batch_runner
        else SyncStrategy(
            research_client,
            use_search_for,
            max_wall_seconds=max_runtime_minutes * 60 if max_runtime_minutes > 0 else None,
        )
    )

    logger.info("Loading existing data...")
    dataset = Dataset.load(settings, names)
    inconsistent = dataset.consistency_errors()
    if inconsistent:
        # A save interrupted between two renames mixes old and new files;
        # researching on top would bake the mismatch in (#149).
        for error in inconsistent:
            logger.error("data files disagree: %s", error)
        logger.error(
            "The data files in public/ disagree (an interrupted save?). Restore them "
            "from git before running. Nothing was researched."
        )
        raise typer.Exit(code=1)

    targets = None
    if not full_run:
        targets, unknown = [], []
        for raw_name in (c for c in countries.split(",") if c.strip()):
            resolved = names.resolve(raw_name, dataset.countries())
            (targets if resolved else unknown).append(resolved or raw_name.strip())
        targets = list(dict.fromkeys(targets))  # "Germany,germany" researches once
        if unknown:
            logger.error(
                "Unknown countries (not in scores.csv or the alias map): %s. Nothing was "
                "researched.", ", ".join(unknown),
            )
            raise typer.Exit(code=1)

    # The first full run on a new rubric is a calibration run: record the
    # break and apply every score, so the scale change is labelled rather
    # than landing as evidence-backed "policy change".
    calibration_due = history_mod.calibration_due(dataset.breaks(), RUBRIC_VERSION)
    if open_batch is not None:
        pass  # the submitting run already decided the gate and the break
    elif calibration_due and gate_enabled and full_run and force:
        gate_enabled = False
        break_reason = f"Switch to scoring rubric {RUBRIC_VERSION} (model {model})"
        logger.warning(
            "First full run on rubric %s: running as a calibration run (gate off, break "
            "recorded)", RUBRIC_VERSION,
        )
    elif calibration_due and gate_enabled:
        logger.warning(
            "Rubric %s has no recorded break yet; this partial or gated run stays gated. "
            "The next full run records the break.", RUBRIC_VERSION,
        )
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
            "rubric": RUBRIC_VERSION,
            "reason": break_reason.strip(),
        }
    service = PipelineService(
        dataset, StalenessPolicy(settings.staleness_days, today), today,
        mirror=supabase_mirror,
        gate_enabled=gate_enabled,
        calibration_break=calibration_break,
        run_id=supabase_mirror.run_id if supabase_mirror is not None else None,
        link_checker=LinkChecker() if link_check and not dry_run else None,
        frontier=frontier,
    )
    write_digest = digest if digest is not None else _is_scheduled()
    replace_digest = _is_scheduled() or bool(open_batch and open_batch.options.get("scheduled"))

    if open_batch is not None:
        all_targets, to_update = dataset.countries(), open_batch.countries
    else:
        all_targets, to_update = service.select(targets, force=force)
    logger.info("Countries to update: %d / %d", len(to_update), len(all_targets))
    if not to_update:
        logger.info("Nothing to update.")
        if write_digest and not dry_run:
            _write_digest(
                RunResult(updated=0, failed=[]), client, settings, model, today,
                replace=replace_digest,
            )
        return

    if dry_run:
        logger.info("DRY RUN - would update (with the gate's standing per country):")
        for country in to_update:
            logger.info("  %s: %s", country, service.standing(country))
        if calibration_break:
            logger.info("DRY RUN - would record break: %s", calibration_break["reason"])
        return

    try:
        result = service.run(strategy, to_update)
    except BatchPending as pending:
        # Leave the batch running and record it; the next run collects it.
        # Nothing was applied, so there is nothing to commit but the record.
        handoff.save(state_path, handoff.Handoff(
            batch=pending.batch,
            run_id=open_batch.run_id if open_batch is not None else service.run_id,
            # A batch handed on again keeps its record as it was, so an
            # unfinished collect leaves nothing to commit.
            options=open_batch.options if open_batch is not None else {
                "model": model, "search": search, "grounded": grounded,
                "gate_enabled": gate_enabled, "break_reason": break_reason.strip(),
                "full_run": full_run, "digest": write_digest, "scheduled": replace_digest,
            },
        ))
        message = (
            f"Batch {pending.batch.batch_id} ({len(pending.batch.id_map)} requests) is still "
            "processing. It keeps running; the collect schedule (or any later run) applies "
            "its results. Nothing was applied in this run."
        )
        logger.warning(message)
        _write_step_summary(f"## Batch handed over\n\n{message}\n")
        return
    if open_batch is not None:
        handoff.clear(state_path)
    logger.info(result.gate.summary_line())
    if any(result.frontier_gate.counts.values()):
        logger.info("Frontier %s", result.frontier_gate.summary_line())
    for line in gate.review_lines(result.gate) + gate.review_lines(result.frontier_gate):
        logger.warning(line)
    _write_step_summary(
        gate.markdown_summary(result.gate, result.calibration_break)
        + gate.frontier_markdown_summary(result.frontier_gate)
    )
    _gold_check(result, settings, model, prompt_version, today, supabase_mirror, record=full_run)
    _eu_check(settings)
    if write_digest and result.fatal:
        # An aborted run's changes are partial; a digest would publish them
        # (or "no changes") as the week's story.
        logger.warning("digest: skipped because the run aborted")
    elif write_digest:
        _write_digest(result, client, settings, model, today, replace=replace_digest)
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
    *, replace: bool | None = None,
) -> None:
    """Post-run digest. Downgraded to a warning on any failure: the data
    files are already saved, and a missing digest must not change the exit
    code that drives the workflow's commit step. Only a scheduled run may
    replace the week's digest; a manual run fills a week without one (#101).
    ``replace`` overrides that for a run collecting a batch a scheduled run
    submitted (#194)."""
    try:
        write_run_digest(
            result, client=client, settings=settings, model=model, run_date=today,
            replace=_is_scheduled() if replace is None else replace,
        )
    except Exception:
        logger.warning("digest: failed - continuing", exc_info=True)


def _gold_check(
    result: RunResult, settings: Settings, model: str, prompt_version: str, today: date, mirror,
    *, record: bool = True,
) -> None:
    """Post-run gold-set drift check (gold.py): compare the raw results with
    the gold scores, append a drift.json row, mirror it, and put the metrics
    in the step summary. Downgraded to a warning on any failure - the check
    measures the model and must never change the exit code."""
    try:
        check = check_run(
            result, settings, model=model, prompt_version=prompt_version, run_date=today,
            mirror=mirror, record=record,
        )
    except Exception:
        logger.warning("gold: check failed - continuing", exc_info=True)
        return
    if check is not None:
        _write_step_summary(markdown_summary(check.metrics, check.gold))
        if check.frontier is not None:
            _write_step_summary(frontier_markdown(check.frontier))


def _eu_check(settings: Settings) -> None:
    """Post-run EU consistency check (consistency.py): list the members whose
    AI Act sub-indicators differ from the EU's most common score, in the log
    and the step summary. Never changes a score or the exit code."""
    try:
        subscores = json.loads(settings.subscores_json.read_text(encoding="utf-8"))
        outliers = eu_outliers(subscores, eu_members(settings.blocs_json))
    except Exception:
        logger.warning("eu: consistency check failed - continuing", exc_info=True)
        return
    for line in eu_log_lines(outliers):
        logger.info(line)
    _write_step_summary(eu_markdown_summary(outliers))


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
    ResearchClient.request, deep in the research loop, where the service
    only knows how to handle FatalAPIError - a transient Supabase error there would
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
            for r in client.select_all("countries", {"select": "id,name", "order": "id"})
        }
        by_country: dict[str, list[dict]] = {}
        rows = client.select_all("policy_initiatives", {
            "select": "country_id,name,start_year,initiative_type,binding,status,overview,source_url",
            "country_id": "not.is.null",
            # id breaks ties: offset paging over a non-unique order can skip
            # or repeat rows past the first page.
            "order": "start_year.desc.nullslast,id",
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

    def usage_totals() -> dict:
        sync_usage = research_client.usage()
        batch_usage = batch_runner.usage() if batch_runner is not None else {}
        totals = {
            key: sync_usage.get(key, 0) + batch_usage.get(key, 0)
            for key in ("input", "output", "searches")
        }
        totals["est_cost_usd"] = estimate_cost_usd(model, sync_usage, batch_usage)
        logger.info(
            "usage: %d input / %d output tokens, %d web searches, estimated cost %s",
            totals["input"], totals["output"], totals["searches"],
            f"${totals['est_cost_usd']:.2f}" if totals["est_cost_usd"] is not None else "unknown",
        )
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
