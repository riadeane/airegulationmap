"""The weekly digest: what changed in a run, as sourced prose.

A post-run step that consumes :class:`~regulation_pipeline.service.RunResult`
and writes three files under ``public/digest/``:

* ``YYYY-Www.json`` - the structured digest for the run's ISO week: a lead,
  one item per country with a headline, summary and source URLs, plus the
  raw score / law / confidence deltas the prose was written from.
* ``index.json`` - every week on disk, newest first.
* ``feed.xml`` - an Atom feed with one entry per week.

The prose comes from one Claude request with structured output. Every item
must cite URLs from the country's own source list; an item that cites
anything else is dropped, so the digest can never link to a source the run
did not find. The service stays free of content concerns: it only records
which rows each result replaced (:class:`~regulation_pipeline.service.CountryChange`).

``python -m regulation_pipeline.digest --run <id>`` regenerates a digest for
a past run from Supabase ``score_history`` (see :func:`changes_from_supabase`
for what the database can and cannot reconstruct).
"""

from __future__ import annotations

import html
import json
import logging
import os
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import anthropic
import typer
from pydantic import BaseModel, ConfigDict, ValidationError

from .api import parse_message
from .config import SITE_URL, Settings
from .models import ResearchResult, strip_titles
from .retry import call_with_retries
from .service import CountryChange, RunResult

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
# Recorded in every digest file so prose can be traced to the prompt that
# produced it. Bump when the prompt changes.
DIGEST_PROMPT_VERSION = "digest-v1-2026-09"

_MAX_TOKENS = 8192
_MAX_FEED_ENTRIES = 52
_MAX_LAWS_CHARS = 800
_NO_CHANGES_LEAD = "No gated score or law changes in this run."
_BREAK_LEAD = (
    "Recalibration: {reason}. Score movements dated {date} reflect the recalibration, "
    "not policy change, and are not listed here."
)

# Dimension key -> CSV column, in canonical order.
SCORE_COLUMNS: dict[str, str] = {dim.key: dim.column for dim in ResearchResult.DIMENSIONS}
_HISTORY_KEYS: dict[str, str] = {dim.history_key: dim.key for dim in ResearchResult.DIMENSIONS}


class DigestError(RuntimeError):
    """The digest could not be generated (the run itself is unaffected)."""


# -- structured output -----------------------------------------------------------


class DigestItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    country: str
    headline: str
    summary: str
    sources: list[str]


class DigestText(BaseModel):
    """What Claude returns: the lead and one item per country."""

    model_config = ConfigDict(extra="forbid")

    lead: str
    items: list[DigestItem]

    @classmethod
    def output_schema(cls) -> dict[str, Any]:
        return strip_titles(cls.model_json_schema())


# -- change selection ------------------------------------------------------------


@dataclass(frozen=True)
class DigestChange:
    """One country the digest covers, reduced to what the prompt and the
    page need. ``scores`` holds only the dimensions that moved."""

    country: str
    scores: dict[str, tuple[float | None, float | None]]
    laws: tuple[str | None, str] | None
    confidence: tuple[str | None, str]
    sources: tuple[str, ...]
    new_sources: tuple[str, ...]

    def to_json(self) -> dict:
        return {
            "country": self.country,
            "scores": {
                key: {"old": old, "new": new} for key, (old, new) in self.scores.items()
            },
            "laws": None if self.laws is None else {"old": self.laws[0], "new": self.laws[1]},
            "confidence": {"old": self.confidence[0], "new": self.confidence[1]},
            "sources": list(self.sources),
            "new_sources": list(self.new_sources),
        }


def select_changes(
    changes: Iterable[CountryChange], *, calibration_break: dict | None = None,
) -> list[DigestChange]:
    """Reduce a run's applied results to the countries the digest covers:
    a gate-applied dimension score moved, the Specific Laws text changed, or
    confidence rose to high with new sources.

    ``CountryChange`` rows are read after the stability gate (``gate.py``)
    applied, so a held result carries no score movement and is covered only
    by its text changes. On a calibration-break run every score moved for a
    reason that is not policy, so score-only changes are left out (PRD 01,
    addendum A) and only law and confidence changes remain.
    """
    selected: list[DigestChange] = []
    for change in changes:
        scores = _score_deltas(change.old_scores, change.new_scores)
        if calibration_break is not None:
            scores = {}
        laws = _laws_delta(change.old_regulation, change.new_regulation)
        confidence = (
            _confidence(change.old_regulation),
            _confidence(change.new_regulation) or "low",
        )
        sources = _urls(change.new_regulation)
        old_sources = set(_urls(change.old_regulation))
        new_sources = tuple(u for u in sources if u not in old_sources)
        confidence_rose = confidence[1] == "high" and confidence[0] != "high" and new_sources
        if not (scores or laws or confidence_rose):
            continue
        selected.append(DigestChange(
            country=change.country,
            scores=scores,
            laws=laws,
            confidence=confidence,
            sources=sources,
            new_sources=new_sources,
        ))
    return selected


def _score_deltas(old: dict | None, new: dict) -> dict[str, tuple[float | None, float | None]]:
    deltas: dict[str, tuple[float | None, float | None]] = {}
    for key, column in SCORE_COLUMNS.items():
        before = _score(old, column)
        after = _score(new, column)
        if before != after:
            deltas[key] = (before, after)
    return deltas


def _score(row: dict | None, column: str) -> float | None:
    if not row:
        return None
    value = row.get(column)
    if value in (None, "", "NA"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _laws_delta(old: dict | None, new: dict) -> tuple[str | None, str] | None:
    after = _normalise(new.get("Specific Laws"))
    before = _normalise(old.get("Specific Laws")) if old else None
    if before == after:
        return None
    return (before, after)


def _normalise(text: str | None) -> str:
    return " ".join((text or "").split())


def _confidence(row: dict | None) -> str | None:
    if not row:
        return None
    value = (row.get("Confidence") or "").strip().lower()
    return value or None


def _urls(row: dict | None) -> tuple[str, ...]:
    """The row's ``Sources`` column as an ordered, de-duplicated URL tuple."""
    if not row:
        return ()
    seen: list[str] = []
    for part in (row.get("Sources") or "").split("|"):
        url = part.strip()
        if url and url not in seen:
            seen.append(url)
    return tuple(seen)


# -- prompt ------------------------------------------------------------------


DIGEST_PROMPT = """You write the weekly changes digest for the AI Regulation Map, a reference tracker of AI regulation in 196 countries. Readers are policy researchers and journalists who will quote it, so every claim needs a source.

Run date: {date}

Below is every country whose scores or named laws changed in this run. For each country you get the old and new dimension scores (1 to 5), the old and new "Specific Laws" text, the confidence label, and the source URLs the run cited.

Return:
- "lead": one or two sentences, at most 60 words, that say how many countries changed and name the largest score movements. State facts only.
- "items": one entry per country listed below, in the order given, with:
  - "country": the country name exactly as given.
  - "headline": at most 12 words that say what changed.
  - "summary": one to three sentences. State the score movement, the change in the named laws if any, and what the sources say caused it.
  - "sources": one or more URLs copied exactly from that country's source list.

Rules:
- Every claim must come from the change data below or from a URL in that country's source list. Do not add facts, dates, law names or institutions that are not in the data or the sources.
- Use only URLs from the country's own source list. Do not invent, shorten or alter a URL.
- Write in British English.
- Do not use em dashes. Use commas or full stops.
- Do not use adjectives or adverbs that the data cannot verify (for example "landmark", "sweeping", "major", "notably"). Report the numbers and the named instruments.
- Do not give opinions, predictions or recommendations.
- Do not skip a listed country and do not add a country that is not listed.

Countries:
{countries}
"""


def render_prompt(changes: list[DigestChange], run_date: date) -> str:
    blocks = [_country_block(change) for change in changes]
    return DIGEST_PROMPT.format(date=run_date.isoformat(), countries="\n".join(blocks))


def _country_block(change: DigestChange) -> str:
    lines = [f"### {change.country}"]
    old_conf, new_conf = change.confidence
    lines.append(f"Confidence: {old_conf or 'none'} -> {new_conf}")
    if change.scores:
        lines.append("Scores (old -> new):")
        for key, (old, new) in change.scores.items():
            lines.append(f"- {key}: {_fmt(old)} -> {_fmt(new)}")
    else:
        lines.append("Scores: unchanged")
    if change.laws is not None:
        old_laws, new_laws = change.laws
        lines.append(f"Specific Laws (old): {_clip(old_laws) or 'none'}")
        lines.append(f"Specific Laws (new): {_clip(new_laws) or 'none'}")
    else:
        lines.append("Specific Laws: unchanged")
    lines.append("Sources:")
    if change.sources:
        for url in change.sources:
            marker = " (new this run)" if url in change.new_sources else ""
            lines.append(f"- {url}{marker}")
    else:
        lines.append("- none")
    return "\n".join(lines) + "\n"


def _fmt(score: float | None) -> str:
    return "none" if score is None else f"{score:g}"


def _clip(text: str | None) -> str:
    text = text or ""
    return text if len(text) <= _MAX_LAWS_CHARS else text[:_MAX_LAWS_CHARS] + "..."


# -- generation ----------------------------------------------------------------


def request_params(changes: list[DigestChange], run_date: date, *, model: str) -> dict:
    return {
        "model": model,
        "max_tokens": _MAX_TOKENS,
        "messages": [{"role": "user", "content": render_prompt(changes, run_date)}],
        "output_config": {
            "format": {"type": "json_schema", "schema": DigestText.output_schema()}
        },
    }


def generate(
    client: anthropic.Anthropic,
    changes: list[DigestChange],
    run_date: date,
    *,
    model: str,
) -> DigestText:
    """One request for the whole digest. Raises :class:`DigestError` when
    the API gives up or returns something that fails validation."""
    params = request_params(changes, run_date, model=model)
    response = call_with_retries(lambda: client.messages.create(**params), label="digest")
    if response is None:
        raise DigestError("digest request failed after retries")
    raw = parse_message(response, "digest")
    if raw is None:
        raise DigestError("digest response was not JSON")
    try:
        text = DigestText.model_validate(raw)
    except ValidationError as exc:
        raise DigestError(f"digest response failed validation: {exc}") from exc
    return validate_items(text, changes)


def validate_items(text: DigestText, changes: list[DigestChange]) -> DigestText:
    """Drop any item that names an unknown country, cites no source, or
    cites a URL outside that country's source list. Normalise dashes."""
    allowed = {change.country: set(change.sources) for change in changes}
    kept: list[DigestItem] = []
    seen: set[str] = set()
    for item in text.items:
        urls = allowed.get(item.country)
        if urls is None or item.country in seen:
            logger.warning("digest: dropped item for unknown or duplicate country %r", item.country)
            continue
        cited = [u.strip() for u in item.sources if u.strip()]
        foreign = [u for u in cited if u not in urls]
        if foreign or not cited:
            logger.warning(
                "digest: dropped item for %s - cites %s", item.country,
                "no source" if not cited else f"URLs outside its source list: {foreign}",
            )
            continue
        seen.add(item.country)
        kept.append(DigestItem(
            country=item.country,
            headline=_plain(item.headline),
            summary=_plain(item.summary),
            sources=list(dict.fromkeys(cited)),
        ))
    return DigestText(lead=_plain(text.lead), items=kept)


def _plain(text: str) -> str:
    """House style: no em or en dashes in body copy."""
    return " ".join(text.replace("—", " - ").replace("–", " - ").split())


# -- digest documents ----------------------------------------------------------


def week_of(day: date) -> str:
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def build_digest(
    text: DigestText,
    changes: list[DigestChange],
    *,
    run_id: str,
    model: str,
    run_date: date,
    generated_at: datetime,
    calibration_break: dict | None = None,
) -> dict:
    """The week file's JSON document. On a calibration-break run the lead
    opens with the recalibration sentence."""
    lead = text.lead
    if calibration_break is not None:
        prefix = _BREAK_LEAD.format(
            reason=calibration_break.get("reason", "calibration reset"),
            date=calibration_break.get("date", run_date.isoformat()),
        )
        lead = f"{prefix} {lead}".strip()
    return {
        "schema_version": SCHEMA_VERSION,
        "week": week_of(run_date),
        "date": run_date.isoformat(),
        "generated_at": generated_at.isoformat(),
        "run_id": run_id,
        "model": model,
        "prompt_version": DIGEST_PROMPT_VERSION,
        "calibration_break": dict(calibration_break) if calibration_break else None,
        "lead": lead,
        "items": [item.model_dump() for item in text.items],
        "changes": [change.to_json() for change in changes],
    }


def no_changes_digest(
    *, run_id: str, model: str, run_date: date, generated_at: datetime,
    calibration_break: dict | None = None,
) -> dict:
    return build_digest(
        DigestText(lead=_NO_CHANGES_LEAD, items=[]), [],
        run_id=run_id, model=model, run_date=run_date, generated_at=generated_at,
        calibration_break=calibration_break,
    )


def write_run_digest(
    result: RunResult,
    *,
    client: anthropic.Anthropic | None,
    settings: Settings,
    model: str,
    run_date: date,
    now: datetime | None = None,
) -> Path:
    """Select the run's changes, generate the prose (one request, skipped
    when nothing changed), and write the week file, index and feed."""
    generated_at = now or datetime.now(UTC)
    calibration_break = result.calibration_break
    changes = select_changes(result.changes, calibration_break=calibration_break)
    if not changes:
        digest = no_changes_digest(
            run_id=result.run_id, model=model, run_date=run_date, generated_at=generated_at,
            calibration_break=calibration_break,
        )
    else:
        if client is None:
            raise DigestError("an Anthropic client is required when there are changes")
        text = generate(client, changes, run_date, model=model)
        digest = build_digest(
            text, changes,
            run_id=result.run_id, model=model, run_date=run_date, generated_at=generated_at,
            calibration_break=calibration_break,
        )
    return write_digest(settings, digest)


def write_digest(settings: Settings, digest: dict) -> Path:
    """Write the week file, then rebuild ``index.json`` and ``feed.xml`` from
    every week file on disk."""
    digest_dir = settings.digest_dir
    digest_dir.mkdir(parents=True, exist_ok=True)
    path = digest_dir / f"{digest['week']}.json"
    _write(path, json.dumps(digest, ensure_ascii=False, indent=2))

    weeks = load_weeks(digest_dir)
    _write(digest_dir / "index.json", json.dumps(build_index(weeks), ensure_ascii=False, indent=2))
    _write(digest_dir / "feed.xml", render_feed(weeks))
    logger.info(
        "digest: wrote %s (%d items, %d countries changed)",
        path.relative_to(settings.root), len(digest["items"]), len(digest["changes"]),
    )
    return path


def load_weeks(digest_dir: Path) -> list[dict]:
    """Every week file, newest first."""
    weeks = []
    for path in digest_dir.glob("????-W??.json"):
        try:
            weeks.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            logger.warning("digest: skipping unreadable %s", path.name)
    weeks.sort(key=lambda d: d.get("week", ""), reverse=True)
    return weeks


def build_index(weeks: list[dict]) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "weeks": [
            {
                "week": d["week"],
                "date": d["date"],
                "run_id": d["run_id"],
                "model": d["model"],
                "item_count": len(d["items"]),
                "change_count": len(d["changes"]),
                "file": f"{d['week']}.json",
            }
            for d in weeks
        ],
    }


def _write(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# -- Atom feed -------------------------------------------------------------------


_FEED = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>{feed_id}</id>
  <title>AI Regulation Map: weekly changes</title>
  <subtitle>Score and law changes from each research run, with sources.</subtitle>
  <updated>{updated}</updated>
  <link rel="self" type="application/atom+xml" href="{feed_id}"/>
  <link rel="alternate" type="text/html" href="{site}/changes.html"/>
  <author><name>AI Regulation Map</name><uri>{site}/</uri></author>
  <generator uri="https://github.com/riadeane/airegulationmap">regulation_pipeline.digest</generator>
{entries}</feed>
"""

_ENTRY = """  <entry>
    <id>{link}</id>
    <title>{title}</title>
    <updated>{updated}</updated>
    <published>{updated}</published>
    <link rel="alternate" type="text/html" href="{link}"/>
    <content type="html">{content}</content>
  </entry>
"""


def render_feed(weeks: list[dict], *, site: str = SITE_URL) -> str:
    """Atom 1.0 document for ``weeks`` (newest first)."""
    shown = weeks[:_MAX_FEED_ENTRIES]
    updated = max((d["generated_at"] for d in shown), default=None)
    entries = "".join(_entry(d, site) for d in shown)
    return _FEED.format(
        feed_id=f"{site}/digest/feed.xml",
        site=site,
        updated=_rfc3339(updated),
        entries=entries,
    )


def _entry(digest: dict, site: str) -> str:
    return _ENTRY.format(
        link=f"{site}/changes.html?week={digest['week']}",
        title=html.escape(entry_title(digest)),
        updated=_rfc3339(digest["generated_at"]),
        content=html.escape(entry_html(digest, site)),
    )


def entry_title(digest: dict) -> str:
    year, week = digest["week"].split("-W")
    count = len(digest["changes"])
    if count == 0:
        return f"Week {int(week)}, {year}: no changes"
    noun = "country" if count == 1 else "countries"
    return f"Week {int(week)}, {year}: {count} {noun} changed"


def entry_html(digest: dict, site: str = SITE_URL) -> str:
    """The entry body: lead, then one list item per digest item."""
    parts = [f"<p>{html.escape(digest['lead'])}</p>"]
    if digest["items"]:
        parts.append("<ul>")
        for item in digest["items"]:
            links = ", ".join(
                f'<a href="{html.escape(u, quote=True)}">{html.escape(_host(u))}</a>'
                for u in item["sources"]
            )
            parts.append(
                f'<li><a href="{country_url(item["country"], site)}">'
                f"{html.escape(item['country'])}</a>: "
                f"<strong>{html.escape(item['headline'])}</strong> "
                f"{html.escape(item['summary'])} Sources: {links}.</li>"
            )
        parts.append("</ul>")
    parts.append(
        f'<p>Run {html.escape(digest["date"])}, model {html.escape(digest["model"])}. '
        f'<a href="{site}/changes.html?week={digest["week"]}">Read on the site</a>.</p>'
    )
    return "".join(parts)


def country_url(country: str, site: str = SITE_URL) -> str:
    return f"{site}/?country={quote(country)}"


def _host(url: str) -> str:
    host = urlparse(url).netloc or url
    return host[4:] if host.startswith("www.") else host


def _rfc3339(value: str | None) -> str:
    """Atom needs RFC 3339 with an explicit offset; ``Z`` for UTC."""
    if not value:
        return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# -- regeneration from Supabase --------------------------------------------------


def changes_from_supabase(client, run_id: str) -> tuple[list[CountryChange], dict]:
    """Rebuild a run's changes from the database.

    ``score_history.run_id`` marks the snapshots a run introduced (the mirror
    keeps earlier snapshots' ids when it replaces a country's history), so the
    run's change points are exact. The regulation text has no history in the
    database, so the old regulation row is taken as equal to the current one:
    regenerated digests cover score changes only, and confidence-only or
    law-only changes from that run are not recovered.

    Returns ``(changes, run_row)``; raises :class:`DigestError` when the run
    is unknown.
    """
    runs = client.select("research_runs", {"id": f"eq.{run_id}", "select": "*"})
    if not runs:
        raise DigestError(f"research_runs has no row with id {run_id}")
    run = runs[0]

    new_rows = client.select_all("score_history", {
        "select": "country_id,snapshot_date,scores",
        "run_id": f"eq.{run_id}",
        "order": "snapshot_date.desc",
    })
    if not new_rows:
        return [], run

    country_ids = sorted({r["country_id"] for r in new_rows})
    id_filter = "in.(" + ",".join(country_ids) + ")"
    names = {
        r["id"]: r["name"]
        for r in client.select_all("countries", {"select": "id,name", "id": id_filter})
    }
    history: dict[str, list[dict]] = {}
    for row in client.select_all("score_history", {
        "select": "country_id,snapshot_date,scores",
        "country_id": id_filter,
        "order": "snapshot_date.asc",
    }):
        history.setdefault(row["country_id"], []).append(row)
    summaries = {
        r["country_id"]: r
        for r in client.select_all("country_summaries", {
            "select": "country_id,specific_laws,sources_raw", "country_id": id_filter,
        })
    }
    confidences = {
        r["country_id"]: r.get("confidence")
        for r in client.select_all("country_scores", {
            "select": "country_id,confidence", "country_id": id_filter,
        })
    }

    changes: list[CountryChange] = []
    newest_by_country: dict[str, dict] = {}
    for row in new_rows:  # already newest first
        newest_by_country.setdefault(row["country_id"], row)
    for cid, newest in newest_by_country.items():
        country = names.get(cid)
        if country is None:
            logger.warning("digest: score_history row for unknown country id %s skipped", cid)
            continue
        snapshots = history.get(cid, [])
        earlier = [s for s in snapshots if s["snapshot_date"] < newest["snapshot_date"]]
        previous = earlier[-1] if earlier else None
        summary = summaries.get(cid, {})
        regulation = {
            "Country": country,
            "Specific Laws": summary.get("specific_laws") or "",
            "Sources": summary.get("sources_raw") or "",
            "Confidence": confidences.get(cid) or "",
        }
        changes.append(CountryChange(
            country=country,
            old_scores=_scores_row(country, previous["scores"]) if previous else None,
            new_scores=_scores_row(country, newest["scores"]),
            old_regulation=dict(regulation),
            new_regulation=regulation,
        ))
    changes.sort(key=lambda c: c.country)
    return changes, run


def _scores_row(country: str, snapshot_scores: dict) -> dict:
    """History-shaped scores (camelCase keys) -> CSV-shaped row."""
    row: dict = {"Country": country}
    for history_key, key in _HISTORY_KEYS.items():
        if history_key in snapshot_scores:
            row[SCORE_COLUMNS[key]] = snapshot_scores[history_key]
    return row


# -- CLI -----------------------------------------------------------------------


def _regenerate(
    run: str = typer.Option(..., "--run", help="research_runs.id of the run to regenerate"),
    model: str = typer.Option("", help="Claude model (default: the model recorded on the run)"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose (DEBUG) logging"),
) -> None:
    """Regenerate the weekly digest for a past run from Supabase score_history.

    Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and ANTHROPIC_API_KEY. Regenerated
    digests cover score changes only: the database keeps no history of the
    regulation text.
    """
    from .cli import configure_logging
    from .db.client import SupabaseClient

    configure_logging(verbose)
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not (url and key):
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        raise typer.Exit(code=1)
    if not api_key:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        raise typer.Exit(code=1)

    settings = Settings().validate()
    with SupabaseClient(url, key) as db:
        try:
            changes, run_row = changes_from_supabase(db, run)
        except DigestError as exc:
            logger.error("%s", exc)
            raise typer.Exit(code=1) from exc

    started = run_row.get("started_at") or run_row.get("finished_at")
    run_date = datetime.fromisoformat(started).date() if started else date.today()
    digest_model = model or run_row.get("model") or settings.default_model
    result = RunResult(updated=len(changes), failed=[], run_id=run, changes=tuple(changes))
    logger.info("digest: run %s on %s - %d countries with new snapshots", run, run_date, len(changes))

    # SDK-level silent retries stay off; retry.py does explicit, logged retries.
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    try:
        write_run_digest(result, client=client, settings=settings, model=digest_model, run_date=run_date)
    except DigestError as exc:
        logger.error("%s", exc)
        raise typer.Exit(code=2) from exc


def main() -> None:
    typer.run(_regenerate)


if __name__ == "__main__":  # pragma: no cover - exercised via python -m
    main()
