"""Country-name normalization to canonical forms."""

from __future__ import annotations

import json
from pathlib import Path


class CountryNames:
    """Maps aliases (``"Czech Republic"``) to canonical names (``"Czechia"``).

    Load once from ``country_names.json`` and reuse; unknown names pass through
    unchanged after stripping whitespace.
    """

    def __init__(self, aliases: dict[str, str]):
        self._aliases = aliases

    @classmethod
    def load(cls, path: Path) -> CountryNames:
        if not path.exists():
            return cls({})
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(data.get("aliases", {}))

    def canonical(self, name: str) -> str:
        stripped = name.strip()
        return self._aliases.get(stripped, stripped)
