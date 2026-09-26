"""Country-name normalization to canonical forms."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType


class CountryNames:
    """Maps aliases (``"Czech Republic"``) to canonical names (``"Czechia"``).

    Load once from ``country_names.json`` and reuse; unknown names pass through
    unchanged after stripping whitespace. The alias table is copied into a
    read-only mapping so a caller can't accidentally mutate a shared lookup and
    corrupt every subsequent ``canonical()`` call.
    """

    def __init__(self, aliases: Mapping[str, str]):
        self._aliases: Mapping[str, str] = MappingProxyType(dict(aliases))

    @classmethod
    def load(cls, path: Path) -> CountryNames:
        if not path.exists():
            return cls({})
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(data.get("aliases", {}))

    def canonical(self, name: str) -> str:
        stripped = name.strip()
        return self._aliases.get(stripped, stripped)

    def resolve(self, name: str, known: list[str]) -> str | None:
        """Resolve a user-typed name to one of ``known`` (the dataset's
        countries): exact, then alias, then either one case-insensitively.
        ``None`` when nothing matches, so a typo can never create a new
        country."""
        stripped = name.strip()
        by_folded = {k.casefold(): k for k in known}
        for candidate in (stripped, self._aliases.get(stripped)):
            if candidate and candidate in known:
                return candidate
        folded = stripped.casefold()
        if folded in by_folded:
            return by_folded[folded]
        for alias, canonical in self._aliases.items():
            if alias.casefold() == folded and canonical in known:
                return canonical
        return None
