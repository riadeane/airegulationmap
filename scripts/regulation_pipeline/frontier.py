"""Frontier Risk Governance (PRD 15): tracks, the computed sub-indicator, and
assembly of a country's record.

Two committed files hold the facts the model never decides:

* ``public/data/frontier_tracks.json`` - the countries on track ``H``
  (home to a developer of a model at or above the threshold in Epoch AI's
  model data) or ``C`` (frontier-scale compute, or a node in the
  advanced-chip supply chain), with the basis and sources of each
  assignment. Every country not listed is on track ``G``. The maintainer
  assigns tracks from data and reviews them each quarter.
* ``public/data/frontier_international.json`` - public lists: AI summit
  texts (frontier-specific ones such as the Bletchley Declaration, broad ones
  such as the Paris statement), the measurement network's members, standing
  bilateral frontier-safety dialogues, and leading roles in joint evaluation.
  ``international_coordination`` is computed from them
  (:meth:`FrontierContext.international`), so a signatory list is never left
  to the model's memory.

:class:`FrontierContext` brings both together with EU membership
(``blocs.json``): it tells the prompt a country's track, and turns the
model's :class:`~regulation_pipeline.models.FrontierAnswer` into a
:class:`~regulation_pipeline.models.FrontierRecord` with every sub-indicator
filled (researched, computed, or ``"na"``).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from .config import Settings
from .models import (
    COMPUTED_SUBINDICATORS,
    FRONTIER_SUBINDICATORS,
    NA,
    TRACKS,
    FrontierAnswer,
    FrontierRecord,
    _check_rationale,
    applies,
    na_rationale,
)

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1

# Text keys the 5 anchor names: "Bletchley plus Seoul".
BLETCHLEY = "bletchley"
SEOUL_PREFIX = "seoul"
TEXT_KINDS = ("frontier", "broad")


class FrontierDataError(ValueError):
    """A frontier reference file is malformed."""


# -- the reference files ----------------------------------------------------------


@dataclass(frozen=True)
class TrackEntry:
    country: str
    track: str
    basis: str
    sources: tuple[str, ...]
    reviewed_on: str


@dataclass(frozen=True)
class SummitText:
    """One international text and the countries that signed or endorsed it.
    ``kind`` is ``frontier`` (about frontier or advanced AI safety) or
    ``broad`` (a general AI declaration)."""

    key: str
    title: str
    short: str
    date: str
    kind: str
    source: str
    countries: frozenset[str]


@dataclass(frozen=True)
class Dialogue:
    parties: tuple[str, ...]
    name: str
    since: str
    last_met: str
    sources: tuple[str, ...]


@dataclass(frozen=True)
class LeadingRole:
    country: str
    role: str
    since: str
    sources: tuple[str, ...]


@dataclass(frozen=True)
class InternationalLists:
    reviewed_on: str
    texts: tuple[SummitText, ...]
    network_title: str
    network: frozenset[str]
    dialogues: tuple[Dialogue, ...]
    leading_roles: tuple[LeadingRole, ...]

    def countries(self) -> set[str]:
        """Every country any list names (for the name check)."""
        names: set[str] = set(self.network)
        for text in self.texts:
            names |= text.countries
        for dialogue in self.dialogues:
            names |= set(dialogue.parties)
        names |= {role.country for role in self.leading_roles}
        return names


def load_tracks(path: Path) -> tuple[TrackEntry, ...]:
    """Read and validate ``frontier_tracks.json``. Raises
    :class:`FrontierDataError` on any shape problem."""
    data = _read(path)
    if data.get("schema_version") != SCHEMA_VERSION:
        raise FrontierDataError(f"{path.name}: schema_version must be {SCHEMA_VERSION}")
    entries = data.get("countries")
    if not isinstance(entries, list):
        raise FrontierDataError(f"{path.name}: 'countries' must be a list")
    out: list[TrackEntry] = []
    seen: set[str] = set()
    for i, entry in enumerate(entries):
        label = f"{path.name} countries[{i}]"
        if not isinstance(entry, dict):
            raise FrontierDataError(f"{label} is not an object")
        country = _text(entry, "country", label)
        if country in seen:
            raise FrontierDataError(f"{label}: duplicate country {country!r}")
        seen.add(country)
        track = entry.get("track")
        if track not in TRACKS:
            raise FrontierDataError(f"{label}: track must be one of {TRACKS}, got {track!r}")
        reviewed_on = _date(entry, "reviewed_on", label)
        out.append(TrackEntry(
            country=country, track=track, basis=_text(entry, "basis", label),
            sources=_urls(entry, "sources", label), reviewed_on=reviewed_on,
        ))
    return tuple(out)


def load_international(path: Path) -> InternationalLists:
    """Read and validate ``frontier_international.json``."""
    data = _read(path)
    name = path.name
    if data.get("schema_version") != SCHEMA_VERSION:
        raise FrontierDataError(f"{name}: schema_version must be {SCHEMA_VERSION}")
    reviewed_on = _date(data, "reviewed_on", name)

    texts: list[SummitText] = []
    keys: set[str] = set()
    for i, raw in enumerate(data.get("texts") or []):
        label = f"{name} texts[{i}]"
        if not isinstance(raw, dict):
            raise FrontierDataError(f"{label} is not an object")
        key = _text(raw, "key", label)
        if key in keys:
            raise FrontierDataError(f"{label}: duplicate key {key!r}")
        keys.add(key)
        kind = raw.get("kind")
        if kind not in TEXT_KINDS:
            raise FrontierDataError(f"{label}: kind must be one of {TEXT_KINDS}, got {kind!r}")
        texts.append(SummitText(
            key=key, title=_text(raw, "title", label), short=_text(raw, "short", label),
            date=_date(raw, "date", label), kind=kind, source=_text(raw, "source", label),
            countries=_names(raw, "countries", label),
        ))
    if not any(t.key == BLETCHLEY for t in texts):
        raise FrontierDataError(f"{name}: texts must include {BLETCHLEY!r}")

    network = data.get("network")
    if not isinstance(network, dict):
        raise FrontierDataError(f"{name}: 'network' must be an object")
    network_title = _text(network, "title", f"{name} network")
    members = _names(network, "countries", f"{name} network")

    dialogues: list[Dialogue] = []
    for i, raw in enumerate(data.get("dialogues") or []):
        label = f"{name} dialogues[{i}]"
        if not isinstance(raw, dict):
            raise FrontierDataError(f"{label} is not an object")
        parties = raw.get("parties")
        if (
            not isinstance(parties, list) or len(parties) != 2
            or not all(isinstance(p, str) and p.strip() for p in parties)
            or parties[0] == parties[1]
        ):
            raise FrontierDataError(f"{label}: parties must be two different country names")
        dialogues.append(Dialogue(
            parties=(parties[0].strip(), parties[1].strip()), name=_text(raw, "name", label),
            since=_month(raw, "since", label), last_met=_month(raw, "last_met", label),
            sources=_urls(raw, "sources", label),
        ))

    roles: list[LeadingRole] = []
    for i, raw in enumerate(data.get("leading_roles") or []):
        label = f"{name} leading_roles[{i}]"
        if not isinstance(raw, dict):
            raise FrontierDataError(f"{label} is not an object")
        role = _text(raw, "role", label)
        if len(role) > 80:
            raise FrontierDataError(f"{label}: role must be at most 80 characters (it goes in a rationale)")
        roles.append(LeadingRole(
            country=_text(raw, "country", label), role=role,
            since=_month(raw, "since", label), sources=_urls(raw, "sources", label),
        ))

    return InternationalLists(
        reviewed_on=reviewed_on, texts=tuple(texts), network_title=network_title,
        network=members, dialogues=tuple(dialogues), leading_roles=tuple(roles),
    )


def _read(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise FrontierDataError(f"cannot read {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise FrontierDataError(f"{path.name} must be a JSON object")
    return data


def _text(obj: dict, key: str, label: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        raise FrontierDataError(f"{label}: {key} must be a non-empty string")
    return value.strip()


def _date(obj: dict, key: str, label: str) -> str:
    value = obj.get(key)
    try:
        date.fromisoformat(str(value))
    except ValueError as exc:
        raise FrontierDataError(f"{label}: {key} must be YYYY-MM-DD, got {value!r}") from exc
    return str(value)


def _month(obj: dict, key: str, label: str) -> str:
    value = str(obj.get(key))
    try:
        date.fromisoformat(f"{value}-01")
    except ValueError as exc:
        raise FrontierDataError(f"{label}: {key} must be YYYY-MM, got {value!r}") from exc
    return value


def _urls(obj: dict, key: str, label: str) -> tuple[str, ...]:
    value = obj.get(key)
    if not isinstance(value, list) or not value or not all(
        isinstance(v, str) and v.strip().startswith("http") for v in value
    ):
        raise FrontierDataError(f"{label}: {key} must be a non-empty list of URLs")
    return tuple(v.strip() for v in value)


def _names(obj: dict, key: str, label: str) -> frozenset[str]:
    value = obj.get(key)
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise FrontierDataError(f"{label}: {key} must be a list of country names")
    names = [v.strip() for v in value]
    if len(set(names)) != len(names):
        raise FrontierDataError(f"{label}: {key} lists a country twice")
    return frozenset(names)


def load_eu_members(path: Path) -> frozenset[str]:
    """The EU's member states from ``blocs.json`` (empty without the file)."""
    if not path.exists():
        return frozenset()
    data = json.loads(path.read_text(encoding="utf-8"))
    members = data.get("EU") or []
    if isinstance(members, dict):  # {"members": [...]} as well as a bare list
        members = members.get("members") or []
    return frozenset(str(m) for m in members)


# -- the context the pipeline uses ------------------------------------------------


@dataclass(frozen=True)
class FrontierPrompt:
    """What the research prompt needs to ask about the lens for one
    country: its track, whether EU law counts as its national law, and the
    current published frontier text and sources (so a still-accurate URL is
    reused rather than churned)."""

    track: str
    eu_member: bool
    existing_text: str
    existing_sources: str


class FrontierTrackMismatch(ValueError):
    """An answer's frontier block is for another track than the country's."""


class FrontierContext:
    """The tracks, the public lists and EU membership, for one run."""

    def __init__(
        self,
        tracks: tuple[TrackEntry, ...],
        international: InternationalLists,
        eu_members: frozenset[str] = frozenset(),
    ):
        self._tracks = {entry.country: entry.track for entry in tracks}
        self._entries = tracks
        self._lists = international
        self._eu = eu_members

    @classmethod
    def load(cls, settings: Settings) -> FrontierContext | None:
        """Load both reference files. ``None`` (the lens is off) when the
        track file does not exist, as in a fresh test dataset; a malformed
        file raises :class:`FrontierDataError`."""
        if not settings.frontier_tracks_json.exists():
            logger.info("frontier: no track file at %s - lens off", settings.frontier_tracks_json)
            return None
        return cls(
            load_tracks(settings.frontier_tracks_json),
            load_international(settings.frontier_international_json),
            load_eu_members(settings.blocs_json),
        )

    @property
    def lists(self) -> InternationalLists:
        return self._lists

    def track_entries(self) -> tuple[TrackEntry, ...]:
        return self._entries

    def track_for(self, country: str) -> str:
        """``H`` or ``C`` from the track file; ``G`` for everyone else."""
        return self._tracks.get(country, "G")

    def eu_member(self, country: str) -> bool:
        return country in self._eu

    def prompt_for(self, country: str, existing_reg: dict | None) -> FrontierPrompt:
        existing = existing_reg or {}
        return FrontierPrompt(
            track=self.track_for(country),
            eu_member=self.eu_member(country),
            existing_text=(existing.get("Frontier Risk") or "").strip(),
            existing_sources=(existing.get("Frontier Sources") or "").strip(),
        )

    def international(self, country: str) -> tuple[int, str]:
        """``international_coordination`` for ``country`` and its rationale,
        computed from the public lists:

        * 5 - measurement-network member, signed the Bletchley Declaration and
          a Seoul text, and holds a leading role in joint evaluation;
        * 4 - network member that signed a frontier-specific text;
        * 3 - a frontier-specific signatory, a network member without one, or
          a party to a standing bilateral frontier-safety dialogue;
        * 2 - only broad AI declarations;
        * 1 - none of these (the lists are complete, so absence from them is
          a verified absence)."""
        lists = self._lists
        frontier = [t for t in lists.texts if t.kind == "frontier" and country in t.countries]
        broad = [t for t in lists.texts if t.kind == "broad" and country in t.countries]
        member = country in lists.network
        bletchley = any(t.key == BLETCHLEY for t in frontier)
        seoul = any(t.key.startswith(SEOUL_PREFIX) for t in frontier)
        partners = sorted({
            other for d in lists.dialogues if country in d.parties
            for other in d.parties if other != country
        })
        roles = [r.role for r in lists.leading_roles if r.country == country]
        signed = _join(t.short for t in frontier)
        dialogue = f"frontier-safety dialogue with {_join(partners)}" if partners else ""

        if member and bletchley and seoul and roles:
            return 5, _rationale(f"Measurement-network member; signed {signed}; {roles[0]}.")
        if member and frontier:
            return 4, _rationale(f"Measurement-network member; signed {signed}.")
        if member:
            tail = f"; {dialogue}" if dialogue else ""
            return 3, _rationale(f"Measurement-network member; signed no frontier-specific summit text{tail}.")
        if frontier:
            tail = f"; {dialogue}" if dialogue else ""
            return 3, _rationale(f"Signed {signed}{tail}; not a measurement-network member.")
        if partners:
            return 3, _rationale(
                f"Standing {dialogue}; no frontier-specific text or network membership."
            )
        if broad:
            return 2, _rationale(
                f"Only broad AI declarations ({_join(t.short for t in broad)}); no frontier-specific "
                "text or network membership."
            )
        return 1, _rationale(
            "Signed no AI summit text and is not in the measurement network or a frontier-safety "
            "dialogue (lists reviewed " + lists.reviewed_on + ")."
        )

    def assemble(self, country: str, answer: FrontierAnswer) -> FrontierRecord:
        """Fill all four sub-indicators: the researched ones from the answer,
        ``international_coordination`` from the lists, the rest ``"na"``.
        Raises :class:`FrontierTrackMismatch` when the answer's shape is for
        another track than the country's (the track file changed mid-run)."""
        track = self.track_for(country)
        if answer.track != track:
            raise FrontierTrackMismatch(
                f"{country}: frontier answer is for track {answer.track}, the country is on {track}"
            )
        researched, reasons = answer.subscores(), answer.rationales()
        subscores: dict[str, Any] = {}
        rationales: dict[str, str] = {}
        for name in FRONTIER_SUBINDICATORS:
            if not applies(name, track):
                subscores[name], rationales[name] = NA, na_rationale(track)
            elif name in COMPUTED_SUBINDICATORS:
                subscores[name], rationales[name] = self.international(country)
            else:
                subscores[name], rationales[name] = researched[name], reasons[name]
        return FrontierRecord(
            track=track,
            subscores=subscores,
            rationales=rationales,
            text=answer.text.strip(),
            sources=answer.cleaned_sources().strip(),
            eu_level=track == "H" and self.eu_member(country),
        )


def _join(items) -> str:
    """``a``, ``a and b``, ``a, b and c``."""
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _rationale(text: str) -> str:
    """A computed rationale, held to the same 200-character bound as the
    model's."""
    return _check_rationale(text)
