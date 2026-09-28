"""The source link check (links.py, #92) and source titles (#143).

Every request goes through ``httpx.MockTransport``: a live page with a
title, 404 and 410, a redirect to a not-found page, a 200 not-found page,
bot blocking (403), a timeout, and the known-bad OECD pattern, which is
dropped without a request.
"""

from __future__ import annotations

from datetime import date

import httpx
from conftest import full_result
from regulation_pipeline import links
from regulation_pipeline.config import Settings
from regulation_pipeline.db.client import SupabaseClient
from regulation_pipeline.db.mirror import RunMeta, SupabaseMirror
from regulation_pipeline.links import DEAD, OK, UNKNOWN, LinkChecker, page_title, render_report
from regulation_pipeline.models import ResearchProvenance, ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy

TODAY = date(2026, 9, 28)

PAGES = {
    "https://example.gov/ai": (200, "<html><head><title>AI Act | Example Government</title></head></html>"),
    "https://example.gov/og": (
        200, '<head><meta content="Open Graph title" property="og:title"><title>Plain</title></head>',
    ),
    "https://example.gov/gone": (404, "nope"),
    "https://example.gov/removed": (410, "gone"),
    "https://example.gov/soft": (200, "<title>Page not found - Example</title>"),
    "https://example.gov/blocked": (403, "forbidden"),
    "https://example.gov/about-404-errors": (200, "<title>Why a 404 happens</title>"),
}


def transport(requested: list[str] | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if requested is not None:
            requested.append(url)
        if url == "https://example.gov/moved":
            return httpx.Response(301, headers={"location": "https://example.gov/en/page-not-found"})
        if url == "https://example.gov/en/page-not-found":
            return httpx.Response(200, text="<title>Oops</title>", headers={"content-type": "text/html"})
        if url == "https://example.gov/slow":
            raise httpx.ReadTimeout("slow", request=request)
        status, body = PAGES.get(url, (200, "<title>Other</title>"))
        return httpx.Response(status, text=body, headers={"content-type": "text/html; charset=utf-8"})

    return httpx.MockTransport(handler)


def checker(requested: list[str] | None = None) -> LinkChecker:
    client = httpx.Client(transport=transport(requested), follow_redirects=True)
    return LinkChecker(client, workers=2)


def result(sources: str, **overrides) -> ResearchResult:
    return ResearchResult.model_validate(full_result(sources=sources, **overrides))


class TestCheck:
    def test_states(self):
        statuses = checker().check([
            "https://example.gov/ai", "https://example.gov/gone", "https://example.gov/removed",
            "https://example.gov/moved", "https://example.gov/soft", "https://example.gov/blocked",
            "https://example.gov/slow", "https://example.gov/about-404-errors",
        ])
        state = {url: s.state for url, s in statuses.items()}
        assert state == {
            "https://example.gov/ai": OK,
            "https://example.gov/gone": DEAD,
            "https://example.gov/removed": DEAD,
            "https://example.gov/moved": DEAD,       # redirect to a not-found page
            "https://example.gov/soft": DEAD,        # a 200 not-found page
            "https://example.gov/blocked": UNKNOWN,  # bot blocking is not absence
            "https://example.gov/slow": UNKNOWN,
            "https://example.gov/about-404-errors": OK,  # the title only mentions 404
        }
        assert statuses["https://example.gov/ai"].title == "AI Act | Example Government"
        assert statuses["https://example.gov/gone"].reason == "HTTP 404"

    def test_the_oecd_dashboard_pattern_is_dead_without_a_request(self):
        requested: list[str] = []
        url = "https://oecd.ai/en/dashboards/countries/AntiguaAndBarbuda"
        statuses = checker(requested).check([url])
        assert statuses[url].state == DEAD
        assert requested == []

    def test_each_url_is_fetched_once(self):
        requested: list[str] = []
        c = checker(requested)
        c.check(["https://example.gov/ai", "https://example.gov/ai"])
        c.check(["https://example.gov/ai"])
        assert requested == ["https://example.gov/ai"]


def test_page_title_prefers_og_title_and_unescapes():
    assert page_title(PAGES["https://example.gov/og"][1]) == "Open Graph title"
    assert page_title("<title>\n  Loi &amp; d&eacute;cret \n</title>") == "Loi & décret"
    assert page_title("<p>no head</p>") is None


class TestFilterResult:
    def test_dead_urls_are_dropped_and_titles_attached(self):
        provenance = ResearchProvenance(initiatives_used=None, search=True, model="m")
        original = result("https://example.gov/ai | https://example.gov/gone").with_provenance(provenance)
        filtered, dead = checker().filter_result(original)
        assert filtered.sources == "https://example.gov/ai"
        assert [s.url for s in dead] == ["https://example.gov/gone"]
        assert filtered.confidence == "high"
        assert filtered.provenance is provenance
        assert filtered.source_titles == {"https://example.gov/ai": "AI Act | Example Government"}

    def test_a_result_left_with_no_source_is_capped_at_low(self):
        filtered, dead = checker().filter_result(result("https://example.gov/gone|https://example.gov/soft"))
        assert filtered.sources == ""
        assert filtered.confidence == "low"
        assert filtered.effective_confidence() == "low"
        assert len(dead) == 2

    def test_unknown_urls_are_kept(self):
        original = result("https://example.gov/blocked|https://example.gov/slow")
        filtered, dead = checker().filter_result(original)
        assert dead == []
        assert filtered.sources == original.sources


def test_report_lists_dead_urls_per_country():
    c = checker()
    by_country = {
        "Chad": ["https://oecd.ai/en/dashboards/countries/Chad"],
        "Germany": ["https://example.gov/ai", "https://example.gov/gone", "https://example.gov/blocked"],
        "France": ["https://example.gov/ai"],
    }
    statuses = c.check(url for urls in by_country.values() for url in urls)
    text = render_report(by_country, statuses)
    assert text.startswith("2 of 4 cited URLs are dead")
    assert "1 could not be checked" in text
    assert "Countries with no working source: Chad." in text
    assert "- **Germany**\n  - https://example.gov/gone (HTTP 404)" in text
    assert "France" not in text
    assert render_report({"France": ["https://example.gov/ai"]}, statuses) == ""


class FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.upserts: list[tuple[str, list[dict], str]] = []

    def select_all(self, table, params):
        return list(self.rows)

    def upsert(self, table, rows, *, on_conflict):
        self.upserts.append((table, rows, on_conflict))


def test_fill_titles_upserts_only_live_titled_pages():
    db = FakeDb([{"url": "https://example.gov/ai"}, {"url": "https://example.gov/gone"},
                 {"url": "https://example.gov/blocked"}])
    assert links.fill_titles(db, checker(), limit=10) == 1
    [(table, rows, on_conflict)] = db.upserts
    assert (table, on_conflict) == ("sources", "url")
    assert rows == [{
        "url": "https://example.gov/ai", "domain": "example.gov", "source_type": "official",
        "title": "AI Act | Example Government",
    }]


class TestPipeline:
    def _service(self, tmp_path, link_checker):
        ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
        return PipelineService(ds, StalenessPolicy(90, TODAY), TODAY, link_checker=link_checker), ds

    def test_dead_urls_never_reach_the_files(self, tmp_path):
        svc, ds = self._service(tmp_path, checker())

        class Strategy:
            def research(self, countries, reg_rows):
                yield "A", result("https://example.gov/ai|https://example.gov/gone")

        run = svc.run(Strategy(), ["A"])
        assert run.updated == 1
        assert ds.regulation_row("A")["Sources"] == "https://example.gov/ai"

    def test_a_failing_checker_keeps_the_result(self, tmp_path):
        class Broken:
            def filter_result(self, result):
                raise RuntimeError("network down")

        svc, ds = self._service(tmp_path, Broken())

        class Strategy:
            def research(self, countries, reg_rows):
                yield "A", result("https://example.gov/ai|https://example.gov/gone")

        assert svc.run(Strategy(), ["A"]).updated == 1
        assert ds.regulation_row("A")["Sources"] == "https://example.gov/ai | https://example.gov/gone"


def test_the_mirror_writes_titles_without_nulling_stored_ones():
    requests: list[tuple[str, str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        table = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, table, body))
        if request.method == "GET" and table == "countries":
            return httpx.Response(200, json=[{"id": "c-1", "name": "A"}])
        if request.method == "GET" and table == "sources":
            return httpx.Response(200, json=[
                {"id": "s-1", "url": "https://example.gov/ai"}, {"id": "s-2", "url": "https://example.gov/law"},
            ])
        return httpx.Response(200 if request.method == "GET" else 201, json=[])

    client = SupabaseClient("https://x.supabase.co", "key", transport=httpx.MockTransport(handler))
    mirror = SupabaseMirror(client, RunMeta(trigger="manual", model="m", strategy="sync", prompt_version="v"))
    titled = result("https://example.gov/ai|https://example.gov/law").with_source_titles(
        {"https://example.gov/ai": "AI Act"},
    )
    mirror.begin(attempted=1)
    mirror.record("A", titled, TODAY, scores_row={"Data Version": 1}, subscores={}, history=[])
    mirror.finish(updated=1, failed=0, fatal=False)
    source_upserts = [body for method, table, body in requests if method == "POST" and table == "sources"]
    assert source_upserts[0] == [{
        "url": "https://example.gov/ai", "domain": "example.gov", "source_type": "official",
        "last_seen": source_upserts[0][0]["last_seen"], "title": "AI Act",
    }]
    assert all("title" not in row for row in source_upserts[1])
