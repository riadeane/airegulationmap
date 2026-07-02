"""Evidence sync orchestration: fetch → resolve → upsert → record state.

Client-side delta: the API has no server-side filtering, so every sync
walks all pages (cheap: ~120 requests) and compares ``updated_at`` against
what the database already holds. Rows are upserted on ``(source,
external_id)`` — the sync NEVER deletes, so a source outage or a shrunken
API response can't destroy accumulated evidence.

Matched initiatives also feed the sources database: each ``source_url``
lands in ``sources`` (classified) and links to its country in
``country_sources`` with dimension ``general``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from ..sources import classify_sources
from .matching import CountryResolver

logger = logging.getLogger(__name__)


@dataclass
class SyncReport:
    fetched: int = 0
    new: int = 0
    updated: int = 0
    unchanged: int = 0
    malformed: int = 0
    matched: int = 0
    unmatched: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"{self.fetched} fetched · {self.new} new · {self.updated} updated · "
            f"{self.unchanged} unchanged · {self.matched} matched to countries · "
            f"{len(self.unmatched)} unmatched · {self.malformed} malformed"
        )


def sync_evidence(client, adapter, resolver: CountryResolver, *, full: bool = False) -> SyncReport:
    """Run one sync of ``adapter`` into the database via ``client`` (the
    PostgREST :class:`~regulation_pipeline.db.client.SupabaseClient`
    interface). ``full`` upserts every record regardless of delta state."""
    report = SyncReport()

    existing = {
        row["external_id"]: row["updated_at"]
        for row in client.select("policy_initiatives", {
            "select": "external_id,updated_at",
            "source": f"eq.{adapter.name}",
            "limit": "100000",
        })
    }
    country_ids = {
        row["name"]: row["id"]
        for row in client.select("countries", {"select": "id,name", "limit": "1000"})
    }

    rows: list[dict] = []
    links: list[tuple[str, str]] = []  # (country name, url)
    unmatched_labels: set[str] = set()

    for record in adapter.fetch_all():
        report.fetched += 1
        country = resolver.resolve(record)
        country_id = country_ids.get(country) if country else None
        if country_id:
            report.matched += 1
            if record.source_url:
                links.append((country, record.source_url))
        else:
            label = record.country_iso3 or record.country_name or "<none>"
            unmatched_labels.add(label)

        prior = existing.get(record.external_id, _MISSING)
        if prior is _MISSING:
            report.new += 1
        elif _normalize_ts(prior) != _normalize_ts(record.updated_at):
            report.updated += 1
        else:
            report.unchanged += 1
            if not full:
                continue
        rows.append(record.db_row(country_id))

    report.malformed = adapter.malformed
    report.unmatched = sorted(unmatched_labels)
    if report.unmatched:
        logger.warning(
            "evidence: %d labels stored unlinked (no ISO3/name match): %s",
            len(report.unmatched), ", ".join(report.unmatched[:20]),
        )

    if rows:
        client.upsert("policy_initiatives", rows, on_conflict="source,external_id", batch_size=100)
    _sync_source_links(client, links, country_ids)

    client.upsert("sync_state", [{
        "source": adapter.name,
        "last_synced_at": datetime.now(UTC).isoformat(),
        "last_total": report.fetched,
    }], on_conflict="source")

    logger.info("evidence sync (%s): %s", adapter.name, report.summary())
    return report


def _sync_source_links(client, links: list[tuple[str, str]], country_ids: dict[str, str]) -> None:
    if not links:
        return
    now = datetime.now(UTC).isoformat()
    by_url: dict[str, dict] = {}
    for _country, url in links:
        for src in classify_sources(url):
            by_url.setdefault(src.url, {
                "url": src.url, "domain": src.domain,
                "source_type": src.source_type, "last_seen": now,
            })
    client.upsert("sources", list(by_url.values()), on_conflict="url", batch_size=200)
    source_ids = {
        row["url"]: row["id"]
        for row in client.select("sources", {"select": "id,url", "limit": "100000"})
    }
    link_rows = [
        {
            "country_id": country_ids[country],
            "source_id": source_ids[url],
            "dimension": "general",
            "last_cited": now,
        }
        for country, url in links
        if url in source_ids and country in country_ids
    ]
    # One initiative URL may repeat across records; the unique constraint
    # dedupes, but PostgREST rejects duplicate rows within one payload —
    # dedupe locally first.
    unique_rows = list({(r["country_id"], r["source_id"]): r for r in link_rows}.values())
    if unique_rows:
        client.upsert("country_sources", unique_rows, on_conflict="country_id,source_id,dimension", batch_size=200)


class _Missing:
    pass


_MISSING = _Missing()


def _normalize_ts(value: str | None) -> str | None:
    """updatedAt comparisons across PostgREST round-trips: '2026-07-01T08:59:54.000Z'
    and '2026-07-01T08:59:54+00:00' are the same instant."""
    if not value:
        return None
    v = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(v).astimezone(UTC).isoformat(timespec="seconds")
    except ValueError:
        return value
