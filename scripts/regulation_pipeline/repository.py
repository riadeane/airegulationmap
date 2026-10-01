"""The dataset repository: the data stores that always travel together.

``scores.csv``, ``regulation_data.csv``, ``history.json``, ``subscores.json``,
and ``pending.json`` are loaded, mutated, and saved as a unit. :class:`Dataset`
owns all five, folds a validated
:class:`~regulation_pipeline.models.ResearchResult` into them via :meth:`apply`,
and persists them with atomic writes so an interrupted run can't leave a
half-written CSV behind. ``pending.json`` holds the stability gate's state
(:mod:`gate`): the score candidates it held back for one run, and under
``seen_sources`` every source URL each country has cited, so the evidence
rule can tell a new source from a re-cited one.

Each researched country's ``subscores.json`` entry also carries an
``evidence`` block (PRD 14, :meth:`Dataset.set_evidence`): how the most recent
research pass was done. It is metadata beside the dimension blocks, not a
dimension, so :func:`split_subscores_entry` leaves it out.

A dimension or composite score can be ``None`` (insufficient evidence,
rubric v3.1): ``scores.csv`` then holds an empty cell (the csv module writes
``None`` as ``""``), the history snapshot holds ``null``, and the
subscores.json sub-indicator is ``{"score": null, "rationale": ...}``.

Frontier Risk Governance (PRD 15) travels in the same five stores but lands
on its own (:meth:`Dataset.apply_frontier`), so the stability gate can decide
it apart from the five dimensions: ``scores.csv`` gains ``Frontier Risk`` and
``Frontier Track`` (both empty until the country is first scored on the
lens), ``regulation_data.csv`` gains its text and ``Frontier Sources``, each
subscores.json entry a ``frontier`` block (metadata beside the dimension
blocks, like ``evidence``), history snapshots ``frontierRisk`` and
``frontierTrack``, and ``pending.json`` a ``frontier_pending`` list for held
frontier candidates. A main apply carries the frontier columns and snapshot
keys over unchanged, and a frontier apply leaves the five dimensions alone.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from . import history as history_mod
from .config import REGULATION_FIELDS, SCORES_FIELDS, Settings
from .models import (
    FRONTIER_COLUMN,
    FRONTIER_HISTORY_KEY,
    FRONTIER_SOURCES_COLUMN,
    FRONTIER_TRACK_COLUMN,
    FRONTIER_TRACK_HISTORY_KEY,
    METHODOLOGY_VERSION,
    TRACKS,
    FrontierRecord,
    ResearchResult,
)
from .names import CountryNames

logger = logging.getLogger(__name__)

_SCORE_COLUMNS = (
    "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Enforcement Level", "Average Score",
)

# Key of the per-country research record inside a subscores.json entry:
# ``{grounded, initiatives_used, search, model, run_id}``.
EVIDENCE_KEY = "evidence"
# Key of the Frontier Risk Governance block inside a subscores.json entry
# (``FrontierRecord.entry``): metadata beside the dimension blocks.
FRONTIER_KEY = "frontier"
# Entry keys that are not one of the five dimension blocks.
_NON_DIMENSION_KEYS = frozenset({EVIDENCE_KEY, FRONTIER_KEY})

# scores.csv / regulation_data.csv columns of the lens, which a main apply
# carries over from the stored row.
_FRONTIER_SCORE_FIELDS = (FRONTIER_COLUMN, FRONTIER_TRACK_COLUMN)
_FRONTIER_TEXT_FIELDS = (FRONTIER_COLUMN, FRONTIER_SOURCES_COLUMN)
_FRONTIER_SNAPSHOT_KEYS = (FRONTIER_HISTORY_KEY, FRONTIER_TRACK_HISTORY_KEY)


@dataclass(frozen=True)
class ApplyOutcome:
    """What :meth:`Dataset.apply` did, for logging."""

    average: float | None
    confidence: str
    history_added: bool
    scores_applied: bool = True


class Dataset:
    """In-memory view of the five data stores, keyed by canonical country name."""

    def __init__(
        self,
        settings: Settings,
        scores: dict[str, dict],
        regulation: dict[str, dict],
        history: dict,
        subscores: dict,
        pending: dict | None = None,
    ):
        self._settings = settings
        self._scores = scores
        self._regulation = regulation
        self._history = history
        self._subscores = subscores
        self._pending = pending if pending is not None else _empty_pending()

    # -- loading ---------------------------------------------------------------

    @classmethod
    def load(cls, settings: Settings, names: CountryNames) -> Dataset:
        return cls(
            settings,
            scores=_load_csv(settings.scores_csv, names, SCORES_FIELDS),
            regulation=_load_csv(settings.regulation_csv, names, REGULATION_FIELDS),
            history=_load_json(settings.history_json, {"schema_version": 1, "countries": {}}),
            subscores=_load_json(settings.subscores_json, {"schema_version": 1, "countries": {}}),
            pending=_load_json(settings.pending_json, _empty_pending()),
        )

    # -- accessors -------------------------------------------------------------

    def countries(self) -> list[str]:
        """All known countries, sorted."""
        return sorted(self._scores)

    def scores_row(self, country: str) -> dict | None:
        return self._scores.get(country)

    def regulation_row(self, country: str) -> dict | None:
        return self._regulation.get(country)

    def breaks(self) -> list[dict]:
        """Recorded calibration breaks (``history.json`` ``breaks``), as copies."""
        return [dict(entry) for entry in self._history.get("breaks", [])]

    def history_for(self, country: str) -> list[dict]:
        """A country's history snapshots (file shape), as copies - read-only
        access for the Supabase mirror's replace-per-country sync."""
        return [dict(s) for s in self._history.get("countries", {}).get(country, [])]

    def subscores_for(self, country: str) -> dict | None:
        """The stored sub-score entry (file shape, including any ``evidence``
        block), as a copy."""
        entry = self._subscores.get("countries", {}).get(country)
        return dict(entry) if entry is not None else None

    def seen_sources_for(self, country: str) -> frozenset[str]:
        """Every source URL ``country`` has cited on earlier runs, in
        :func:`gate.normalise_url` form (``pending.json`` ``seen_sources``)."""
        return frozenset(self._pending.get("seen_sources", {}).get(country, ()))

    def remember_sources(self, country: str, urls: frozenset[str]) -> None:
        """Add ``urls`` (normalised) to the country's cited-source memory."""
        if not urls:
            return
        seen = self._pending.setdefault("seen_sources", {})
        seen[country] = sorted(set(seen.get(country, ())) | set(urls))
        self._pending["seen_sources"] = dict(sorted(seen.items()))

    def frontier_pending_for(self, country: str) -> dict | None:
        """The gate's stored frontier candidate for ``country``:
        ``{"candidate": float | None, "track": "H", "first_seen": "YYYY-MM-DD"}``
        or ``None``."""
        for entry in self._pending.get("frontier_pending", []):
            if entry.get("country") == country:
                return {k: v for k, v in entry.items() if k != "country"}
        return None

    def set_frontier_pending(self, country: str, entry: dict | None) -> None:
        """Store (or with ``None`` clear) the gate's frontier candidate. The
        list exists only once something was held, so a dataset that never
        held a frontier score keeps ``pending.json`` byte-identical."""
        stored = self._pending.get("frontier_pending")
        if stored is None and entry is None:
            return
        kept = [e for e in (stored or []) if e.get("country") != country]
        if entry is not None:
            kept.append({"country": country, **entry})
        kept.sort(key=lambda e: e["country"])
        self._pending["frontier_pending"] = kept

    def pending_for(self, country: str) -> dict | None:
        """The gate's stored candidate for ``country``:
        ``{"candidate_scores": {...}, "first_seen": "YYYY-MM-DD"}`` or ``None``."""
        for entry in self._pending.get("pending", []):
            if entry.get("country") == country:
                return {k: v for k, v in entry.items() if k != "country"}
        return None

    # -- mutation --------------------------------------------------------------

    def set_pending(self, country: str, entry: dict | None) -> None:
        """Store (or with ``None`` clear) the gate's candidate for ``country``."""
        kept = [e for e in self._pending.get("pending", []) if e.get("country") != country]
        if entry is not None:
            kept.append({"country": country, **entry})
        kept.sort(key=lambda e: e["country"])
        self._pending["pending"] = kept

    def set_evidence(self, country: str, record: dict | None) -> None:
        """Store (or with ``None`` remove) the research record for
        ``country`` under its subscores.json entry: ``{grounded,
        initiatives_used, search, model, run_id}``, describing the pass behind
        the entry's text, sources and confidence. It is written for a held
        result too, so an entry whose sub-scores are older than its text can
        exist; an absent entry is created."""
        countries = self._subscores.setdefault("countries", {})
        if record is None:
            entry = countries.get(country)
            if entry is not None:
                entry.pop(EVIDENCE_KEY, None)
            return
        countries.setdefault(country, {})[EVIDENCE_KEY] = dict(record)

    def record_break(self, entry: dict) -> None:
        """Append a calibration break ``{date, model, prompt_version, rubric,
        reason, complete}`` to ``history.json``. A repeat of the same date and
        reason replaces the entry, so a re-run on the same day records one
        break."""
        breaks = self._history.setdefault("breaks", [])
        for i, existing in enumerate(breaks):
            if existing.get("date") == entry["date"] and existing.get("reason") == entry["reason"]:
                breaks[i] = dict(entry)  # a same-day re-run updates it (e.g. complete)
                return
        breaks.append(dict(entry))

    def apply(
        self, country: str, result: ResearchResult, today: date, *, apply_scores: bool = True,
    ) -> ApplyOutcome:
        """Fold one validated research result into the stores.

        With ``apply_scores=False`` (the gate held the result) only the text
        row lands, plus ``Last Updated`` and ``Data Version`` on the scores
        row. The dimension scores, the sub-scores, and the history snapshot
        stay as they were. A country with no scores row always applies."""
        existing_scores = self._scores.get(country)
        version = int((existing_scores or {}).get("Data Version", 1) or 1)
        if existing_scores is None:
            apply_scores = True

        # Audit trail: apply() overwrites in place, and history.json only
        # captures score and confidence changes - a sources-only change
        # would otherwise leave no record of what was replaced. Log the prior
        # snapshot so an operator can reconstruct it from the run log.
        prior = self._regulation.get(country)
        if prior is not None:
            logger.debug(
                "overwriting %s (was: confidence=%s, sources=%r, last_updated=%s)",
                country, prior.get("Confidence"), prior.get("Sources"), prior.get("Last Updated"),
            )

        self._regulation[country] = {
            **_regulation_row(country, result, today), **_frontier_fields(prior, _FRONTIER_TEXT_FIELDS),
        }

        if not apply_scores:
            held = dict(existing_scores)
            held["Last Updated"] = today.isoformat()
            held["Data Version"] = version + 1
            self._scores[country] = held
            return ApplyOutcome(
                average=_as_score(held.get("Average Score")),
                confidence=result.effective_confidence(),
                history_added=self._record_held_confidence(
                    country, result.effective_confidence(), today,
                ),
                scores_applied=False,
            )

        self._scores[country] = {
            **_scores_row(country, result, version + 1, today),
            **_frontier_fields(existing_scores, _FRONTIER_SCORE_FIELDS),
        }
        # The frontier block lands on its own (apply_frontier); keep it.
        stored_frontier = self._subscores["countries"].get(country, {}).get(FRONTIER_KEY)
        self._subscores["countries"][country] = _subscores_entry(result, today)
        if stored_frontier is not None:
            self._subscores["countries"][country][FRONTIER_KEY] = stored_frontier
        # The tag describes the newest entries; older entries keep the v2
        # integer shape until their next research pass. Readers must accept
        # both (see ``split_subscores_entry``).
        self._subscores["methodology"] = METHODOLOGY_VERSION

        snapshot = _history_snapshot(result, today)
        # The lens moves on its own; a main snapshot repeats its last state.
        latest = (self._history.get("countries", {}).get(country) or [{}])[-1]
        snapshot.update({k: latest[k] for k in _FRONTIER_SNAPSHOT_KEYS if k in latest})
        added = history_mod.append_snapshot(self._history, country, snapshot)

        return ApplyOutcome(
            average=result.average_score(),
            confidence=result.effective_confidence(),
            history_added=added,
        )

    def apply_frontier(
        self, country: str, record: FrontierRecord, today: date, *, apply_score: bool = True,
    ) -> bool:
        """Fold one assembled Frontier Risk Governance record into the
        stores, after :meth:`apply` wrote the country's main rows.

        The text and sources always land in regulation_data.csv. With
        ``apply_score`` (the gate let it through) the score and track land in
        scores.csv, the block in subscores.json, and the history records the
        change: today's snapshot is amended when the main apply wrote one,
        else a copy of the latest snapshot with the new frontier values is
        appended. Returns ``True`` when history changed. A country must have
        main rows first (``apply`` creates them)."""
        reg = self._regulation[country]
        reg[FRONTIER_COLUMN] = record.text
        reg[FRONTIER_SOURCES_COLUMN] = record.sources
        if not apply_score:
            return False
        row = self._scores[country]
        row[FRONTIER_COLUMN] = record.score
        row[FRONTIER_TRACK_COLUMN] = record.track
        self._subscores.setdefault("countries", {}).setdefault(country, {})[FRONTIER_KEY] = (
            record.entry(today)
        )
        return history_mod.set_frontier(
            self._history, country, today.isoformat(),
            {FRONTIER_HISTORY_KEY: record.score, FRONTIER_TRACK_HISTORY_KEY: record.track},
        )

    def _record_held_confidence(self, country: str, confidence: str, today: date) -> bool:
        """A held result keeps its scores but still writes its confidence to
        regulation_data.csv, so history records a confidence change with the
        held scores copied from the last snapshot (the scores the map still
        shows). Returns ``True`` when a snapshot was appended."""
        snapshots = self._history.get("countries", {}).get(country)
        if not snapshots:
            return False
        snapshot = {k: v for k, v in snapshots[-1].items() if k != "date"}
        snapshot = {"date": today.isoformat(), **snapshot, "confidence": confidence}
        return history_mod.append_snapshot(self._history, country, snapshot)

    # -- validation ------------------------------------------------------------

    def validate(self) -> list[str]:
        """Final safety net before writing: every score column must be empty
        (insufficient evidence) or numeric and in [1, 5], and every emitted
        row must carry exactly the contracted columns. Structured outputs make range violations unlikely, but a
        projection bug that dropped or mistyped a column would be caught here."""
        errors: list[str] = []
        for country, row in self._scores.items():
            if set(row) != set(SCORES_FIELDS):
                missing = set(SCORES_FIELDS) - set(row)
                extra = set(row) - set(SCORES_FIELDS)
                errors.append(f"{country}: scores columns off (missing={missing}, extra={extra})")
            for field in (*_SCORE_COLUMNS, FRONTIER_COLUMN):
                value = row.get(field, "")
                if value in ("", "NA", None):
                    continue
                try:
                    score = float(value)
                except (TypeError, ValueError):
                    errors.append(f"{country}: {field} value {value!r} is not numeric")
                    continue
                if not 1 <= score <= 5:
                    errors.append(f"{country}: {field} score {score} out of range [1,5]")
            track = row.get(FRONTIER_TRACK_COLUMN) or ""
            if track not in ("", *TRACKS):
                errors.append(f"{country}: {FRONTIER_TRACK_COLUMN} {track!r} is not one of {TRACKS}")
            elif not track and row.get(FRONTIER_COLUMN) not in ("", None):
                errors.append(f"{country}: {FRONTIER_COLUMN} is set without a {FRONTIER_TRACK_COLUMN}")
        return errors

    # -- persistence -----------------------------------------------------------

    def save(self) -> None:
        """Write the five stores as a set: every temp file is written and
        fsynced first, then the five renames run back to back, so a crash
        while writing (the slow part) leaves the old set intact and only a
        crash between two renames can mix old and new files, which
        :meth:`consistency_errors` then catches on the next load (#149)."""
        # No trailing newline on the JSON files - matches the byte layout the
        # existing files already have, so an unchanged run produces no diff.
        files = [
            (self._settings.scores_csv, _csv_text(self._scores, SCORES_FIELDS)),
            (self._settings.regulation_csv, _csv_text(self._regulation, REGULATION_FIELDS)),
            (self._settings.history_json, json.dumps(self._history, ensure_ascii=False, indent=2)),
            (
                self._settings.subscores_json,
                json.dumps(self._subscores, ensure_ascii=False, indent=2, sort_keys=True),
            ),
            (self._settings.pending_json, json.dumps(self._pending, ensure_ascii=False, indent=2)),
        ]
        staged = [(_stage_text(path, text), path) for path, text in files]
        for tmp, path in staged:
            tmp.replace(path)
        for directory in {path.parent for _, path in staged}:
            _fsync_dir(directory)

    def consistency_errors(self) -> list[str]:
        """Disagreements a save interrupted between two renames would leave:
        history has a country ``scores.csv`` lacks, or a country's latest
        snapshot does not hold the scores in ``scores.csv``. ``save`` renames
        scores.csv first and history.json third, so a crash between them
        shows up here for every country the run re-scored. Empty when they
        agree (#149)."""
        errors: list[str] = []
        for country, snapshots in sorted(self._history.get("countries", {}).items()):
            if not snapshots:
                continue
            row = self._scores.get(country)
            if row is None:
                errors.append(f"{country}: in history.json but not in scores.csv")
                continue
            latest = max(snapshots, key=lambda s: str(s.get("date", "")))
            # _SCORE_COLUMNS lists the five dimensions in DIMENSIONS order.
            for dim, column in zip(ResearchResult.DIMENSIONS, _SCORE_COLUMNS, strict=False):
                stored = _as_score(row.get(column))
                recorded = latest.get(dim.history_key)
                recorded = None if recorded is None else round(float(recorded), 2)
                if (None if stored is None else round(stored, 2)) != recorded:
                    errors.append(
                        f"{country}: scores.csv {dim.history_key} {stored} differs from its "
                        f"latest history snapshot ({latest.get('date')}: {recorded})"
                    )
                    break
            else:
                # The lens: a snapshot without the keys is "never scored",
                # which scores.csv writes as an empty track.
                stored = _as_score(row.get(FRONTIER_COLUMN))
                recorded = latest.get(FRONTIER_HISTORY_KEY)
                recorded = None if recorded is None else round(float(recorded), 2)
                track = row.get(FRONTIER_TRACK_COLUMN) or None
                if (
                    (None if stored is None else round(stored, 2)) != recorded
                    or track != latest.get(FRONTIER_TRACK_HISTORY_KEY)
                ):
                    errors.append(
                        f"{country}: scores.csv frontier {stored} ({track}) differs from its "
                        f"latest history snapshot ({latest.get('date')}: {recorded}, "
                        f"{latest.get(FRONTIER_TRACK_HISTORY_KEY)})"
                    )
        return errors


# -- projections (research result -> persistence rows) -------------------------


def _frontier_fields(row: dict | None, fields: tuple[str, ...]) -> dict:
    """The lens's columns from a stored row, empty when there is none."""
    return {field: (row or {}).get(field, "") for field in fields}


def _scores_row(country: str, result: ResearchResult, version: int, today: date) -> dict:
    scores = result.dimension_scores()
    return {
        "Country": country,
        "Regulation Status": scores["regulation_status"],
        "Policy Lever": scores["policy_lever"],
        "Governance Type": scores["governance_type"],
        "Actor Involvement": scores["actor_involvement"],
        "Average Score": result.average_score(),
        "Enforcement Level": scores["enforcement_level"],
        "Last Updated": today.isoformat(),
        "Data Version": version,
    }


def _regulation_row(country: str, result: ResearchResult, today: date) -> dict:
    dims = result.dimensions()
    return {
        "Country": country,
        "Regulation Status": dims["regulation_status"].text,
        "Policy Lever": dims["policy_lever"].text,
        "Governance Type": dims["governance_type"].text,
        "Actor Involvement": dims["actor_involvement"].text,
        "Enforcement Level": dims["enforcement_level"].text,
        "Specific Laws": result.specific_laws,
        "Sources": result.sources.strip(),
        "Last Updated": today.isoformat(),
        "Confidence": result.effective_confidence(),
    }


def _subscores_entry(result: ResearchResult, today: date) -> dict:
    """Methodology v2.1 shape: ``{"score": int, "rationale": str}`` per
    sub-indicator, so the audit trail carries the fact behind each score.
    An insufficient-evidence sub-indicator is ``{"score": null, ...}``, its
    rationale saying what was searched."""
    entry: dict = {"date": today.isoformat()}
    for key, dim in result.dimensions().items():
        scores, rationales = dim.subscores(), dim.rationales()
        entry[key] = {
            name: {"score": scores[name], "rationale": rationales[name]} for name in scores
        }
    return entry


def split_subscores_entry(entry: dict) -> tuple[dict, dict | None]:
    """Split one subscores.json country entry into the integer sub-scores
    (with ``date``) and the rationales (without). Accepts both file shapes:
    v2 (``"binding_force": 4``) and v2.1 (``"binding_force": {"score": 4,
    "rationale": "..."}``, where ``score`` may be ``null`` for insufficient
    evidence and stays ``None`` here). Returns ``None`` rationales for a v2 entry. The
    ``evidence`` and ``frontier`` blocks are not dimensions and appear in
    neither."""
    scores: dict = {}
    rationales: dict = {}
    for key, block in entry.items():
        if key in _NON_DIMENSION_KEYS:
            continue
        if not isinstance(block, dict):
            scores[key] = block  # "date" and any future scalar metadata
            continue
        scores[key] = {}
        for name, value in block.items():
            if isinstance(value, dict):
                scores[key][name] = value.get("score")
                if value.get("rationale"):
                    rationales.setdefault(key, {})[name] = value["rationale"]
            else:
                scores[key][name] = value
    return scores, (rationales or None)


def _history_snapshot(result: ResearchResult, today: date) -> dict:
    # Key order matters - history.json is written without sort_keys, and the
    # frontend reads snapshots positionally-agnostic but the file diff should
    # stay stable: date, five dimensions in canonical order, averageScore,
    # then the confidence written to regulation_data.csv.
    snapshot: dict = {"date": today.isoformat()}
    for dim in result.dimensions().values():
        snapshot[dim.history_key] = dim.score
    snapshot["averageScore"] = result.average_score()
    snapshot[history_mod.CONFIDENCE_KEY] = result.effective_confidence()
    return snapshot


def _empty_pending() -> dict:
    return {"schema_version": 1, "pending": []}


def _as_score(value) -> float | None:
    """A scores.csv cell as a number, ``None`` for an empty cell
    (insufficient evidence) or anything non-numeric."""
    if value in (None, "", "NA"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# -- low-level IO --------------------------------------------------------------


def _load_csv(path: Path, names: CountryNames, fields: list[str] | None = None) -> dict[str, dict]:
    """Rows keyed by canonical name. With ``fields`` a column the file lacks
    (one added to the contract since it was written) loads as an empty
    cell, so every row carries the full contract."""
    rows: dict[str, dict] = {}
    if not path.exists():
        return rows
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            canonical = names.canonical(row["Country"])
            row = dict(row)
            row["Country"] = canonical
            # Normalize the one numeric column on load so the in-memory store
            # doesn't mix a string version (fresh load) with the int apply()
            # writes. Round-trips byte-identically (DictWriter renders both the
            # same). Malformed/missing → 1.
            if "Data Version" in row:
                try:
                    row["Data Version"] = int(row["Data Version"])
                except (TypeError, ValueError):
                    row["Data Version"] = 1
            for field in fields or ():
                row.setdefault(field, "")
            rows[canonical] = row
    return rows


def _load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _csv_text(rows_by_country: dict[str, dict], fieldnames: list[str]) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in sorted(rows_by_country.values(), key=lambda r: r["Country"]):
        writer.writerow(row)
    return buffer.getvalue()


def _write_text(path: Path, text: str) -> None:
    """Atomically and durably write ``text`` to ``path`` (tmp file + fsync +
    ``os.replace``) so an interrupted write can never leave a half-written data
    file, and a power loss right after the run can't lose a committed month.

    ``os.replace`` is atomic for the rename, but without fsync the bytes may
    still be in the page cache when a CI/cloud runner is yanked. We fsync the
    temp file before the swap, then fsync the containing directory so the
    rename itself is on stable storage."""
    _stage_text(path, text).replace(path)
    _fsync_dir(path.parent)


def _stage_text(path: Path, text: str) -> Path:
    """Write ``text`` to ``path``'s temp file and fsync it; returns the temp
    path for the caller to rename into place."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    # Write + flush + fsync the data before it is swapped into place.
    with tmp.open("w", encoding="utf-8", newline="") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    return tmp


def _fsync_dir(directory: Path) -> None:
    # Persist the directory entry (the rename) too. Best-effort: some
    # platforms/filesystems don't allow opening a directory for fsync.
    try:
        dir_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass
