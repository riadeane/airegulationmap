"""The weekly digest: change selection, the sourced-prose contract, the
week/index/feed files, the "no changes" path, and regeneration from
Supabase score_history."""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime

import httpx
import pytest
from conftest import full_result, text_message
from regulation_pipeline import digest as digest_mod
from regulation_pipeline.config import Settings
from regulation_pipeline.db.client import SupabaseClient
from regulation_pipeline.digest import (
    DigestError,
    DigestItem,
    DigestText,
    build_index,
    changes_from_supabase,
    entry_html,
    generate,
    render_feed,
    render_prompt,
    request_params,
    select_changes,
    validate_items,
    week_of,
    write_run_digest,
)
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import CountryChange, PipelineService, RunResult
from regulation_pipeline.staleness import StalenessPolicy

TODAY = date(2026, 9, 7)
NOW = datetime(2026, 9, 7, 6, 15, tzinfo=UTC)
ATOM = "{http://www.w3.org/2005/Atom}"


def scores_row(country: str, **overrides) -> dict:
    row = {
        "Country": country, "Regulation Status": "3.0", "Policy Lever": "3.0",
        "Governance Type": "2.0", "Actor Involvement": "3.0", "Average Score": "3.0",
        "Enforcement Level": "3.0", "Last Updated": "2026-08-31", "Data Version": 3,
    }
    row.update(overrides)
    return row


def reg_row(country: str, **overrides) -> dict:
    row = {
        "Country": country, "Specific Laws": "AI Act (2024)",
        "Sources": "https://example.gov/ai|https://example.gov/law",
        "Last Updated": "2026-08-31", "Confidence": "medium",
    }
    row.update(overrides)
    return row


def change(country: str, *, old_scores=None, new_scores=None, old_reg=None, new_reg=None):
    return CountryChange(
        country=country,
        old_scores=old_scores,
        new_scores=new_scores if new_scores is not None else scores_row(country),
        old_regulation=old_reg,
        new_regulation=new_reg if new_reg is not None else reg_row(country),
    )


def unchanged(country: str) -> CountryChange:
    return change(
        country, old_scores=scores_row(country), old_reg=reg_row(country),
    )


class TestSelectChanges:
    def test_score_move_is_selected_with_only_moved_dimensions(self):
        c = change(
            "Germany",
            old_scores=scores_row("Germany"),
            new_scores=scores_row("Germany", **{"Regulation Status": 3.75}),
            old_reg=reg_row("Germany"),
        )
        [selected] = select_changes([c])
        assert selected.scores == {"regulation_status": (3.0, 3.75)}
        assert selected.laws is None
        assert selected.sources == ("https://example.gov/ai", "https://example.gov/law")
        assert selected.new_sources == ()

    def test_unchanged_country_is_skipped(self):
        assert select_changes([unchanged("France")]) == []

    def test_laws_change_is_selected_after_whitespace_normalisation(self):
        same_laws = change(
            "A", old_scores=scores_row("A"), old_reg=reg_row("A"),
            new_reg=reg_row("A", **{"Specific Laws": "AI  Act\n(2024)"}),
        )
        assert select_changes([same_laws]) == []
        new_laws = change(
            "A", old_scores=scores_row("A"), old_reg=reg_row("A"),
            new_reg=reg_row("A", **{"Specific Laws": "AI Act (2024); Digital Act (2026)"}),
        )
        [selected] = select_changes([new_laws])
        assert selected.laws == ("AI Act (2024)", "AI Act (2024); Digital Act (2026)")

    def test_confidence_rising_to_high_needs_new_sources(self):
        no_new_sources = change(
            "A", old_scores=scores_row("A"), old_reg=reg_row("A"),
            new_reg=reg_row("A", Confidence="high"),
        )
        assert select_changes([no_new_sources]) == []
        with_new_source = change(
            "A", old_scores=scores_row("A"), old_reg=reg_row("A"),
            new_reg=reg_row(
                "A", Confidence="high",
                Sources="https://example.gov/ai|https://example.gov/new",
            ),
        )
        [selected] = select_changes([with_new_source])
        assert selected.confidence == ("medium", "high")
        assert selected.new_sources == ("https://example.gov/new",)

    def test_confidence_drop_alone_is_not_selected(self):
        drop = change(
            "A", old_scores=scores_row("A"), old_reg=reg_row("A", Confidence="high"),
            new_reg=reg_row("A", Confidence="low", Sources="https://example.gov/other"),
        )
        assert select_changes([drop]) == []

    def test_new_country_counts_every_dimension(self):
        [selected] = select_changes([change("Newland")])
        assert set(selected.scores) == set(digest_mod.SCORE_COLUMNS)
        assert selected.scores["regulation_status"] == (None, 3.0)
        assert selected.confidence == (None, "medium")


class TestCalibrationBreak:
    BREAK = {"date": "2026-09-07", "model": "claude-opus-5", "prompt_version": "v3", "reason": "Model switch"}

    def test_score_only_changes_are_left_out(self):
        moved = change(
            "A", old_scores=scores_row("A"), new_scores=scores_row("A", **{"Policy Lever": 3.5}),
            old_reg=reg_row("A"),
        )
        laws = change(
            "B", old_scores=scores_row("B"), new_scores=scores_row("B", **{"Policy Lever": 3.5}),
            old_reg=reg_row("B"), new_reg=reg_row("B", **{"Specific Laws": "New Act (2026)"}),
        )
        selected = select_changes([moved, laws], calibration_break=self.BREAK)
        assert [c.country for c in selected] == ["B"]
        assert selected[0].scores == {}  # the recalibrated numbers are not reported
        assert selected[0].laws is not None

    def test_lead_opens_with_the_recalibration_sentence(self, tmp_path):
        settings = Settings(root=tmp_path)
        run = RunResult(
            updated=1, failed=[], run_id="r", calibration_break=self.BREAK,
            changes=(change("A", old_scores=scores_row("A"),
                            new_scores=scores_row("A", **{"Policy Lever": 3.5}), old_reg=reg_row("A")),),
        )
        client = FakeClient(payload([]))
        path = write_run_digest(run, client=client, settings=settings, model="m", run_date=TODAY, now=NOW)
        week = json.loads(path.read_text())
        assert week["lead"].startswith("Recalibration: Model switch. Score movements dated 2026-09-07")
        assert week["calibration_break"] == self.BREAK
        assert week["changes"] == [] and client.messages.calls == []


class TestPrompt:
    def test_prompt_lists_country_deltas_and_sources_and_rules(self):
        [selected] = select_changes([change(
            "Germany",
            old_scores=scores_row("Germany"),
            new_scores=scores_row("Germany", **{"Regulation Status": 3.75}),
            old_reg=reg_row("Germany"),
            new_reg=reg_row("Germany", Sources="https://example.gov/ai|https://example.gov/new"),
        )])
        prompt = render_prompt([selected], TODAY)
        assert "### Germany" in prompt
        assert "- regulation_status: 3 -> 3.75" in prompt
        assert "- https://example.gov/new (new this run)" in prompt
        assert "Specific Laws: unchanged" in prompt
        assert "Do not use em dashes" in prompt
        assert "British English" in prompt
        assert "Use only URLs from the country's own source list" in prompt

    def test_request_uses_structured_output_and_given_model(self):
        params = request_params(select_changes([change("A")]), TODAY, model="claude-test")
        assert params["model"] == "claude-test"
        schema = params["output_config"]["format"]["schema"]
        assert params["output_config"]["format"]["type"] == "json_schema"
        assert set(schema["required"]) == {"lead", "items"}
        item = schema["$defs"]["DigestItem"]
        assert set(item["required"]) == {"country", "headline", "summary", "sources"}
        assert item["additionalProperties"] is False


class FakeMessages:
    def __init__(self, payload):
        self.payload = payload
        self.calls: list[dict] = []

    def create(self, **params):
        self.calls.append(params)
        return text_message(json.dumps(self.payload))


class FakeClient:
    def __init__(self, payload):
        self.messages = FakeMessages(payload)


def two_country_run() -> RunResult:
    return RunResult(updated=2, failed=[], run_id="run-1", changes=(
        change(
            "Germany",
            old_scores=scores_row("Germany"),
            new_scores=scores_row("Germany", **{"Regulation Status": 3.75}),
            old_reg=reg_row("Germany"),
            new_reg=reg_row("Germany", Sources="https://example.gov/ai|https://example.gov/new"),
        ),
        change(
            "Chile",
            old_scores=scores_row("Chile"),
            new_scores=scores_row("Chile", **{"Enforcement Level": 2.5}),
            old_reg=reg_row("Chile", Sources="https://chile.gob.cl/ia"),
            new_reg=reg_row("Chile", Sources="https://chile.gob.cl/ia"),
        ),
        unchanged("France"),
    ))


def payload(items):
    return {"lead": "Two countries changed this week.", "items": items}


class TestGenerate:
    def test_every_source_url_in_the_digest_appears_in_the_input_rows(self):
        run = two_country_run()
        client = FakeClient(payload([
            {"country": "Germany", "headline": "Regulation status rose to 3.75",
             "summary": "A new source was cited.", "sources": ["https://example.gov/new"]},
            {"country": "Chile", "headline": "Enforcement fell to 2.5",
             "summary": "The enforcement score fell.",
             # One real URL, one the run never found: the whole item is rejected.
             "sources": ["https://chile.gob.cl/ia", "https://news.example.com/story"]},
            {"country": "Atlantis", "headline": "Not in the run", "summary": "x",
             "sources": ["https://example.gov/ai"]},
        ]))
        changes = select_changes(run.changes)
        text = generate(client, changes, TODAY, model="claude-test")

        input_urls = {
            url
            for c in run.changes
            for url in (c.new_regulation.get("Sources") or "").split("|")
        }
        assert [item.country for item in text.items] == ["Germany"]
        for item in text.items:
            assert item.sources
            assert set(item.sources) <= input_urls
        assert len(client.messages.calls) == 1

    def test_dashes_are_normalised(self):
        text = validate_items(
            DigestText(lead="Lead — with dash", items=[DigestItem(
                country="A", headline="Up – a bit", summary="s", sources=["https://example.gov/ai"],
            )]),
            select_changes([change("A")]),
        )
        assert "—" not in text.lead and "–" not in text.items[0].headline
        assert text.lead == "Lead - with dash"

    def test_invalid_shape_raises_digest_error(self):
        client = FakeClient({"lead": "x", "items": [{"country": "A"}]})
        with pytest.raises(DigestError):
            generate(client, select_changes([change("A")]), TODAY, model="m")


class TestWrite:
    def test_writes_week_index_and_feed(self, tmp_path):
        settings = Settings(root=tmp_path)
        run = two_country_run()
        client = FakeClient(payload([
            {"country": "Germany", "headline": "Regulation status rose to 3.75",
             "summary": "Summary <b>escaped</b>.", "sources": ["https://example.gov/new"]},
            {"country": "Chile", "headline": "Enforcement fell to 2.5",
             "summary": "Fell.", "sources": ["https://chile.gob.cl/ia"]},
        ]))
        path = write_run_digest(
            run, client=client, settings=settings, model="claude-test", run_date=TODAY, now=NOW,
        )
        assert path == settings.digest_dir / "2026-W37.json"

        week = json.loads(path.read_text())
        assert week["week"] == "2026-W37"
        assert week["run_id"] == "run-1" and week["model"] == "claude-test"
        assert [i["country"] for i in week["items"]] == ["Germany", "Chile"]
        assert [c["country"] for c in week["changes"]] == ["Germany", "Chile"]
        assert week["changes"][0]["scores"] == {"regulation_status": {"old": 3.0, "new": 3.75}}
        assert week["changes"][0]["new_sources"] == ["https://example.gov/new"]

        index = json.loads((settings.digest_dir / "index.json").read_text())
        assert index["weeks"] == [{
            "week": "2026-W37", "date": "2026-09-07", "run_id": "run-1",
            "model": "claude-test", "item_count": 2, "change_count": 2, "file": "2026-W37.json",
        }]

        feed = ET.parse(settings.digest_dir / "feed.xml").getroot()
        assert feed.tag == f"{ATOM}feed"
        assert feed.find(f"{ATOM}id").text == "https://airegulationmap.org/digest/feed.xml"
        assert feed.find(f"{ATOM}updated").text == "2026-09-07T06:15:00Z"
        [entry] = feed.findall(f"{ATOM}entry")
        assert entry.find(f"{ATOM}title").text == "Week 37, 2026: 2 countries changed"
        assert entry.find(f"{ATOM}link").get("href") == "https://airegulationmap.org/changes.html?week=2026-W37"
        content = entry.find(f"{ATOM}content")
        assert content.get("type") == "html"
        assert "Summary &lt;b&gt;escaped&lt;/b&gt;." in content.text
        assert 'href="https://airegulationmap.org/?country=Germany"' in content.text
        assert 'href="https://example.gov/new"' in content.text

    def test_index_and_feed_are_newest_first(self, tmp_path):
        settings = Settings(root=tmp_path)
        empty = RunResult(updated=0, failed=[], run_id="r")
        write_run_digest(
            empty, client=None, settings=settings, model="m",
            run_date=date(2026, 9, 14), now=datetime(2026, 9, 14, tzinfo=UTC),
        )
        write_run_digest(
            empty, client=None, settings=settings, model="m",
            run_date=date(2026, 8, 31), now=datetime(2026, 8, 31, tzinfo=UTC),
        )
        index = json.loads((settings.digest_dir / "index.json").read_text())
        assert [w["week"] for w in index["weeks"]] == ["2026-W38", "2026-W36"]
        feed = ET.parse(settings.digest_dir / "feed.xml").getroot()
        titles = [e.find(f"{ATOM}title").text for e in feed.findall(f"{ATOM}entry")]
        assert titles == ["Week 38, 2026: no changes", "Week 36, 2026: no changes"]

    def test_no_changes_writes_one_line_entry_without_an_api_call(self, tmp_path):
        settings = Settings(root=tmp_path)
        run = RunResult(updated=1, failed=[], run_id="run-2", changes=(unchanged("France"),))
        client = FakeClient(payload([]))
        path = write_run_digest(
            run, client=client, settings=settings, model="m", run_date=TODAY, now=NOW,
        )
        week = json.loads(path.read_text())
        assert week["items"] == [] and week["changes"] == []
        assert week["lead"] == "No gated score or law changes in this run."
        assert client.messages.calls == []

    def test_a_later_empty_run_keeps_the_weeks_digest(self, tmp_path):
        settings = Settings(root=tmp_path)
        items = [{"country": "Germany", "headline": "H", "summary": "S",
                  "sources": ["https://example.gov/new"]}]
        first = write_run_digest(
            two_country_run(), client=FakeClient(payload(items)), settings=settings,
            model="m", run_date=TODAY, now=NOW,
        )
        before = first.read_text()
        again = write_run_digest(
            RunResult(updated=1, failed=[], run_id="run-2", changes=(unchanged("France"),)),
            client=FakeClient(payload([])), settings=settings, model="m", run_date=TODAY, now=NOW,
        )
        assert again == first
        assert first.read_text() == before

    def test_feed_escapes_markup_in_prose(self):
        digest = {
            "week": "2026-W37", "date": "2026-09-07", "generated_at": NOW.isoformat(),
            "run_id": "r", "model": "m", "lead": "Lead & <lead>",
            "items": [{"country": "A & B", "headline": "H<1>", "summary": "S",
                       "sources": ["https://ex.gov/a?x=1&y=2"]}],
            "changes": [{"country": "A & B"}],
        }
        xml = render_feed([digest])
        root = ET.fromstring(xml)  # well-formed despite the markup
        body = root.find(f"{ATOM}entry").find(f"{ATOM}content").text
        assert body == entry_html(digest)
        assert "Lead &amp; &lt;lead&gt;" in body
        assert 'href="https://ex.gov/a?x=1&amp;y=2"' in body


def test_week_of_uses_iso_weeks():
    assert week_of(date(2026, 1, 1)) == "2026-W01"
    assert week_of(date(2027, 1, 1)) == "2026-W53"
    assert build_index([])["weeks"] == []


class TestServiceHandsOverChanges:
    def test_run_result_carries_old_and_new_rows(self, tmp_path):
        ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
        svc = PipelineService(ds, StalenessPolicy(90, TODAY), TODAY, run_id="fixed")

        class Once:
            def research(self, countries, reg_rows):
                yield "A", ResearchResult.model_validate(full_result())

        first = svc.run(Once(), ["A"])
        assert first.run_id == "fixed"
        [c] = first.changes
        assert c.old_scores is None and c.old_regulation is None
        assert c.new_scores["Regulation Status"] == 4.0
        assert c.new_regulation["Specific Laws"] == "AI Act (2024)"

        second = svc.run(Once(), ["A"])
        [c2] = second.changes
        assert c2.old_scores["Regulation Status"] == 4.0
        assert c2.rule == "unchanged"
        assert select_changes(second.changes) == []  # same answer twice: nothing to digest

    def test_held_result_shows_no_score_movement(self, tmp_path):
        # The gate holds a score move with no new evidence: the change rows
        # are read after the gate, so the digest sees only the text row.
        ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
        svc = PipelineService(ds, StalenessPolicy(90, TODAY), TODAY)

        class Answers:
            def __init__(self, raw):
                self.raw = raw

            def research(self, countries, reg_rows):
                yield "A", ResearchResult.model_validate(self.raw)

        svc.run(Answers(full_result()), ["A"])
        moved = full_result()
        moved["regulation_status"]["binding_force"]["score"] = 5  # 4.0 -> 4.25, same laws and sources
        result = svc.run(Answers(moved), ["A"])
        [c] = result.changes
        assert c.rule == "held"
        assert c.new_scores["Regulation Status"] == c.old_scores["Regulation Status"]
        assert select_changes(result.changes) == []


class FakePostgrest:
    def __init__(self, tables: dict[str, list[dict]]):
        self.tables = tables
        self.requests: list[tuple[str, str, dict]] = []

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            table = request.url.path.rsplit("/", 1)[-1]
            params = dict(request.url.params)
            self.requests.append((request.method, table, params))
            rows = self.tables.get(table, [])
            # Minimal PostgREST filter emulation: eq. and in.(...) on one column.
            for key, value in params.items():
                if key in ("select", "order", "limit", "offset"):
                    continue
                if value.startswith("eq."):
                    rows = [r for r in rows if str(r.get(key)) == value[3:]]
                elif value.startswith("in.("):
                    wanted = set(value[4:-1].split(","))
                    rows = [r for r in rows if str(r.get(key)) in wanted]
            if params.get("order", "").endswith(".desc"):
                col = params["order"].split(".")[0]
                rows = sorted(rows, key=lambda r: r[col], reverse=True)
            elif "order" in params:
                col = params["order"].split(".")[0]
                rows = sorted(rows, key=lambda r: r[col])
            return httpx.Response(200, json=rows)

        return httpx.MockTransport(handler)


class TestChangesFromSupabase:
    def test_rebuilds_old_and_new_rows_for_the_runs_snapshots(self):
        fake = FakePostgrest({
            "research_runs": [{"id": "run-9", "model": "claude-x", "started_at": "2026-09-07T06:00:00+00:00"}],
            "countries": [{"id": "c1", "name": "Germany"}, {"id": "c2", "name": "France"}],
            "score_history": [
                {"country_id": "c1", "snapshot_date": "2026-06-01", "run_id": "run-1",
                 "scores": {"regulationStatus": 3.0, "policyLever": 3.0, "governanceType": 2.0,
                            "actorInvolvement": 3.0, "enforcementLevel": 3.0, "averageScore": 3.0}},
                {"country_id": "c1", "snapshot_date": "2026-09-07", "run_id": "run-9",
                 "scores": {"regulationStatus": 3.75, "policyLever": 3.0, "governanceType": 2.0,
                            "actorInvolvement": 3.0, "enforcementLevel": 3.0, "averageScore": 3.25}},
                # France was re-confirmed by run-9 (date advanced) but its
                # snapshot keeps run-1's id, so it is not a change of run-9.
                {"country_id": "c2", "snapshot_date": "2026-09-07", "run_id": "run-1",
                 "scores": {"regulationStatus": 2.0, "averageScore": 2.0}},
            ],
            "country_summaries": [{"country_id": "c1", "specific_laws": "AI Act", "sources_raw": "https://example.gov/ai"}],
            "country_scores": [{"country_id": "c1", "confidence": "high"}],
        })
        client = SupabaseClient("https://x.supabase.co", "key", transport=fake.transport())
        changes, run = changes_from_supabase(client, "run-9")
        assert run["model"] == "claude-x"
        [c] = changes
        assert c.country == "Germany"
        assert c.old_scores["Regulation Status"] == 3.0
        assert c.new_scores["Regulation Status"] == 3.75
        assert c.new_regulation["Sources"] == "https://example.gov/ai"
        assert c.new_regulation["Confidence"] == "high"
        [selected] = select_changes(changes)
        assert selected.scores == {"regulation_status": (3.0, 3.75)}
        assert selected.laws is None  # text history is not stored; treated as unchanged

    def test_unknown_run_raises(self):
        fake = FakePostgrest({"research_runs": []})
        client = SupabaseClient("https://x.supabase.co", "key", transport=fake.transport())
        with pytest.raises(DigestError):
            changes_from_supabase(client, "nope")

    def test_run_without_snapshots_yields_no_changes(self):
        fake = FakePostgrest({"research_runs": [{"id": "r", "model": "m"}], "score_history": []})
        client = SupabaseClient("https://x.supabase.co", "key", transport=fake.transport())
        assert changes_from_supabase(client, "r") == ([], {"id": "r", "model": "m"})
