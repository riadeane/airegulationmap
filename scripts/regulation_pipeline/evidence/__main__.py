"""Evidence CLI: ``python -m regulation_pipeline.evidence probe|sync``.

``probe`` needs no credentials and dumps each candidate endpoint's first
page to a directory (a GitHub Actions artifact in the probe workflow), so
an API-shape change can be inspected before any sync runs. ``sync`` needs
``SUPABASE_URL`` + ``SUPABASE_SERVICE_KEY``; a network failure is a warned
no-op (exit 0) — the monthly data run must never fail because an external
evidence API had a bad day.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Annotated

import httpx
import typer

from ..config import Settings
from ..names import CountryNames
from .matching import CountryResolver
from .oecd import CANDIDATE_ENDPOINTS, OecdGaiinAdapter

logger = logging.getLogger("regulation_pipeline.evidence")

app = typer.Typer(add_completion=False)


def _configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s", stream=sys.stderr, force=True)


@app.command()
def probe(
    out_dir: Annotated[Path, typer.Option("--out", help="Directory for probe dumps.")] = Path("probe-output"),
) -> None:
    """Fetch page 1 from every candidate endpoint and dump status + body."""
    _configure_logging()
    out_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60.0, follow_redirects=True) as http:
        for i, endpoint in enumerate(CANDIDATE_ENDPOINTS, start=1):
            report: dict = {"endpoint": endpoint}
            try:
                resp = http.get(endpoint, params={"page": 1})
                report["status"] = resp.status_code
                try:
                    body = resp.json()
                    report["envelope_keys"] = sorted(body) if isinstance(body, dict) else None
                    report["total"] = body.get("total") if isinstance(body, dict) else None
                    report["record_keys"] = (
                        sorted(body["data"][0]) if isinstance(body, dict) and body.get("data") else None
                    )
                    (out_dir / f"endpoint_{i}_page1.json").write_text(
                        json.dumps(body, indent=1, ensure_ascii=False), encoding="utf-8"
                    )
                except ValueError:
                    report["body_head"] = resp.text[:500]
            except httpx.HTTPError as exc:
                report["error"] = str(exc)
            (out_dir / f"endpoint_{i}_report.json").write_text(
                json.dumps(report, indent=1), encoding="utf-8"
            )
            logger.info("probe %s -> %s", endpoint, report.get("status", report.get("error")))


@app.command()
def sync(
    source: str = typer.Option("oecd", help="Evidence source adapter."),
    full: bool = typer.Option(False, "--full", help="Upsert every record, not just changed ones."),
    endpoint: str = typer.Option("", help="Override the API endpoint (default: official, wrapper fallback)."),
) -> None:
    """Sync policy initiatives into Supabase. Warns and exits 0 on network
    failure — never deletes, never breaks the surrounding run."""
    _configure_logging()
    if source != "oecd":
        raise typer.BadParameter(f"unknown evidence source: {source}")

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        logger.error("sync requires SUPABASE_URL and SUPABASE_SERVICE_KEY")
        raise typer.Exit(code=1)

    from ..db.client import SupabaseClient
    from .sync import sync_evidence

    settings = Settings().validate()
    resolver = CountryResolver.load(
        settings.country_iso_json, CountryNames.load(settings.country_names_json)
    )

    endpoints = [endpoint] if endpoint else list(CANDIDATE_ENDPOINTS)
    with httpx.Client(timeout=60.0, follow_redirects=True) as http, SupabaseClient(url, key) as client:
        last_error: Exception | None = None
        for candidate in endpoints:
            adapter = OecdGaiinAdapter(http, endpoint=candidate)
            try:
                report = sync_evidence(client, adapter, resolver, full=full)
                typer.echo(report.summary())
                return
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning("evidence endpoint %s failed: %s", candidate, exc)
        logger.warning(
            "evidence sync skipped — every endpoint failed (last: %s). "
            "Existing evidence is untouched.", last_error,
        )


if __name__ == "__main__":
    app()
