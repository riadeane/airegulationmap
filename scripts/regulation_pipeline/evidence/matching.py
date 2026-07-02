"""Conservative country resolution for evidence records.

ISO3 exact match first, canonical-name match second, **never fuzzy** — a
wrong link would silently ground a country's scores in another country's
laws, which is worse than no link. Unresolved records stay unlinked
(``country_id`` null) with the raw label preserved for later re-matching.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..names import CountryNames
from .records import InitiativeRecord


class CountryResolver:
    def __init__(self, iso3_to_name: dict[str, str], names: CountryNames, known: set[str]):
        self._iso3 = iso3_to_name
        self._names = names
        self._known = known

    @classmethod
    def load(cls, iso_path: Path, names: CountryNames) -> CountryResolver:
        entries = json.loads(iso_path.read_text(encoding="utf-8"))["countries"]
        iso3_to_name = {
            entry["iso3"]: country for country, entry in entries.items() if entry.get("iso3")
        }
        return cls(iso3_to_name, names, known=set(entries))

    def resolve(self, record: InitiativeRecord) -> str | None:
        """The canonical dataset country name, or None."""
        if record.country_iso3:
            name = self._iso3.get(record.country_iso3.upper())
            if name:
                return name
        if record.country_name:
            canonical = self._names.canonical(record.country_name)
            if canonical in self._known:
                return canonical
        return None
