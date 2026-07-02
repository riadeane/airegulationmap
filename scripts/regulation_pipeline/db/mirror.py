"""The dual-write mirror: after each pipeline run, replay what was applied
to the static files into Supabase, with full run provenance.

Design constraints (see the service for the call sites):

* The mirror is an OPTIONAL collaborator of ``PipelineService`` — the file
  ``Dataset`` and its byte contracts are untouched, and the service wraps
  every mirror call so a mirror failure can never fail (or even re-order)
  a run. The static files stay authoritative for the frontend's boot path.
* ``record`` buffers; ``finish`` flushes in one burst — the network cost is
  paid once, after ``dataset.save()`` has already secured the files.
* ``score_history`` is replaced per recorded country rather than appended:
  ``history.py`` advances the last snapshot's date in place when scores are
  unchanged, so an append-only mirror would drift from the file.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Protocol

from ..models import ResearchResult
from ..sources import classify_sources
from .client import SupabaseClient

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RunMeta:
    trigger: str                    # 'schedule' | 'manual' | 'backfill'
    model: str
    strategy: str                   # 'sync' | 'batch'
    prompt_version: str
    grounded: bool = False
    git_sha: str | None = None


class Mirror(Protocol):
    """What the service calls. Implementations may raise freely — the
    service downgrades every failure to a warning."""

    def begin(self, attempted: int) -> None: ...

    def record(
        self, country: str, result: ResearchResult, today: date,
        *, data_version: int, history: list[dict],
    ) -> None: ...

    def finish(self, updated: int, failed: int, fatal: bool) -> None: ...


@dataclass
class _Entry:
    country: str
    result: ResearchResult
    today: date
    data_version: int
    history: list[dict]


class SupabaseMirror:
    """Buffers per-country results and flushes them to Supabase in
    ``finish()``. ``usage_provider`` (optional) returns cumulative
    ``{"input": int, "output": int}`` token counts at flush time."""

    def __init__(
        self,
        client: SupabaseClient,
        meta: RunMeta,
        *,
        iso_path: Path | None = None,
        usage_provider=None,
    ):
        self._client = client
        self._meta = meta
        self._usage_provider = usage_provider
        self._iso = _load_iso(iso_path)
        self._run_id = str(uuid.uuid4())
        self._entries: list[_Entry] = []

    # -- Mirror protocol -----------------------------------------------------

    def begin(self, attempted: int) -> None:
        self._client.insert("research_runs", [{
            "id": self._run_id,
            "trigger": self._meta.trigger,
            "model": self._meta.model,
            "strategy": self._meta.strategy,
            "prompt_version": self._meta.prompt_version,
            "grounded": self._meta.grounded,
            "git_sha": self._meta.git_sha,
            "countries_attempted": attempted,
        }])

    def record(
        self, country: str, result: ResearchResult, today: date,
        *, data_version: int, history: list[dict],
    ) -> None:
        self._entries.append(_Entry(country, result, today, data_version, history))

    def finish(self, updated: int, failed: int, fatal: bool) -> None:
        if self._entries:
            self._flush()
        usage = self._usage_provider() if self._usage_provider else {}
        self._client.update("research_runs", {
            "finished_at": _now(),
            "countries_succeeded": updated,
            "input_tokens": usage.get("input"),
            "output_tokens": usage.get("output"),
            "notes": "aborted on fatal API error; partial results mirrored" if fatal else None,
        }, {"id": f"eq.{self._run_id}"})
        logger.info(
            "mirror: run %s recorded (%d countries mirrored, fatal=%s)",
            self._run_id, len(self._entries), fatal,
        )

    # -- flush ----------------------------------------------------------------

    def _flush(self) -> None:
        country_ids = self._resolve_country_ids([e.country for e in self._entries])

        scores_rows, summary_rows = [], []
        for e in self._entries:
            cid = country_ids[e.country]
            scores_rows.append(_score_row(cid, e, self._run_id))
            summary_rows.append(_summary_row(cid, e, self._run_id))
        self._client.upsert("country_scores", scores_rows, on_conflict="country_id")
        self._client.upsert("country_summaries", summary_rows, on_conflict="country_id")

        # History: replace-per-country (delete + insert the file's snapshots).
        for e in self._entries:
            cid = country_ids[e.country]
            self._client.delete("score_history", {"country_id": f"eq.{cid}"})
            self._client.insert("score_history", [
                {
                    "country_id": cid,
                    "snapshot_date": snap["date"],
                    "scores": {k: v for k, v in snap.items() if k != "date"},
                    "run_id": self._run_id,
                }
                for snap in e.history
            ])

        self._sync_sources(country_ids)

    def _resolve_country_ids(self, names: list[str]) -> dict[str, str]:
        rows = self._client.select("countries", {"select": "id,name", "limit": "1000"})
        ids = {r["name"]: r["id"] for r in rows}
        missing = [n for n in names if n not in ids]
        if missing:
            self._client.upsert("countries", [
                {"name": n, **_iso_columns(self._iso.get(n))} for n in missing
            ], on_conflict="name")
            rows = self._client.select("countries", {"select": "id,name", "limit": "1000"})
            ids = {r["name"]: r["id"] for r in rows}
        return ids

    def _sync_sources(self, country_ids: dict[str, str]) -> None:
        now = _now()
        by_url: dict[str, dict] = {}
        links: list[tuple[str, str]] = []
        for e in self._entries:
            for src in classify_sources(e.result.sources):
                by_url.setdefault(src.url, {
                    "url": src.url, "domain": src.domain,
                    "source_type": src.source_type, "last_seen": now,
                })
                links.append((e.country, src.url))
        if not by_url:
            return
        # first_seen is deliberately not supplied: the DB default applies on
        # insert, and merge-duplicates only updates supplied columns.
        self._client.upsert("sources", list(by_url.values()), on_conflict="url")
        source_ids = {
            r["url"]: r["id"]
            for r in self._client.select("sources", {"select": "id,url", "limit": "100000"})
        }
        self._client.upsert("country_sources", [
            {
                "country_id": country_ids[country],
                "source_id": source_ids[url],
                "dimension": "general",
                "run_id": self._run_id,
                "last_cited": now,
            }
            for country, url in links
        ], on_conflict="country_id,source_id,dimension")


# -- row projections (DB shape; the CSV shape lives in repository.py) ----------


def _score_row(country_id: str, e: _Entry, run_id: str) -> dict:
    scores = e.result.dimension_scores()
    subscores: dict = {"date": e.today.isoformat()}
    for key, dim in e.result.dimensions().items():
        subscores[key] = dim.subscores()
    return {
        "country_id": country_id,
        "regulation_status": scores["regulation_status"],
        "policy_lever": scores["policy_lever"],
        "governance_type": scores["governance_type"],
        "actor_involvement": scores["actor_involvement"],
        "enforcement_level": scores["enforcement_level"],
        "avg_score": e.result.average_score(),
        "subscores": subscores,
        "confidence": e.result.effective_confidence(),
        "data_version": e.data_version,
        "run_id": run_id,
        "scored_at": e.today.isoformat(),
        "updated_at": _now(),
    }


def _summary_row(country_id: str, e: _Entry, run_id: str) -> dict:
    dims = e.result.dimensions()
    return {
        "country_id": country_id,
        "regulation_status_text": dims["regulation_status"].text,
        "policy_lever_text": dims["policy_lever"].text,
        "governance_type_text": dims["governance_type"].text,
        "actor_involvement_text": dims["actor_involvement"].text,
        "enforcement_level_text": dims["enforcement_level"].text,
        "specific_laws": e.result.specific_laws,
        "sources_raw": e.result.sources.strip(),
        "run_id": run_id,
        "summarized_at": e.today.isoformat(),
        "updated_at": _now(),
    }


def _iso_columns(entry: dict | None) -> dict:
    if not entry:
        return {}
    return {
        "iso3": entry.get("iso3"),
        "iso2": entry.get("iso2"),
        "iso_numeric": entry.get("numeric"),
    }


def _load_iso(path: Path | None) -> dict:
    if path is None or not path.exists():
        return {}
    import json

    return json.loads(path.read_text(encoding="utf-8")).get("countries", {})


def _now() -> str:
    return datetime.now(UTC).isoformat()
