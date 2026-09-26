"""The dual-write mirror: after each pipeline run, replay what was applied
to the static files into Supabase, with full run provenance.

Design constraints (see the service for the call sites):

* The mirror is an OPTIONAL collaborator of ``PipelineService`` - the file
  ``Dataset`` and its byte contracts are untouched, and the service wraps
  every mirror call so a mirror failure can never fail (or even re-order)
  a run. The static files stay authoritative for the frontend's boot path.
* ``record`` buffers; ``finish`` flushes in one burst - the network cost is
  paid once, after ``dataset.save()`` has already secured the files.
* ``score_history`` is replaced per recorded country rather than appended:
  ``history.py`` advances the last snapshot's date in place when scores are
  unchanged, so an append-only mirror would drift from the file. A snapshot
  that already existed keeps its original ``run_id``; only snapshots with
  new scores get this run's id. ``run_id`` therefore means "the run that
  introduced this change point", which is what the weekly digest's
  ``--run <id>`` regeneration relies on.
* The evidence columns of ``country_scores`` (``grounded``,
  ``initiatives_used``, ``web_search``) come from the ``evidence`` block of
  the subscores entry the service hands over, so the database says exactly
  what the file says, including null when the file has no run record.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Protocol

from ..models import ResearchResult
from ..repository import EVIDENCE_KEY, split_subscores_entry
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
    """What the service calls. Implementations may raise freely - the
    service downgrades every failure to a warning."""

    def begin(self, attempted: int) -> None: ...

    def record(
        self, country: str, result: ResearchResult, today: date,
        *, scores_row: dict, subscores: dict, history: list[dict],
    ) -> None: ...

    def finish(
        self, updated: int, failed: int, fatal: bool, *, gate_counts: dict[str, int] | None = None,
    ) -> None: ...


@dataclass
class _Entry:
    country: str
    result: ResearchResult
    today: date
    scores_row: dict      # the gated scores.csv row the dataset now holds
    subscores: dict       # the gated subscores.json entry (with the evidence block)
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

    @property
    def run_id(self) -> str:
        """The ``research_runs.id`` this mirror writes. The service shares it
        so ``RunResult.run_id`` and the database agree."""
        return self._run_id

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
        *, scores_row: dict, subscores: dict, history: list[dict],
    ) -> None:
        """Buffer one country. ``scores_row`` and ``subscores`` are what the
        dataset holds AFTER the stability gate, so a held result mirrors the
        unchanged scores while the text fields still refresh."""
        self._entries.append(_Entry(country, result, today, scores_row, subscores, history))

    def finish(
        self, updated: int, failed: int, fatal: bool, *, gate_counts: dict[str, int] | None = None,
    ) -> None:
        if self._entries:
            self._flush()
        usage = self._usage_provider() if self._usage_provider else {}
        self._client.update("research_runs", {
            "finished_at": _now(),
            "countries_succeeded": updated,
            "input_tokens": usage.get("input"),
            "output_tokens": usage.get("output"),
            "notes": _notes(fatal, gate_counts),
        }, {"id": f"eq.{self._run_id}"})
        logger.info(
            "mirror: run %s recorded (%d countries mirrored, fatal=%s)",
            self._run_id, len(self._entries), fatal,
        )

    # -- gold-set drift check --------------------------------------------------

    def record_gold_check(self, row: dict) -> None:
        """Insert one ``drift.json`` row (``gold.drift_row``) into
        ``gold_checks``. Called by the CLI after ``finish``, outside the
        service, so it is not part of the :class:`Mirror` protocol; the CLI
        downgrades a failure to a warning like every other mirror call."""
        self._client.insert("gold_checks", [_gold_check_row(row)])

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

        # History: replace-per-country (delete + insert the file's snapshots),
        # keeping the run id of every snapshot that already existed.
        for e in self._entries:
            cid = country_ids[e.country]
            prior_run_ids = self._prior_run_ids(cid)
            self._client.delete("score_history", {"country_id": f"eq.{cid}"})
            rows = []
            for snap in e.history:
                scores = {k: v for k, v in snap.items() if k != "date"}
                rows.append({
                    "country_id": cid,
                    "snapshot_date": snap["date"],
                    "scores": scores,
                    "run_id": prior_run_ids.get(_scores_key(scores), self._run_id),
                })
            self._client.insert("score_history", rows)

        self._sync_sources(country_ids)

    def _prior_run_ids(self, country_id: str) -> dict[str, str]:
        """Map ``scores json -> run_id`` for the country's existing snapshot
        rows. Keyed by scores, not date: before September 2026 an unchanged
        snapshot's date advanced on every re-research, so rows written then
        can carry a different date from the file's."""
        rows = self._client.select_all("score_history", {
            "select": "scores,run_id",
            "country_id": f"eq.{country_id}",
        })
        return {
            _scores_key(r["scores"]): r["run_id"]
            for r in rows
            if r.get("run_id") and isinstance(r.get("scores"), dict)
        }

    def _resolve_country_ids(self, names: list[str]) -> dict[str, str]:
        rows = self._client.select_all("countries", {"select": "id,name"})
        ids = {r["name"]: r["id"] for r in rows}
        missing = [n for n in names if n not in ids]
        if missing:
            self._client.upsert("countries", [
                {"name": n, **_iso_columns(self._iso.get(n))} for n in missing
            ], on_conflict="name")
            rows = self._client.select_all("countries", {"select": "id,name"})
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
            for r in self._client.select_all("sources", {"select": "id,url"})
        }
        link_rows = []
        for country, url in links:
            source_id = source_ids.get(url)
            if source_id is None:
                # Should be impossible after the upsert above; never let one
                # missing id abort the whole flush.
                logger.warning("mirror: source id missing for %s - link skipped", url)
                continue
            link_rows.append({
                "country_id": country_ids[country],
                "source_id": source_id,
                "dimension": "general",
                "run_id": self._run_id,
                "last_cited": now,
            })
        if link_rows:
            self._client.upsert(
                "country_sources", link_rows, on_conflict="country_id,source_id,dimension"
            )


# -- row projections (DB shape; the CSV shape lives in repository.py) ----------


def _notes(fatal: bool, gate_counts: dict[str, int] | None) -> str | None:
    parts = []
    if fatal:
        parts.append("aborted on fatal API error; partial results mirrored")
    if gate_counts:
        parts.append("gate: " + " ".join(f"{k}={v}" for k, v in gate_counts.items()))
    return "; ".join(parts) or None


def _score_row(country_id: str, e: _Entry, run_id: str) -> dict:
    row = e.scores_row
    subscores, rationales = split_subscores_entry(e.subscores)
    return {
        "country_id": country_id,
        "regulation_status": _num(row.get("Regulation Status")),
        "policy_lever": _num(row.get("Policy Lever")),
        "governance_type": _num(row.get("Governance Type")),
        "actor_involvement": _num(row.get("Actor Involvement")),
        "enforcement_level": _num(row.get("Enforcement Level")),
        "avg_score": _num(row.get("Average Score")),
        # The gated subscores.json entry nests {score, rationale} (methodology
        # v2.1) or bare integers (v2). The DB keeps them in two columns, so a
        # held result mirrors the unchanged scores AND their unchanged rationales.
        "subscores": subscores,
        "rationales": rationales,
        "confidence": e.result.effective_confidence(),
        "data_version": int(row.get("Data Version") or 1),
        "run_id": run_id,
        "scored_at": e.subscores.get("date") or e.today.isoformat(),
        "updated_at": _now(),
        **evidence_columns(e.subscores),
    }


def evidence_columns(entry: dict | None) -> dict:
    """A subscores.json entry's ``evidence`` block as ``country_scores``
    columns (PRD 14). All three are ``None`` when the entry has no run record;
    ``initiatives_used`` keeps the file's null-versus-0 meaning. Shared with
    the seed so both write paths map the file the same way."""
    evidence = (entry or {}).get(EVIDENCE_KEY)
    if not isinstance(evidence, dict):
        evidence = {}
    return {
        "grounded": evidence.get("grounded"),
        "initiatives_used": evidence.get("initiatives_used"),
        "web_search": evidence.get("search"),
    }


def _num(value) -> float | None:
    """CSV cells arrive as strings; a held row keeps them that way."""
    if value in (None, "", "NA"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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


def _gold_check_row(row: dict) -> dict:
    """``drift.json`` row -> ``gold_checks`` columns. Same numbers, database
    names (``checked_on`` for ``date``)."""
    return {
        "run_id": row["run_id"],
        "checked_on": row["date"],
        "model": row["model"],
        "prompt_version": row["prompt_version"],
        "countries_compared": row["countries_compared"],
        "countries_missing": list(row["countries_missing"]),
        "mae_by_dimension": row["mae_by_dimension"],
        "within_one": row["within_one"],
        "max_dev": row["max_dev"],
        "max_dev_at": row["max_dev_at"],
    }


def _scores_key(scores: dict) -> str:
    """A stable identity for a snapshot's score set (see ``_prior_run_ids``)."""
    return json.dumps(scores, sort_keys=True, separators=(",", ":"))


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
    return json.loads(path.read_text(encoding="utf-8")).get("countries", {})


def _now() -> str:
    return datetime.now(UTC).isoformat()
