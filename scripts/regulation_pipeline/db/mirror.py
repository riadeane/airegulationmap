"""The dual-write mirror: after each pipeline run, replay what was applied
to the static files into Supabase, with full run provenance.

Design constraints (see the service for the call sites):

* The mirror is an OPTIONAL collaborator of ``PipelineService`` - the file
  ``Dataset`` and its byte contracts are untouched, and the service wraps
  every mirror call so a mirror failure can never fail (or even re-order)
  a run. The static files stay authoritative for the frontend's boot path.
* ``record`` buffers; ``finish`` flushes in one burst - the network cost is
  paid once, after ``dataset.save()`` has already secured the files.
* ``score_history`` is synced per recorded country to the file's snapshots
  rather than appended: a same-day re-run supersedes that day's snapshot
  (``history.py``), so an append-only mirror would drift from the file. The
  sync upserts every snapshot on ``(country_id, snapshot_date)`` first and
  only then deletes the rows whose dates the file no longer has, so a
  failed write never leaves a country with less history than before. A
  snapshot that already existed keeps its original ``run_id`` (matched by
  date and scores); only new snapshots get this run's id. ``run_id``
  therefore means "the run that introduced this change point", which is
  what the weekly digest's ``--run <id>`` regeneration relies on.
* The evidence columns of ``country_scores`` (``grounded``,
  ``initiatives_used``, ``web_search``) come from the ``evidence`` block of
  the subscores entry the service hands over, so the database says exactly
  what the file says, including null when the file has no run record.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Protocol

import httpx

from ..models import ResearchResult
from ..repository import EVIDENCE_KEY, FRONTIER_KEY, split_subscores_entry
from ..sources import classify_sources
from .client import SupabaseClient, SupabaseError

logger = logging.getLogger(__name__)

# research_runs row insert: attempts and linear backoff (seconds).
BEGIN_ATTEMPTS = 3
BEGIN_BACKOFF_SECONDS = 5.0


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
        self, updated: int, failed: int, fatal: bool, *,
        gate_counts: dict[str, int] | None = None, calibration_break: dict | None = None,
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
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._client = client
        self._meta = meta
        self._usage_provider = usage_provider
        self._iso = _load_iso(iso_path)
        self._run_id = str(uuid.uuid4())
        self._entries: list[_Entry] = []
        self._disabled = False
        self._sleep = sleep

    @property
    def run_id(self) -> str:
        """The ``research_runs.id`` this mirror writes. The service shares it
        so ``RunResult.run_id`` and the database agree."""
        return self._run_id

    # -- Mirror protocol -----------------------------------------------------

    def begin(self, attempted: int) -> None:
        """Insert the run's ``research_runs`` row, retrying a transient
        failure. Every later write references this row, so if it cannot be
        written the mirror turns itself off for the run with one warning,
        instead of failing each later write on the foreign key (#149)."""
        row = {
            "id": self._run_id,
            "trigger": self._meta.trigger,
            "model": self._meta.model,
            "strategy": self._meta.strategy,
            "prompt_version": self._meta.prompt_version,
            "grounded": self._meta.grounded,
            "git_sha": self._meta.git_sha,
            "countries_attempted": attempted,
        }
        for attempt in range(1, BEGIN_ATTEMPTS + 1):
            try:
                self._client.insert("research_runs", [row])
                return
            except (SupabaseError, httpx.HTTPError) as exc:
                if attempt == BEGIN_ATTEMPTS:
                    self._disabled = True
                    logger.warning(
                        "mirror: could not record run %s after %d attempts (%s) - the "
                        "Supabase mirror is off for this run; the data files are unaffected",
                        self._run_id, BEGIN_ATTEMPTS, exc,
                    )
                    return
                delay = BEGIN_BACKOFF_SECONDS * attempt
                logger.warning(
                    "mirror: recording run %s failed (%s) - retrying in %.0fs",
                    self._run_id, exc, delay,
                )
                self._sleep(delay)

    @property
    def disabled(self) -> bool:
        """True once :meth:`begin` gave up: record/finish/gold writes are skipped."""
        return self._disabled

    def record(
        self, country: str, result: ResearchResult, today: date,
        *, scores_row: dict, subscores: dict, history: list[dict],
    ) -> None:
        """Buffer one country. ``scores_row`` and ``subscores`` are what the
        dataset holds AFTER the stability gate, so a held result mirrors the
        unchanged scores while the text fields still refresh."""
        if self._disabled:
            return
        self._entries.append(_Entry(country, result, today, scores_row, subscores, history))

    def finish(
        self, updated: int, failed: int, fatal: bool, *,
        gate_counts: dict[str, int] | None = None, calibration_break: dict | None = None,
    ) -> None:
        if self._disabled:
            return
        if self._entries:
            self._flush()
        usage = self._usage_provider() if self._usage_provider else {}
        self._client.update("research_runs", {
            "finished_at": _now(),
            "countries_succeeded": updated,
            "input_tokens": usage.get("input"),
            "output_tokens": usage.get("output"),
            "est_cost_usd": usage.get("est_cost_usd"),
            "notes": _notes(fatal, gate_counts, usage.get("searches")),
        }, {"id": f"eq.{self._run_id}"})
        if calibration_break is not None:
            self._record_break(calibration_break)
        logger.info(
            "mirror: run %s recorded (%d countries mirrored, fatal=%s)",
            self._run_id, len(self._entries), fatal,
        )

    def _record_break(self, entry: dict) -> None:
        """Write the run's calibration break to ``research_runs`` in its own
        request, so a database without migration 0012 loses only the break,
        never the run's counts and finish time."""
        try:
            self._client.update(
                "research_runs", {"calibration_break": dict(entry)}, {"id": f"eq.{self._run_id}"},
            )
        except SupabaseError:
            logger.warning(
                "mirror: calibration break not recorded on run %s (is migration "
                "0012_research_runs_calibration_break.sql applied?)", self._run_id, exc_info=True,
            )

    # -- gold-set drift check --------------------------------------------------

    def record_gold_check(self, row: dict) -> None:
        """Insert one ``drift.json`` row (``gold.drift_row``) into
        ``gold_checks``. Called by the CLI after ``finish``, outside the
        service, so it is not part of the :class:`Mirror` protocol; the CLI
        downgrades a failure to a warning like every other mirror call."""
        if self._disabled:
            return
        full = _gold_check_row(row)
        try:
            self._client.insert("gold_checks", [full])
        except SupabaseError:
            # Migrations 0013 (gold-set columns) and 0014 (frontier) add
            # columns; before they are applied the insert fails on them, so
            # the check still lands without.
            legacy = {
                k: v for k, v in full.items() if k not in (*_GOLD_SET_COLUMNS, "frontier")
            }
            if legacy == full:
                raise
            logger.warning(
                "mirror: gold_checks has no %s columns (are migrations "
                "0013_gold_checks_gold_set.sql and 0014_frontier_risk_governance.sql "
                "applied?) - row written without them",
                "/".join((*_GOLD_SET_COLUMNS, "frontier")),
            )
            self._client.insert("gold_checks", [legacy])

    # -- flush ----------------------------------------------------------------

    def _flush(self) -> None:
        country_ids = self._resolve_country_ids([e.country for e in self._entries])

        scores_rows, summary_rows = [], []
        for e in self._entries:
            cid = country_ids[e.country]
            scores_rows.append(_score_row(cid, e, self._run_id))
            summary_rows.append(_summary_row(cid, e, self._run_id))
        self._upsert_with_fallback("country_scores", scores_rows, _FRONTIER_SCORE_COLUMNS)
        self._upsert_with_fallback("country_summaries", summary_rows, _FRONTIER_SUMMARY_COLUMNS)

        # History: sync each country to the file's snapshots, keeping the run
        # id of every snapshot that already existed. Upsert first, prune
        # after: a failure part-way leaves the old rows in place (#89).
        for e in self._entries:
            cid = country_ids[e.country]
            prior = self._prior_history(cid)
            rows = _history_rows(cid, e.history, prior, self._run_id)
            if not rows:
                continue  # never wipe a country's database history
            self._client.upsert("score_history", rows, on_conflict="country_id,snapshot_date")
            kept = {r["snapshot_date"] for r in rows}
            stale = sorted({r["snapshot_date"] for r in prior} - kept)
            if stale:
                self._client.delete("score_history", {
                    "country_id": f"eq.{cid}",
                    "snapshot_date": "in.(" + ",".join(stale) + ")",
                })

        self._sync_sources(country_ids)

    def _upsert_with_fallback(self, table: str, rows: list[dict], newer: tuple[str, ...]) -> None:
        """Upsert ``rows``; when the database lacks the ``newer`` columns
        (migration 0014, Frontier Risk Governance, not yet applied) the
        rows land without them, so the five dimensions still mirror."""
        try:
            self._client.upsert(table, rows, on_conflict="country_id")
        except SupabaseError:
            legacy = [{k: v for k, v in row.items() if k not in newer} for row in rows]
            if legacy == rows:
                raise
            logger.warning(
                "mirror: %s has no %s columns (is migration "
                "0014_frontier_risk_governance.sql applied?) - rows written without them",
                table, "/".join(newer),
            )
            self._client.upsert(table, legacy, on_conflict="country_id")

    def _prior_history(self, country_id: str) -> list[dict]:
        """The country's existing ``score_history`` rows
        (``snapshot_date``, ``scores``, ``run_id``), oldest first."""
        return self._client.select_all("score_history", {
            "select": "snapshot_date,scores,run_id",
            "order": "snapshot_date",
            "country_id": f"eq.{country_id}",
        })

    def _resolve_country_ids(self, names: list[str]) -> dict[str, str]:
        rows = self._client.select_all("countries", {"select": "id,name", "order": "id"})
        ids = {r["name"]: r["id"] for r in rows}
        missing = [n for n in names if n not in ids]
        if missing:
            self._client.upsert("countries", [
                {"name": n, **_iso_columns(self._iso.get(n))} for n in missing
            ], on_conflict="name")
            rows = self._client.select_all("countries", {"select": "id,name", "order": "id"})
            ids = {r["name"]: r["id"] for r in rows}
        return ids

    def _sync_sources(self, country_ids: dict[str, str]) -> None:
        now = _now()
        by_url: dict[str, dict] = {}
        links: list[tuple[str, str]] = []
        for e in self._entries:
            titles = e.result.source_titles
            for src in classify_sources(e.result.sources):
                row = by_url.setdefault(src.url, {
                    "url": src.url, "domain": src.domain,
                    "source_type": src.source_type, "last_seen": now,
                })
                if titles.get(src.url):
                    row["title"] = titles[src.url]
                links.append((e.country, src.url))
        if not by_url:
            return
        # first_seen is deliberately not supplied: the DB default applies on
        # insert, and merge-duplicates only updates supplied columns. A bulk
        # request sends one column set for every row, so titled rows (the
        # link check read the page) go in their own request; an untitled row
        # never overwrites a stored title with null.
        titled = [row for row in by_url.values() if "title" in row]
        untitled = [row for row in by_url.values() if "title" not in row]
        for rows in (titled, untitled):
            if rows:
                self._client.upsert("sources", rows, on_conflict="url")
        source_ids = {
            r["url"]: r["id"]
            for r in self._client.select_all("sources", {"select": "id,url", "order": "id"})
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


def _notes(
    fatal: bool, gate_counts: dict[str, int] | None, searches: int | None = None,
) -> str | None:
    parts = []
    if fatal:
        parts.append("aborted on fatal API error; partial results mirrored")
    if gate_counts:
        parts.append("gate: " + " ".join(f"{k}={v}" for k, v in gate_counts.items()))
    if searches:
        parts.append(f"web searches: {searches}")
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
        **frontier_columns(row, e.subscores),
    }


# country_scores / country_summaries columns added by migration 0014 (PRD 15).
_FRONTIER_SCORE_COLUMNS = ("frontier_risk", "frontier_track", "frontier_subscores")
_FRONTIER_SUMMARY_COLUMNS = ("frontier_risk_text", "frontier_sources_raw")


def frontier_columns(scores_row: dict, entry: dict | None) -> dict:
    """The lens's ``country_scores`` columns from the scores.csv row and the
    subscores.json entry's ``frontier`` block: all ``None`` for a country
    not yet scored on the lens. Shared with the seed."""
    block = (entry or {}).get(FRONTIER_KEY)
    return {
        "frontier_risk": _num(scores_row.get("Frontier Risk")),
        "frontier_track": scores_row.get("Frontier Track") or None,
        "frontier_subscores": dict(block) if isinstance(block, dict) else None,
    }


def frontier_summary_columns(regulation_row: dict | None) -> dict:
    """The lens's ``country_summaries`` columns from a regulation_data.csv
    row (``None`` when empty). Shared with the seed."""
    row = regulation_row or {}
    return {
        "frontier_risk_text": row.get("Frontier Risk") or None,
        "frontier_sources_raw": row.get("Frontier Sources") or None,
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
        **_frontier_text_columns(e.result),
    }


def _frontier_text_columns(result: ResearchResult) -> dict:
    """The lens's text and sources from the (link-checked) result, which
    is what regulation_data.csv now holds; ``None`` without a block."""
    answer = result.frontier_answer()
    if answer is None:
        return {"frontier_risk_text": None, "frontier_sources_raw": None}
    return {
        "frontier_risk_text": answer.text.strip() or None,
        "frontier_sources_raw": answer.cleaned_sources().strip() or None,
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
        # Rows written before #163 carry no bias; the column is nullable.
        "bias_by_dimension": row.get("bias_by_dimension"),
        "within_one": row["within_one"],
        "max_dev": row["max_dev"],
        "max_dev_at": row["max_dev_at"],
        # #99: rows written before these existed carry none; all nullable.
        **{column: row.get(column) for column in _GOLD_SET_COLUMNS},
    }


# gold_checks columns added by migration 0013 (#99).
_GOLD_SET_COLUMNS = ("gold_verified", "gold_version", "grounded_countries")


def _history_rows(
    country_id: str, snapshots: list[dict], prior: list[dict], run_id: str,
) -> list[dict]:
    """``score_history`` rows for a country's file snapshots, each carrying
    the run that introduced it.

    A snapshot keeps the ``run_id`` of the existing row with the same date
    and scores. Rows written before September 2026 can carry a date the file
    no longer has (an unchanged snapshot's date used to advance on every
    re-research), so a snapshot with no exact match takes the run id of an
    existing row with equal scores whose date the file does not have, each
    such row at most once and oldest first. Rows whose date the file still
    has never match loosely, so a score that reverts (A, B, then A again)
    is a new change point with this run's id, not the first A's."""
    file_dates = {s["date"] for s in snapshots}
    exact: dict[tuple[str, str], str] = {}
    loose: dict[str, list[str]] = {}
    for row in prior:
        if not row.get("run_id") or not isinstance(row.get("scores"), dict):
            continue
        key = _scores_key(row["scores"])
        day = str(row.get("snapshot_date"))
        exact[(day, key)] = row["run_id"]
        if day not in file_dates:
            loose.setdefault(key, []).append(row["run_id"])

    rows = []
    for snap in sorted(snapshots, key=lambda s: s["date"]):
        scores = {k: v for k, v in snap.items() if k != "date"}
        key = _scores_key(scores)
        introduced = exact.get((snap["date"], key))
        if introduced is None and loose.get(key):
            introduced = loose[key].pop(0)
        rows.append({
            "country_id": country_id,
            "snapshot_date": snap["date"],
            "scores": scores,
            "run_id": introduced or run_id,
        })
    return rows


def _scores_key(scores: dict) -> str:
    """A stable identity for a snapshot's score set (see ``_history_rows``)."""
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
