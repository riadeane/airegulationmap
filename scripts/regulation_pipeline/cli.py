"""Command-line entry point.

A thin Typer command that wires the pieces together and translates the run
outcome into an exit code. All the real work lives in
:class:`~regulation_pipeline.service.PipelineService`; this layer only handles
argument parsing, logging setup, credentials, and dependency construction.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import date

import anthropic
import typer

from .api import ResearchClient
from .batch import BatchRunner
from .config import DEFAULT_MODEL, Settings
from .names import CountryNames
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
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose (DEBUG) logging"),
) -> None:
    """Update AI regulation data using the Claude API."""
    configure_logging(verbose)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        raise typer.Exit(code=1)

    settings = Settings(default_model=model)
    today = date.today()

    # SDK-level silent retries are disabled — retry.py does explicit, logged
    # retries with backoff, and the two must not multiply.
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    names = CountryNames.load(settings.country_names_json)

    research_client = ResearchClient(
        client, default_model=model, search_model=settings.search_model, today=today
    )
    priority = settings.priority_countries

    def use_search_for(country: str) -> bool:
        return search_all or (search and country in priority)

    strategy = (
        BatchStrategy(research_client, BatchRunner(client), use_search_for)
        if batch
        else SyncStrategy(research_client, use_search_for)
    )

    logger.info("Loading existing data...")
    dataset = Dataset.load(settings, names)
    service = PipelineService(dataset, StalenessPolicy(settings.staleness_days, today), today)

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


def main() -> None:
    typer.run(_run)


if __name__ == "__main__":
    main()
