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
