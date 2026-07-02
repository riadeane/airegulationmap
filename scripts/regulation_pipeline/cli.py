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
from .config import DEFAULT_MODEL, Settings
from .names import CountryNames
from .prompt import GROUNDED_PROMPT_VERSION, PROMPT_VERSION
from .repository import Dataset
from .service import PipelineService
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
    force: bool = typer.Option(False, help="Update regardless of staleness"),
    dry_run: bool = typer.Option(False, help="Show what would change without writing"),
    model: str = typer.Option(DEFAULT_MODEL, help="Claude model to use"),
    search: bool = typer.Option(False, help="Enable web search for priority countries"),
    search_all: bool = typer.Option(
        False, help="Enable web search for ALL countries (uses Sonnet; pair with --batch for cost)"
    ),
    batch: bool = typer.Option(
        False, help="Use the Message Batches API: 50% token pricing, results within ~1h"
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
        "prompt. Grounded prompts are longer — pair with --batch.",
    ),
    evidence_file: str = typer.Option(
        "", "--evidence-file",
        help='Offline evidence for --grounded: JSON {"<country>": [initiative, ...]}.',
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose (DEBUG) logging"),
) -> None:
    """Update AI regulation data using the Claude API."""
    configure_logging(verbose)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        raise typer.Exit(code=1)

    settings = Settings(default_model=model).validate()
    today = date.today()

    # SDK-level silent retries are disabled — retry.py does explicit, logged
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
        client, default_model=model, search_model=settings.search_model, today=today,
        evidence_provider=evidence_provider,
    )
    priority = settings.priority_countries

    def use_search_for(country: str) -> bool:
        return search_all or (search and country in priority)

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
    service = PipelineService(
        dataset, StalenessPolicy(settings.staleness_days, today), today,
        mirror=supabase_mirror,
    )

    targets = None
    if countries.strip():
        targets = [names.canonical(c) for c in countries.split(",") if c.strip()]

    all_targets, to_update = service.select(targets, force=force)
    logger.info("Countries to update: %d / %d", len(to_update), len(all_targets))
    if not to_update:
        logger.info("Nothing to update.")
        return

    if dry_run:
        logger.info("DRY RUN - would update:")
        for country in to_update:
            logger.info("  %s", country)
        return

    result = service.run(strategy, to_update)
    if result.fatal:
        raise typer.Exit(code=2)

    logger.info("Done. Updated %d countries.", result.updated)
    if result.failed:
        logger.warning(
            "Failed countries (%d): %s", len(result.failed), ", ".join(result.failed)
        )
        raise typer.Exit(code=1)


def _build_evidence_provider(evidence_file: str) -> Callable[[str], list[dict]] | None:
    """Evidence for --grounded: an offline JSON file, or lazy per-country
    PostgREST reads from the policy_initiatives table."""
    if evidence_file:
        data = json.loads(Path(evidence_file).read_text(encoding="utf-8"))
        return lambda country: data.get(country, [])

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None

    from .db.client import SupabaseClient

    client = SupabaseClient(url, key)
    country_ids: dict[str, str] = {
        r["name"]: r["id"] for r in client.select("countries", {"select": "id,name", "limit": "1000"})
    }

    def provider(country: str) -> list[dict]:
        cid = country_ids.get(country)
        if not cid:
            return []
        return client.select("policy_initiatives", {
            "select": "name,start_year,initiative_type,binding,status,overview,source_url",
            "country_id": f"eq.{cid}",
            "order": "start_year.desc.nullslast",
            "limit": "30",
        })

    return provider


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
        trigger="schedule" if os.environ.get("GITHUB_EVENT_NAME") == "schedule" else "manual",
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
