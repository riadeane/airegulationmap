"""Machine-verification of public/data/country_iso.json.

The mapping was generated once (pycountry + explicit aliases) and is now a
checked-in contract: every country in scores.csv must have an entry, iso3
codes must be unique, and — the strong check — wherever a country exists in
the world-atlas TopoJSON, the mapping's ISO numeric must equal the geometry
id (world-atlas ids ARE ISO 3166-1 numeric). All offline.
"""

from __future__ import annotations

import csv
import json
import re

from regulation_pipeline.config import Settings

SETTINGS = Settings()
ISO = json.loads(SETTINGS.country_iso_json.read_text(encoding="utf-8"))["countries"]


def _scores_countries() -> list[str]:
    with SETTINGS.scores_csv.open(newline="", encoding="utf-8") as f:
        return [row["Country"] for row in csv.DictReader(f) if row.get("Country")]


def _topojson_ids() -> dict[str, str | None]:
    topo = json.loads((SETTINGS.root / "public" / "data" / "countries-110m.json").read_text(encoding="utf-8"))
    return {g["properties"]["name"]: g.get("id") for g in topo["objects"]["countries"]["geometries"]}


def test_every_scored_country_has_an_iso_entry():
    missing = [c for c in _scores_countries() if c not in ISO]
    assert missing == []


def test_iso3_codes_are_well_formed_and_unique():
    codes = [entry["iso3"] for entry in ISO.values() if entry["iso3"] is not None]
    assert len(codes) == len(set(codes))
    assert all(re.fullmatch(r"[A-Z]{3}", c) for c in codes)
    iso2 = [entry["iso2"] for entry in ISO.values() if entry["iso2"] is not None]
    assert all(re.fullmatch(r"[A-Z]{2}", c) for c in iso2)


def test_numeric_matches_topojson_geometry_ids():
    topo_ids = _topojson_ids()
    mismatches = []
    for name, entry in ISO.items():
        topo_id = topo_ids.get(name)
        if topo_id is None or entry["numeric"] is None:
            continue  # small state absent from 110m atlas, or non-ISO entity
        if str(topo_id).lstrip("0") != entry["numeric"].lstrip("0"):
            mismatches.append((name, entry["numeric"], topo_id))
    assert mismatches == []


def test_known_special_cases():
    assert ISO["Kosovo"] == {"iso3": "XKX", "iso2": "XK", "numeric": None}
    assert ISO["Taiwan"]["iso3"] == "TWN"
    assert ISO["Dem. Rep. Congo"]["iso3"] == "COD"
    assert ISO["Swaziland"]["iso3"] == "SWZ"  # dataset name predates Eswatini
