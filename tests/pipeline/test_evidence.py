"""Evidence layer: OECD adapter (against fixtures captured from the live
API), country matching, HTML stripping, sync orchestration, and the
grounded prompt."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import httpx
from regulation_pipeline.evidence.htmlstrip import strip_html
from regulation_pipeline.evidence.matching import CountryResolver
from regulation_pipeline.evidence.oecd import OecdGaiinAdapter
from regulation_pipeline.evidence.sync import sync_evidence
from regulation_pipeline.names import CountryNames
from regulation_pipeline.prompt import render_grounded_prompt, render_prompt

FIXTURES = Path(__file__).parent / "fixtures"
PAGE1 = json.loads((FIXTURES / "oecd_page1.json").read_text(encoding="utf-8"))
PAGE2 = json.loads((FIXTURES / "oecd_page2.json").read_text(encoding="utf-8"))
TODAY = date(2026, 7, 2)


def api_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params.get("page", "1"))
        return httpx.Response(200, json=PAGE1 if page == 1 else PAGE2)

    return httpx.MockTransport(handler)


def make_adapter() -> OecdGaiinAdapter:
    return OecdGaiinAdapter(httpx.Client(transport=api_transport()), endpoint="https://api.example/pi")


class TestOecdAdapter:
    def test_walks_all_pages_and_maps_the_live_shape(self):
        adapter = make_adapter()
        records = list(adapter.fetch_all())

        # 5 raw records across two pages, one malformed (no englishName).
        assert len(records) == 4
        assert adapter.malformed == 1

        first = records[0]
        assert first.source == "oecd"
        assert first.external_id == "2437"
        assert first.name == "Agentic AI Hub"
        assert first.country_iso3 == "DEU"
        assert first.country_name == "Germany"
        assert first.initiative_type == "AI use cases/projects in the public sector"
        assert first.source_url.startswith("https://bmds.bund.de/")
        assert first.updated_at == "2026-07-01T08:59:54.000Z"
        assert "<p>" not in (first.overview or "")     # HTML stripped
        assert first.raw["gaiinCountryId"] == 66       # full original kept

    def test_igo_records_carry_the_org_as_country_name(self):
        records = {r.external_id: r for r in make_adapter().fetch_all()}
        eu = records["900001"]
        assert eu.country_iso3 is None
        assert eu.country_name == "European Union"
        assert eu.binding == "Non-binding"


class TestHtmlStrip:
    def test_tags_entities_and_whitespace(self):
        assert strip_html("<p>The  Act&nbsp;&amp; more</p><ul><li>one</li><li>two</li></ul>") \
            == "The Act & more\none\ntwo"
        assert strip_html("") is None
        assert strip_html(None) is None
        assert strip_html("<div><br></div>") is None


class TestCountryResolver:
    def resolver(self) -> CountryResolver:
        return CountryResolver(
            {"DEU": "Germany", "FRA": "France"},
            CountryNames({"Deutschland": "Germany"}),
            known={"Germany", "France"},
        )

    def test_iso3_wins(self):
        r = make_adapter()
        record = next(rec for rec in r.fetch_all() if rec.country_iso3 == "DEU")
        assert self.resolver().resolve(record) == "Germany"

    def test_name_alias_fallback_and_never_fuzzy(self):
        from regulation_pipeline.evidence.records import InitiativeRecord

        def rec(**kw):
            return InitiativeRecord(source="oecd", external_id="1", name="X", raw={}, **kw)

        assert self.resolver().resolve(rec(country_name="Deutschland")) == "Germany"
        # "German" (typo-ish) must NOT fuzzy-match anything.
        assert self.resolver().resolve(rec(country_name="German")) is None
        assert self.resolver().resolve(rec(country_iso3="ATL", country_name="Atlantis")) is None
        assert self.resolver().resolve(rec()) is None


class FakeDb:
    def __init__(self, existing_initiatives=None):
        self.upserts: list[tuple[str, list[dict]]] = []
        self.existing = existing_initiatives or []

    def select(self, table, params=None):
        if table == "policy_initiatives":
            return self.existing
        if table == "countries":
            return [{"id": "c-de", "name": "Germany"}, {"id": "c-fr", "name": "France"}]
        if table == "sources":
            return [{"id": f"s-{i}", "url": r["url"]} for i, r in enumerate(self._rows_for("sources"))]
        return []

    def upsert(self, table, rows, *, on_conflict, batch_size=500):
        self.upserts.append((table, rows))

    def _rows_for(self, table):
        return [row for t, rows in self.upserts if t == table for row in rows]


def make_resolver() -> CountryResolver:
    return CountryResolver({"DEU": "Germany"}, CountryNames({}), known={"Germany"})


class TestSyncEvidence:
    def test_full_sync_upserts_everything_and_reports(self):
        db = FakeDb()
        report = sync_evidence(db, make_adapter(), make_resolver(), full=True)

        assert report.fetched == 4
        assert report.new == 4
        assert report.matched == 2          # both DEU records
        assert report.malformed == 1
        # EU (IGO) and Atlantis stored unlinked, labels reported.
        assert "European Union" in report.unmatched
        assert "ATL" in report.unmatched

        initiative_rows = db._rows_for("policy_initiatives")
        assert len(initiative_rows) == 4
        by_ext = {r["external_id"]: r for r in initiative_rows}
        assert by_ext["2437"]["country_id"] == "c-de"
        assert by_ext["900001"]["country_id"] is None
        assert by_ext["900001"]["country_raw"] == "European Union"

        # Matched initiatives feed the sources DB + links.
        source_urls = {r["url"] for r in db._rows_for("sources")}
        assert any("bmds.bund.de" in u for u in source_urls)
        links = db._rows_for("country_sources")
        assert links and all(link["country_id"] == "c-de" for link in links)

        # Sync state recorded.
        state = db._rows_for("sync_state")[0]
        assert state["source"] == "oecd" and state["last_total"] == 4

    def test_delta_skips_unchanged(self):
        existing = [
            # Same instant as the fixture's updatedAt for record 2437, in
            # PostgREST's returned form.
            {"external_id": "2437", "updated_at": "2026-07-01T08:59:54+00:00"},
            {"external_id": "900001", "updated_at": "2020-01-01T00:00:00+00:00"},
        ]
        db = FakeDb(existing_initiatives=existing)
        report = sync_evidence(db, make_adapter(), make_resolver(), full=False)

        assert report.unchanged == 1
        assert report.updated == 1          # 900001 moved forward
        assert report.new == 2
        ext_ids = {r["external_id"] for r in db._rows_for("policy_initiatives")}
        assert "2437" not in ext_ids        # unchanged → not re-upserted

    def test_never_deletes(self):
        db = FakeDb()
        sync_evidence(db, make_adapter(), make_resolver(), full=True)
        assert not hasattr(db, "deletes")   # FakeDb has no delete; sync must never call one


class TestGroundedPrompt:
    INITIATIVES = [
        {"name": "AI Act", "start_year": 2024, "initiative_type": "Law", "binding": "Binding",
         "status": "Active", "overview": "x" * 1000, "source_url": "https://a.gov/act"},
        {"name": "Old Strategy", "start_year": 2019, "initiative_type": "Strategy", "binding": None,
         "status": "Active", "overview": "Short.", "source_url": None},
    ]

    def test_injects_evidence_between_context_and_task(self):
        plain = render_prompt("Germany", TODAY, None)
        grounded = render_grounded_prompt("Germany", TODAY, None, self.INITIATIVES)
        assert "VERIFIED POLICY INITIATIVES for Germany" in grounded
        assert "1. AI Act (2024) — Law | Binding | Active" in grounded
        assert "Source: https://a.gov/act" in grounded
        # The rubric and output contract are untouched.
        assert grounded.endswith(plain[plain.find("Research the current state"):])
        assert '"regulation_status"' in grounded

    def test_caps_overviews_and_count_and_orders_recent_first(self):
        many = [dict(self.INITIATIVES[0], name=f"I{i}", start_year=2000 + i) for i in range(30)]
        grounded = render_grounded_prompt("X", TODAY, None, many)
        assert "(15 shown, most recent first)" in grounded
        assert "I29 (2029)" in grounded
        assert "I0 (2000)" not in grounded
        assert "x" * 401 not in grounded    # overview truncated
        assert "…" in grounded

    def test_empty_evidence_is_the_plain_prompt(self):
        assert render_grounded_prompt("X", TODAY, None, []) == render_prompt("X", TODAY, None)
