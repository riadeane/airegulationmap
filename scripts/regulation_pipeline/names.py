"""Country name normalization."""

import json
import os

from .config import COUNTRY_NAMES_JSON


def load_alias_map():
    """Load country name alias map for normalization."""
    if not os.path.exists(COUNTRY_NAMES_JSON):
        return {}
    with open(COUNTRY_NAMES_JSON, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("aliases", {})


def canonicalize(name, aliases):
    """Normalize a country name to its canonical form."""
    return aliases.get(name.strip(), name.strip())
