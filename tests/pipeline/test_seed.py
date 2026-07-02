"""Seed builder + SQL emission, against a 2-country fixture dataset."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from regulation_pipeline.config import REGULATION_FIELDS, SCORES_FIELDS, Settings
from regulation_pipeline.db.seed import SEED_RUN_ID, build_seed, emit_sql, write_sql_chunks
from regulation_pipeline.names import CountryNames


def _write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


@pytest.fixture
def settings(tmp_path) -> Settings:
    s = Settings(root=tmp_path)
    _write_csv(s.scores_csv, SCORES_FIELDS, [
        {
            "Country": "Testland", "Regulation Status": "4.25", "Policy Lever": "3.5",
            "Governance Type": "2.75", "Actor Involvement": "3.0", "Average Score": "3.75",
            "Enforcement Level": "3.5", "Last Updated": "2026-06-13", "Data Version": "3",
        },
        {
            "Country": "Nulland", "Regulation Status": "NA", "Policy Lever": "",
            "Governance Type": "1", "Actor Involvement": "1", "Average Score": "",
            "Enforcement Level": "1", "Last Updated": "", "Data Version": "",
        },
    ])
    _write_csv(s.regulation_csv, REGULATION_FIELDS, [
        {
            "Country": "Testland",
            "Regulation Status": "Binding law with 'quotes' inside.",
            "Policy Lever": "Strategy.", "Governance Type": "Central.",
            "Actor Involvement": "Broad.", "Enforcement Level": "Active.",
            "Specific Laws": "AI Act (2024)",
            "Sources": "https://legislation.gov.uk/x | https://example.com/blog | https://legislation.gov.uk/x",
            "Last Updated": "2026-06-13", "Confidence": "High",
        },
        {
            "Country": "Nulland", "Regulation Status": "", "Policy Lever": "",
            "Governance Type": "", "Actor Involvement": "", "Enforcement Level": "",
            "Specific Laws": "", "Sources": "https://example.com/blog", "Last Updated": "",
            "Confidence": "unverified",
        },
    ])
    s.history_json.write_text(json.dumps({"schema_version": 1, "countries": {
        "Testland": [
            {"date": "2026-01-01", "regulationStatus": 3, "policyLever": 3, "governanceType": 3,
             "actorInvolvement": 3, "enforcementLevel": 3, "averageScore": 3},
            {"date": "2026-06-13", "regulationStatus": 4.25, "policyLever": 3.5, "governanceType": 2.75,
             "actorInvolvement": 3.0, "enforcementLevel": 3.5, "averageScore": 3.75},
        ],
    }}), encoding="utf-8")
    s.subscores_json.parent.mkdir(parents=True, exist_ok=True)
    s.subscores_json.write_text(json.dumps({"schema_version": 2, "countries": {
        "Testland": {"date": "2026-06-13", "regulation_status": {"binding_force": 4}},
    }}), encoding="utf-8")
    s.country_names_json.write_text(json.dumps({"aliases": {"Republic of Testland": "Testland"}}), encoding="utf-8")
    s.country_iso_json.write_text(json.dumps({"schema_version": 1, "countries": {
        "Testland": {"iso3": "TST", "iso2": "TS", "numeric": "900"},
        # Nulland deliberately absent: entries degrade to null codes.
    }}), encoding="utf-8")
    return s


def test_build_seed_shapes(settings):
    seed = build_seed(settings, CountryNames.load(settings.country_names_json))

    assert [c["name"] for c in seed.countries] == ["Nulland", "Testland"]
    testland = next(c for c in seed.countries if c["name"] == "Testland")
    assert testland["iso3"] == "TST" and testland["aliases"] == ["Republic of Testland"]
    nulland = next(c for c in seed.countries if c["name"] == "Nulland")
    assert nulland["iso3"] is None

    scores = {s["country"]: s for s in seed.scores}
    assert scores["Testland"]["regulation_status"] == 4.25
    assert scores["Testland"]["confidence"] == "high"          # normalized
    assert scores["Testland"]["subscores"]["date"] == "2026-06-13"  # lossless passthrough
    assert scores["Nulland"]["regulation_status"] is None      # 'NA' -> null
    assert scores["Nulland"]["confidence"] is None             # junk value -> null
    assert scores["Nulland"]["data_version"] == 1

    assert len(seed.history) == 2
    assert seed.history[0]["scores"]["regulationStatus"] == 3
    assert "date" not in seed.history[0]["scores"]             # lives in snapshot_date

    # Deduped globally (first-seen wins, countries iterate sorted), linked per country.
    assert [s["url"] for s in seed.sources] == ["https://example.com/blog", "https://legislation.gov.uk/x"]
    assert {(l["country"], l["url"]) for l in seed.links} == {
        ("Testland", "https://legislation.gov.uk/x"),
        ("Testland", "https://example.com/blog"),
        ("Nulland", "https://example.com/blog"),
    }


def test_emit_sql_is_idempotent_and_escapes(settings, tmp_path):
    seed = build_seed(settings, CountryNames.load(settings.country_names_json))
    stmts = emit_sql(seed)

    joined = "\n".join(stmts)
    # Idempotency markers on every table.
    assert "on conflict (name) do update" in joined
    assert "on conflict (country_id) do update" in joined
    assert "on conflict (country_id, snapshot_date) do update" in joined
    assert "on conflict (url) do update" in joined
    assert "on conflict (id) do nothing" in joined
    # Quote escaping (prose contains 'quotes').
    assert "with ''quotes'' inside" in joined
    # FK resolution never uses client-side UUIDs for countries.
    assert "from countries where name = 'Testland'" in joined
    assert SEED_RUN_ID in joined

    # Re-emitting from the same data is byte-identical (stable ordering).
    out1 = tmp_path / "sql1"
    out2 = tmp_path / "sql2"
    write_sql_chunks(stmts, out1)
    write_sql_chunks(emit_sql(build_seed(settings, CountryNames.load(settings.country_names_json))), out2)
    files1 = sorted(p.name for p in out1.iterdir())
    files2 = sorted(p.name for p in out2.iterdir())
    assert files1 == files2
    for name in files1:
        assert (out1 / name).read_bytes() == (out2 / name).read_bytes()


def test_chunking_respects_size(settings, tmp_path):
    seed = build_seed(settings, CountryNames.load(settings.country_names_json))
    paths = write_sql_chunks(emit_sql(seed), tmp_path / "chunks", max_chars=500)
    assert len(paths) > 1
    for p in paths:
        # A single oversized statement may exceed the cap, but our fixture
        # statements are small; each chunk stays near the limit.
        assert len(p.read_text(encoding="utf-8")) < 1200
