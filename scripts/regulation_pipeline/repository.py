"""The dataset repository: the data stores that always travel together.

``scores.csv``, ``regulation_data.csv``, ``history.json``, ``subscores.json``,
and ``pending.json`` are loaded, mutated, and saved as a unit. :class:`Dataset`
owns all five, folds a validated
:class:`~regulation_pipeline.models.ResearchResult` into them via :meth:`apply`,
and persists them with atomic writes so an interrupted run can't leave a
half-written CSV behind. ``pending.json`` holds the score candidates the
stability gate (:mod:`gate`) held back for one run.

Each researched country's ``subscores.json`` entry also carries an
``evidence`` block (PRD 14, :meth:`Dataset.set_evidence`): how the most recent
research pass was done. It is metadata beside the dimension blocks, not a
dimension, so :func:`split_subscores_entry` leaves it out.
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
from .models import METHODOLOGY_VERSION, ResearchResult
from .names import CountryNames

logger = logging.getLogger(__name__)

_SCORE_COLUMNS = (
    "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Enforcement Level", "Average Score",
)

# Key of the per-country research record inside a subscores.json entry:
# ``{grounded, initiatives_used, search, model, run_id}``.
EVIDENCE_KEY = "evidence"


@dataclass(frozen=True)
class ApplyOutcome:
    """What :meth:`Dataset.apply` did, for logging."""

    average: float
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
            scores=_load_csv(settings.scores_csv, names),
            regulation=_load_csv(settings.regulation_csv, names),
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

    def history_for(self, country: str) -> list[dict]:
        """A country's history snapshots (file shape), as copies - read-only
        access for the Supabase mirror's replace-per-country sync."""
        return [dict(s) for s in self._history.get("countries", {}).get(country, [])]

    def subscores_for(self, country: str) -> dict | None:
        """The stored sub-score entry (file shape, including any ``evidence``
        block), as a copy."""
        entry = self._subscores.get("countries", {}).get(country)
        return dict(entry) if entry is not None else None

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
        """Append a calibration break ``{date, model, prompt_version, reason}``
        to ``history.json``. A repeat of the same date and reason is a no-op so
        a re-run on the same day records one break."""
        breaks = self._history.setdefault("breaks", [])
        for existing in breaks:
            if existing.get("date") == entry["date"] and existing.get("reason") == entry["reason"]:
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
        # captures dimension-score changes - a sources/confidence-only change
        # would otherwise leave no record of what was replaced. Log the prior
        # snapshot so an operator can reconstruct it from the run log.
        prior = self._regulation.get(country)
        if prior is not None:
            logger.debug(
                "overwriting %s (was: confidence=%s, sources=%r, last_updated=%s)",
                country, prior.get("Confidence"), prior.get("Sources"), prior.get("Last Updated"),
            )

        self._regulation[country] = _regulation_row(country, result, today)

        if not apply_scores:
            held = dict(existing_scores)
            held["Last Updated"] = today.isoformat()
            held["Data Version"] = version + 1
            self._scores[country] = held
            return ApplyOutcome(
                average=_as_float(held.get("Average Score")),
                confidence=result.effective_confidence(),
                history_added=False,
                scores_applied=False,
            )

        self._scores[country] = _scores_row(country, result, version + 1, today)
        self._subscores["countries"][country] = _subscores_entry(result, today)
        # The tag describes the newest entries; older entries keep the v2
        # integer shape until their next research pass. Readers must accept
        # both (see ``split_subscores_entry``).
        self._subscores["methodology"] = METHODOLOGY_VERSION

        snapshot = _history_snapshot(result, today)
        added = history_mod.append_snapshot(self._history, country, snapshot)

        return ApplyOutcome(
            average=result.average_score(),
            confidence=result.effective_confidence(),
            history_added=added,
        )

    # -- validation ------------------------------------------------------------

    def validate(self) -> list[str]:
        """Final safety net before writing: every score column must be numeric
        and in [1, 5], and every emitted row must carry exactly the contracted
        columns. Structured outputs make range violations unlikely, but a
        projection bug that dropped or mistyped a column would be caught here."""
        errors: list[str] = []
        for country, row in self._scores.items():
            if set(row) != set(SCORES_FIELDS):
                missing = set(SCORES_FIELDS) - set(row)
                extra = set(row) - set(SCORES_FIELDS)
                errors.append(f"{country}: scores columns off (missing={missing}, extra={extra})")
            for field in _SCORE_COLUMNS:
                value = row.get(field, "")
                if value in ("", "NA"):
                    continue
                try:
                    score = float(value)
                except (TypeError, ValueError):
                    errors.append(f"{country}: {field} value {value!r} is not numeric")
                    continue
                if not 1 <= score <= 5:
                    errors.append(f"{country}: {field} score {score} out of range [1,5]")
        return errors

    # -- persistence -----------------------------------------------------------

    def save(self) -> None:
        _write_text(self._settings.scores_csv, _csv_text(self._scores, SCORES_FIELDS))
        _write_text(self._settings.regulation_csv, _csv_text(self._regulation, REGULATION_FIELDS))
        # No trailing newline on the JSON files - matches the byte layout the
        # existing files already have, so an unchanged run produces no diff.
        _write_text(
            self._settings.history_json,
            json.dumps(self._history, ensure_ascii=False, indent=2),
        )
        _write_text(
            self._settings.subscores_json,
            json.dumps(self._subscores, ensure_ascii=False, indent=2, sort_keys=True),
        )
        _write_text(
            self._settings.pending_json,
            json.dumps(self._pending, ensure_ascii=False, indent=2),
        )


# -- projections (research result -> persistence rows) -------------------------


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
    sub-indicator, so the audit trail carries the fact behind each score."""
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
    "rationale": "..."}``). Returns ``None`` rationales for a v2 entry. The
    ``evidence`` block is not a dimension and appears in neither."""
    scores: dict = {}
    rationales: dict = {}
    for key, block in entry.items():
        if key == EVIDENCE_KEY:
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
    # stay stable: date, five dimensions in canonical order, then averageScore.
    snapshot: dict = {"date": today.isoformat()}
    for dim in result.dimensions().values():
        snapshot[dim.history_key] = dim.score
    snapshot["averageScore"] = result.average_score()
    return snapshot


def _empty_pending() -> dict:
    return {"schema_version": 1, "pending": []}


def _as_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


# -- low-level IO --------------------------------------------------------------


def _load_csv(path: Path, names: CountryNames) -> dict[str, dict]:
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
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    # Write + flush + fsync the data before we swap it into place.
    with tmp.open("w", encoding="utf-8", newline="") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)
    # Persist the directory entry (the rename) too. Best-effort: some
    # platforms/filesystems don't allow opening a directory for fsync.
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass
