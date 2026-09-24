"""The monthly trend piece: history as a step function, the month's
movement, the three SVG charts, the sourced narrative, the trigger, the
index/feed listing, and the --monthly backfill CLI."""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime, timedelta

import pytest
from conftest import text_message
from regulation_pipeline import charts, cli
from regulation_pipeline import digest as digest_mod
from regulation_pipeline import monthly as monthly_mod
from regulation_pipeline.config import Settings
from regulation_pipeline.digest import DigestError, render_feed, write_digest
from regulation_pipeline.history import append_snapshot
from regulation_pipeline.monthly import (
    MATURITY,
    CountryMove,
    Month,
    MonthlySection,
    MonthlyText,
    Step,
    country_steps,
    dimension_movement,
    drift_summary,
    gather,
    known_run_dates,
    month_moves,
    render_prompt,
    request_params,
    top_movers,
    validate_sections,
    value_at,
    window_dates,
    write_monthly,
    write_monthly_if_due,
)
from typer.testing import CliRunner

SVG = "{http://www.w3.org/2000/svg}"
ATOM = "{http://www.w3.org/2005/Atom}"
SEPTEMBER = Month(2026, 9)
OCT_RUN = date(2026, 10, 5)
NOW = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)

# Weekly scheduled runs (Mondays) from July to the first run of October.
RUNS = [date(2026, 7, 6) + timedelta(weeks=i) for i in range(14)]
assert RUNS[-1] == OCT_RUN

BASE = {"regulationStatus": 3.0, "policyLever": 3.0, "governanceType": 2.0,
        "actorInvolvement": 3.0, "enforcementLevel": 3.0}

# country -> [(run date the change lands, dimension overrides)], cumulative.
SCHEDULE: dict[str, list[tuple[date, dict]]] = {
    "Germany": [(date(2026, 9, 7), {"regulationStatus": 3.75})],
    "France": [(date(2026, 8, 10), {"policyLever": 3.5}), (date(2026, 9, 21), {"enforcementLevel": 2.5})],
    "Japan": [(date(2026, 9, 14), {"governanceType": 3.0})],  # descriptive: maturity unchanged
    "Kenya": [],
    "Brazil": [(OCT_RUN, {"regulationStatus": 4.0})],  # October: not September's movement
    "Chile": [(date(2026, 7, 13), {"enforcementLevel": 2.0})],  # in the window, before the month
}
START_OVERRIDES = {"Kenya": {k: 1.5 for k in BASE}}


def scores_on(country: str, day: date) -> dict:
    scores = {**BASE, **START_OVERRIDES.get(country, {})}
    for when, overrides in SCHEDULE[country]:
        if when <= day:
            scores.update(overrides)
    scores["averageScore"] = round(
        (scores["regulationStatus"] + scores["policyLever"] + scores["enforcementLevel"]) / 3, 2
    )
    return scores


def replay_history(runs=RUNS, breaks=None) -> dict:
    """history.json as the pipeline writes it: every run researches every
    country, and an unchanged country only has its last snapshot's date
    advanced (history.append_snapshot)."""
    history: dict = {"schema_version": 1, "countries": {}}
    for day in runs:
        for country in SCHEDULE:
            append_snapshot(history, country, {"date": day.isoformat(), **scores_on(country, day)})
    if breaks:
        history["breaks"] = breaks
    return history


BLOCS = {
    "_comment": "test blocs",
    "EU": {"name": "European Union", "members": ["Germany", "France"]},
    "G7": {"name": "G7", "members": ["Germany", "France", "Japan"]},
    "AU": {"name": "African Union", "members": ["Kenya", "Atlantis"]},
}

DE_URL = "https://example.gov/de-ai-act"
JP_URL = "https://www.japan.go.jp/ai"
FR_URL = "https://www.cnil.fr/ai"
AUG_URL = "https://aug.example.fr/policy"
OCT_URL = "https://brazil.gov.br/ia"


def week_doc(day: date, items: list[dict]) -> dict:
    return {
        "schema_version": 1, "week": digest_mod.week_of(day), "date": day.isoformat(),
        "generated_at": datetime(day.year, day.month, day.day, 6, 30, tzinfo=UTC).isoformat(),
        "run_id": f"run-{day.isoformat()}", "model": "claude-test", "prompt_version": "digest-v1",
        "calibration_break": None, "lead": "Lead.", "items": items,
        "changes": [{"country": i["country"]} for i in items],
    }


def item(country: str, url: str, headline: str = "Score moved") -> dict:
    return {"country": country, "headline": headline, "summary": f"{country} summary.", "sources": [url]}


def seed(tmp_path, *, history=None, weeks=True, drift=True) -> Settings:
    settings = Settings(root=tmp_path)
    (tmp_path / "public" / "data").mkdir(parents=True)
    settings.history_json.write_text(json.dumps(history or replay_history()))
    settings.blocs_json.write_text(json.dumps(BLOCS))
    if drift:
        settings.drift_json.write_text(json.dumps({"schema_version": 1, "checks": [
            {"date": "2026-08-31", "within_one": 0.5},
            {"date": "2026-09-07", "within_one": 0.9},
            {"date": "2026-09-14", "within_one": 0.75},
            {"date": "2026-09-21", "within_one": 0.9},
        ]}))
    if weeks:
        for doc in (
            week_doc(date(2026, 8, 10), [item("France", AUG_URL)]),
            week_doc(date(2026, 9, 7), [item("Germany", DE_URL, "Regulation status rose to 3.75")]),
            week_doc(date(2026, 9, 14), [item("Japan", JP_URL)]),
            week_doc(date(2026, 9, 21), [item("France", FR_URL)]),
            week_doc(date(2026, 9, 28), []),
            week_doc(OCT_RUN, [item("Brazil", OCT_URL)]),
        ):
            write_digest(settings, doc)
    return settings


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


NARRATIVE = {
    "lead": "Two countries moved on the maturity index in September — Germany up, France down.",
    "sections": [
        {"heading": "Germany raises regulation status", "text": "Germany rose to 3.75.",
         "sources": [DE_URL]},
        # August's digest, not September's: rejected.
        {"heading": "France earlier", "text": "France moved in August.", "sources": [AUG_URL]},
        # Never in any digest: rejected.
        {"heading": "Press", "text": "A story.", "sources": ["https://news.example.com/story"]},
        # One good URL and one from October: the whole section is rejected.
        {"heading": "Mixed", "text": "Mixed.", "sources": [FR_URL, OCT_URL]},
        {"heading": "France and Japan", "text": "France fell – Japan's governance rose.",
         "sources": [f" {FR_URL} ", JP_URL, FR_URL]},
        {"heading": "Unsourced", "text": "No source.", "sources": []},
    ],
}


# -- acceptance: a fake three-month history ---------------------------------------


class TestThreeMonthPiece:
    @pytest.fixture
    def written(self, tmp_path):
        settings = seed(tmp_path)
        client = FakeClient(NARRATIVE)
        path = write_monthly_if_due(
            settings, client=client, model="claude-test", run_date=OCT_RUN, run_id="run-oct", now=NOW,
        )
        return settings, client, path

    def test_writes_three_charts_and_a_sourced_narrative(self, written):
        settings, client, path = written
        assert path == settings.digest_dir / "2026-09.json"
        piece = json.loads(path.read_text())
        assert piece["kind"] == "monthly" and piece["month"] == "2026-09"
        assert piece["date"] == "2026-10-05" and piece["run_id"] == "run-oct"
        assert piece["period"] == {"start": "2026-09-01", "end": "2026-09-30"}
        assert piece["window"] == {"start": "2026-07-01", "end": "2026-09-30", "weeks": 13}
        assert piece["weeks"] == ["2026-W37", "2026-W38", "2026-W39", "2026-W40"]
        assert len(client.messages.calls) == 1

        assert [c["id"] for c in piece["charts"]] == ["bloc-maturity", "dimension-movement", "top-movers"]
        for chart in piece["charts"]:
            root = ET.fromstring(chart["svg"])
            assert root.tag == f"{SVG}svg"
            assert root.get("fill") == "currentColor"
            assert root.find(f"{SVG}title").text == chart["title"]
            assert "style=" not in chart["svg"] and "<script" not in chart["svg"]
            assert chart["table"]["rows"] and chart["caption"]

        digest_urls = {DE_URL, JP_URL, FR_URL}  # September's digest items
        assert [s["heading"] for s in piece["sections"]] == ["Germany raises regulation status", "France and Japan"]
        for section in piece["sections"]:
            assert section["sources"] and set(section["sources"]) <= digest_urls
        assert piece["sections"][1]["sources"] == [FR_URL, JP_URL]  # trimmed, de-duplicated
        assert "—" not in piece["lead"] and "–" not in piece["sections"][1]["text"]

    def test_prompt_carries_only_the_months_items_and_the_chart_data(self, written):
        _, client, _ = written
        prompt = client.messages.calls[0]["messages"][0]["content"]
        for url in (DE_URL, JP_URL, FR_URL):
            assert url in prompt
        assert AUG_URL not in prompt and OCT_URL not in prompt
        assert "Month: September 2026 (2026-09-01 to 2026-09-30)" in prompt
        assert "- European Union (2): " in prompt
        assert "- Germany: 3.00 -> 3.25 (+0.25)" in prompt
        assert "### Week 37, 2026 (run 2026-09-07)" in prompt
        assert "British English" in prompt and "Do not use em dashes" in prompt
        schema = client.messages.calls[0]["output_config"]["format"]["schema"]
        assert set(schema["required"]) == {"lead", "sections"}

    def test_chart_data_is_septembers_movement(self, written):
        _, _, path = written
        charts_by_id = {c["id"]: c for c in json.loads(path.read_text())["charts"]}
        movers = charts_by_id["top-movers"]["data"]["rows"]
        # Germany rose on 7 Sep and was re-confirmed to 5 Oct; France fell on
        # 21 Sep. Japan moved only on a descriptive scale; Brazil in October.
        assert [(r["country"], r["change"]) for r in movers] == [("Germany", 0.25), ("France", -0.17)]
        assert movers[0]["start"] == 3.0 and movers[0]["end"] == 3.25
        movement = {r["key"]: r for r in charts_by_id["dimension-movement"]["data"]["rows"]}
        assert movement["regulationStatus"] == {
            "key": "regulationStatus", "label": "Regulation Status", "rise": 0.75, "fall": 0.0,
            "net": 0.75, "up": 1, "down": 0,
        }
        assert movement["enforcementLevel"]["fall"] == -0.5
        assert movement["governanceType"]["rise"] == 1.0
        assert movement["policyLever"]["up"] == 0  # France's lever moved in August

        blocs = {s["key"]: s for s in charts_by_id["bloc-maturity"]["data"]["series"]}
        assert blocs["AU"]["scored"] == 1 and blocs["AU"]["members"] == 2
        eu = blocs["EU"]["values"]
        assert len(eu) == 14
        assert eu[0] == 3.0  # 1 July: both members at their starting scores
        assert eu[7] == round((3.0 + 3.17) / 2, 3)  # 19 Aug: France's lever rose on 10 Aug
        assert eu[-1] == round((3.25 + 3.0) / 2, 3)

    def test_drift_sentence(self, written):
        _, _, path = written
        drift = json.loads(path.read_text())["drift"]
        assert drift["text"] == (
            "The gold-set drift check ran 3 times in September 2026: between 75% and 90% of "
            "sub-indicators were within one point of the hand-checked scores, and one run fell "
            "below the 80% warning threshold."
        )
        assert drift["href"] == "/data/drift.json" and drift["label"] == "Drift record"

    def test_index_and_feed_list_the_piece(self, written):
        settings, _, _ = written
        index = json.loads((settings.digest_dir / "index.json").read_text())
        assert index["months"] == [{
            "kind": "monthly", "month": "2026-09", "date": "2026-10-05", "run_id": "run-oct",
            "model": "claude-test", "section_count": 2, "chart_count": 3, "file": "2026-09.json",
        }]
        assert all(w["kind"] == "weekly" for w in index["weeks"])

        feed = ET.parse(settings.digest_dir / "feed.xml").getroot()
        entries = feed.findall(f"{ATOM}entry")
        # Same publication date as week 41: the monthly piece comes first.
        assert entries[0].find(f"{ATOM}title").text == "Trends, September 2026"
        assert entries[1].find(f"{ATOM}title").text.startswith("Week 41, 2026")
        assert entries[0].find(f"{ATOM}link").get("href") == "https://airegulationmap.org/changes.html?month=2026-09"
        content = entries[0].find(f"{ATOM}content").text
        assert f'href="{DE_URL}"' in content
        assert "<svg" not in content
        assert 'href="https://airegulationmap.org/data/drift.json"' in content
        assert "Charts on the site:" in content

    def test_second_run_of_the_month_does_nothing(self, written):
        settings, client, _ = written
        again = write_monthly_if_due(settings, client=client, model="m", run_date=date(2026, 10, 12))
        assert again is None and len(client.messages.calls) == 1


class TestTrigger:
    def test_month_without_weekly_digests_is_skipped(self, tmp_path):
        settings = seed(tmp_path, weeks=False)
        client = FakeClient(NARRATIVE)
        assert write_monthly_if_due(settings, client=client, model="m", run_date=OCT_RUN) is None
        assert not (settings.digest_dir / "2026-09.json").exists()
        assert client.messages.calls == []

    def test_a_later_run_retries_a_missing_piece(self, tmp_path):
        settings = seed(tmp_path)
        path = write_monthly_if_due(
            settings, client=FakeClient(NARRATIVE), model="m", run_date=date(2026, 10, 19), now=NOW,
        )
        assert path is not None and path.name == "2026-09.json"

    def test_quiet_month_needs_no_request(self, tmp_path):
        steady = {"schema_version": 1, "countries": {
            "Kenya": [{"date": "2026-09-28", **scores_on("Kenya", OCT_RUN)}],
        }}
        settings = seed(tmp_path, history=steady, weeks=False, drift=False)
        write_digest(settings, week_doc(date(2026, 9, 7), []))
        client = FakeClient(NARRATIVE)
        path = write_monthly_if_due(settings, client=client, model="m", run_date=OCT_RUN, now=NOW)
        piece = json.loads(path.read_text())
        assert client.messages.calls == []
        assert piece["lead"] == (
            "No country's scores moved in September 2026, and the weekly digests carry no sourced changes."
        )
        assert piece["sections"] == [] and piece["drift"] is None
        assert len(piece["charts"]) == 3
        assert "No country's maturity index moved in September 2026." in piece["charts"][2]["svg"]

    def test_client_required_when_there_is_something_to_write(self, tmp_path):
        settings = seed(tmp_path)
        with pytest.raises(DigestError):
            write_monthly(settings, SEPTEMBER, client=None, model="m", run_date=OCT_RUN)

    def test_invalid_response_raises(self, tmp_path):
        settings = seed(tmp_path)
        with pytest.raises(DigestError):
            write_monthly(settings, SEPTEMBER, client=FakeClient({"lead": "x"}), model="m", run_date=OCT_RUN)


# -- history as a step function ------------------------------------------------------


class TestSteps:
    def test_a_change_takes_effect_on_the_first_run_after_the_last_confirmation(self):
        history = replay_history()
        germany = history["countries"]["Germany"]
        # The pipeline advanced the new snapshot's date to the latest run.
        assert [s["date"] for s in germany] == ["2026-08-31", "2026-10-05"]
        runs = known_run_dates(history, [])
        steps = country_steps(germany, runs)
        assert [s.since for s in steps] == [None, date(2026, 9, 7)]
        assert value_at(steps, date(2026, 9, 6), "regulationStatus") == 3.0
        assert value_at(steps, date(2026, 9, 30), "regulationStatus") == 3.75
        # The naive reading (latest snapshot on or before the day) would still
        # say 3.0 at the end of September.
        naive = [s for s in germany if s["date"] <= "2026-09-30"][-1]
        assert naive["regulationStatus"] == 3.0

    def test_a_change_in_the_next_months_first_run_stays_there(self):
        history = replay_history()
        steps = country_steps(history["countries"]["Brazil"], known_run_dates(history, []))
        assert steps[-1].since == OCT_RUN
        assert value_at(steps, date(2026, 9, 30), "regulationStatus") == 3.0

    def test_first_snapshot_is_carried_back(self):
        steps = country_steps([{"date": "2026-09-28", **BASE, "averageScore": 3.0}], [date(2026, 9, 28)])
        assert value_at(steps, date(2026, 1, 1), MATURITY) == 3.0
        assert value_at([], date(2026, 1, 1), MATURITY) is None

    def test_known_run_dates_merge_every_source(self):
        history = {"countries": {"A": [{"date": "2026-09-07"}]}, "breaks": [{"date": "2026-09-14"}]}
        runs = known_run_dates(history, [{"date": "2026-09-21"}], [{"date": "2026-09-28"}, {"date": "bad"}])
        assert runs == [date(2026, 9, 7), date(2026, 9, 14), date(2026, 9, 21), date(2026, 9, 28)]

    def test_gaps_and_bad_values(self):
        steps = country_steps(
            [{"date": "2026-09-07", "averageScore": "NA"}, {"date": "nope"}, {"date": "2026-09-14", "averageScore": 2}],
            [date(2026, 9, 7), date(2026, 9, 14)],
        )
        assert len(steps) == 2
        assert steps[0].scores[MATURITY] is None and steps[1].scores[MATURITY] == 2.0


class TestMovement:
    def test_changes_on_a_calibration_break_are_left_out(self):
        steps = {"A": [
            Step(None, {MATURITY: 2.0, "regulationStatus": 2.0}),
            Step(date(2026, 9, 14), {MATURITY: 3.0, "regulationStatus": 3.0}),  # the break
            Step(date(2026, 9, 21), {MATURITY: 3.25, "regulationStatus": 3.75}),
        ]}
        [move] = month_moves(steps, SEPTEMBER, [date(2026, 9, 14)])
        assert move.deltas == {MATURITY: 0.25, "regulationStatus": 0.75}
        assert move.start[MATURITY] == 2.0 and move.end[MATURITY] == 3.25
        assert month_moves(steps, Month(2026, 8), []) == []

    def test_top_movers_rank_by_size_then_breadth_then_name(self):
        moves = [
            CountryMove(f"C{i:02d}", {MATURITY: (-1) ** i * 0.05 * (i % 6 + 1), "policyLever": 0.25 * (i % 3)}, {}, {})
            for i in range(14)
        ] + [CountryMove("Only descriptive", {"governanceType": 1.0}, {}, {})]
        ranked = top_movers(moves)
        assert len(ranked) == 10
        sizes = [abs(m.deltas[MATURITY]) for m in ranked]
        assert sizes == sorted(sizes, reverse=True)
        assert "Only descriptive" not in [m.country for m in ranked]
        tied = [m for m in ranked if abs(m.deltas[MATURITY]) == sizes[0]]
        breadth = [abs(m.deltas["policyLever"]) for m in tied]
        assert breadth == sorted(breadth, reverse=True)

    def test_dimension_movement_sums_rises_and_falls(self):
        rows = dimension_movement([
            CountryMove("A", {"policyLever": 0.5}, {}, {}),
            CountryMove("B", {"policyLever": -0.25}, {}, {}),
            CountryMove("C", {"policyLever": 0.25}, {}, {}),
        ])
        lever = next(r for r in rows if r.key == "policyLever")
        assert (lever.rise, lever.fall, lever.net, lever.up, lever.down) == (0.75, -0.25, 0.5, 2, 1)
        assert [r.key for r in rows] == list(monthly_mod.DIMENSION_KEYS)

    def test_window_is_thirteen_weeks_to_the_month_end(self):
        dates = window_dates(Month(2026, 2))
        assert len(dates) == 14
        assert dates[-1] == date(2026, 2, 28) and dates[0] == date(2026, 2, 28) - timedelta(weeks=13)


class TestMonth:
    def test_parse_and_arithmetic(self):
        assert Month.parse("2026-09") == SEPTEMBER
        assert Month(2026, 1).previous() == Month(2025, 12)
        assert Month(2025, 12).next() == Month(2026, 1)
        assert Month(2028, 2).last_day == date(2028, 2, 29)
        assert date(2026, 9, 30) in SEPTEMBER and date(2026, 10, 1) not in SEPTEMBER
        assert None not in SEPTEMBER
        assert SEPTEMBER.label == "September 2026" and SEPTEMBER.key == "2026-09"

    @pytest.mark.parametrize("text", ["2026-13", "2026-9", "26-09", "2026-09-01", ""])
    def test_bad_months(self, text):
        with pytest.raises(ValueError):
            Month.parse(text)


class TestDrift:
    def test_no_checks_in_the_month(self):
        assert drift_summary([{"date": "2026-08-31", "within_one": 0.9}], SEPTEMBER, href="h", label="l") is None

    def test_one_run(self):
        drift = drift_summary([{"date": "2026-09-07", "within_one": 0.923}], SEPTEMBER, href="h", label="l")
        assert drift["text"] == (
            "The gold-set drift check ran once in September 2026: 92% of sub-indicators were within "
            "one point of the hand-checked scores."
        )

    def test_one_low_run(self):
        drift = drift_summary([{"date": "2026-09-07", "within_one": 0.7}], SEPTEMBER, href="h", label="l")
        assert drift["text"].endswith(", and the run fell below the 80% warning threshold.")

    def test_equal_runs(self):
        checks = [{"date": "2026-09-07", "within_one": 0.9}, {"date": "2026-09-14", "within_one": 0.9}]
        drift = drift_summary(checks, SEPTEMBER, href="h", label="l")
        assert "ran twice in September 2026: in each run 90% of" in drift["text"]

    def test_dashboard_link_once_it_exists(self, tmp_path):
        settings = Settings(root=tmp_path)
        assert monthly_mod.drift_link(settings) == ("/data/drift.json", "Drift record")
        (tmp_path / "drift.html").write_text("")
        assert monthly_mod.drift_link(settings) == ("/drift.html", "Drift dashboard")


class TestNarrative:
    def test_sections_citing_outside_urls_are_rejected(self):
        text = validate_sections(
            MonthlyText(lead="Lead — dash", sections=[
                MonthlySection(heading="Ok", text="Fine.", sources=["https://a.gov"]),
                MonthlySection(heading="Bad", text="x", sources=["https://a.gov", "https://b.gov"]),
                MonthlySection(heading="  ", text="Empty heading.", sources=["https://a.gov"]),
            ]),
            ["https://a.gov"],
        )
        assert [s.heading for s in text.sections] == ["Ok"]
        assert text.lead == "Lead - dash"

    def test_request_uses_structured_output(self, tmp_path):
        inputs = gather(seed(tmp_path), SEPTEMBER)
        params = request_params(inputs, model="claude-test")
        assert params["model"] == "claude-test"
        schema = params["output_config"]["format"]["schema"]
        section = schema["$defs"]["MonthlySection"]
        assert set(section["required"]) == {"heading", "text", "sources"}
        assert section["additionalProperties"] is False

    def test_prompt_names_calibration_breaks(self, tmp_path):
        breaks = [{"date": "2026-09-14", "model": "m", "prompt_version": "v", "reason": "Model switch"}]
        settings = seed(tmp_path, history=replay_history(breaks=breaks))
        inputs = gather(settings, SEPTEMBER)
        assert inputs.breaks == breaks and inputs.month_breaks == breaks
        prompt = render_prompt(inputs)
        assert "recalibrated its scores on 2026-09-14 (Model switch)" in prompt
        # Japan's governance change landed on the break: not movement.
        governance = next(m for m in inputs.movement if m.key == "governanceType")
        assert governance.up == 0
        charts_by_id = {c.id: c for c in monthly_mod.build_charts(inputs)}
        assert "Recalibration" in charts_by_id["bloc-maturity"].svg
        assert "left out" in charts_by_id["dimension-movement"].caption
        assert "now 3.25" in charts_by_id["top-movers"].svg


# -- the listing -----------------------------------------------------------------------


def test_load_months_ignores_other_json(tmp_path):
    settings = seed(tmp_path)
    (settings.digest_dir / "2026-08.json").write_text(json.dumps({"month": "2026-08"}))
    (settings.digest_dir / "2026-07.json").write_text("not json")
    assert digest_mod.load_months(settings.digest_dir) == []


def test_feed_orders_by_publication_date():
    week = {"kind": None, "week": "2026-W41", "date": "2026-10-05", "generated_at": "2026-10-05T06:00:00+00:00",
            "run_id": "r", "model": "m", "lead": "L", "items": [], "changes": []}
    old_week = {**week, "week": "2026-W40", "date": "2026-09-28", "generated_at": "2026-09-28T06:00:00+00:00"}
    piece = {"kind": "monthly", "month": "2026-09", "date": "2026-10-05", "generated_at": "2026-10-05T06:05:00+00:00",
             "model": "m", "lead": "Lead & more", "sections": [], "charts": [], "drift": None}
    root = ET.fromstring(render_feed([week, old_week], [piece]))
    titles = [e.find(f"{ATOM}title").text for e in root.findall(f"{ATOM}entry")]
    assert titles == ["Trends, September 2026", "Week 41, 2026: no changes", "Week 40, 2026: no changes"]
    assert root.find(f"{ATOM}updated").text == "2026-10-05T06:05:00Z"


# -- charts ----------------------------------------------------------------------------


class TestCharts:
    def test_oklch_conversion(self):
        assert charts.oklch_to_hex(1, 0, 0) == "#ffffff"
        assert charts.oklch_to_hex(0, 0, 0) == "#000000"
        assert charts.oklch_to_hex(0.628, 0.2577, 29.23) == "#ff0000"
        # Out of gamut: chroma is reduced, lightness and hue kept.
        assert charts.oklch_to_hex(0.9, 0.4, 250).startswith("#")

    def test_ramp_runs_between_the_legend_endpoints(self):
        steps = charts.ramp(8)
        assert steps[0] == charts.FALL and steps[-1] == charts.RISE
        assert len(set(steps)) == 8
        assert charts.ramp(0) == [] and charts.ramp(1) == [charts.RISE]

    def test_bloc_colours_follow_the_bloc(self):
        colours = monthly_mod.bloc_colours(["EU", "G7", "NEW"])
        assert colours == monthly_mod.bloc_colours(["G7", "NEW", "EU"])
        assert colours["EU"] == charts.ramp(8)[monthly_mod.BLOC_SLOTS["EU"]]
        assert colours["NEW"] == charts.NEUTRAL
        every = monthly_mod.bloc_colours(list(monthly_mod.BLOC_SLOTS))
        assert sorted(every.values()) == sorted(charts.ramp(8))  # one step each

    def test_formatting(self):
        assert charts.signed(0.25) == "+0.25"
        assert charts.signed(-0.5) == "−0.50"
        assert charts.signed(-0.0001) == "0.00"
        assert charts.fixed(None) == "none"
        assert charts.short_date(date(2026, 7, 1)) == "1 Jul"
        assert charts.long_date(date(2026, 9, 30)) == "30 September 2026"

    def test_dodge_keeps_labels_apart_and_near_their_lines(self):
        targets = [100.0, 101.0, 102.0, 200.0]
        placed = charts.dodge(targets, gap=15, lo=0, hi=300)
        ordered = sorted(placed)
        assert all(b - a >= 15 - 1e-9 for a, b in zip(ordered, ordered[1:], strict=False))
        assert placed[3] == 200.0  # far from the pile-up: untouched
        assert abs(sum(placed[:3]) / 3 - 101.0) < 1e-9  # the pile-up centres on its targets
        assert [placed.index(p) for p in sorted(placed)] == [0, 1, 2, 3]  # order kept
        assert charts.dodge([5.0, 6.0], gap=15, lo=0, hi=300)[0] >= 0  # pushed inside the top

    def test_line_chart_escapes_text_and_marks_breaks(self):
        dates = window_dates(SEPTEMBER)
        svg = charts.line_chart_svg(
            dates,
            [charts.Series("A & <B>", tuple([2.0] * 7 + [None] + [2.5] * 6), "#123456", "2.50 +0.50", "h & h")],
            ids=charts.ChartIds("t", "d"), title="T & t", desc="D",
            markers=[(date(2026, 9, 14), "Recalibration", "Model <switch>")],
        )
        root = ET.fromstring(svg)
        texts = "".join(root.itertext())
        assert "A & <B>" in texts and "Recalibration" in texts and "Model <switch>" in texts
        paths = [p.get("d") for p in root.iter(f"{SVG}path") if p.get("stroke") == "#123456"]
        assert paths[0].count("M") == 2  # the gap lifts the pen

    def test_empty_charts_render_a_message(self):
        ids = charts.ChartIds("t", "d")
        svg = charts.line_chart_svg(window_dates(SEPTEMBER), [], ids=ids, title="T", desc="D", empty="Nothing.")
        assert "Nothing." in svg
        assert "Nothing moved." in charts.bar_chart_svg([], ids=ids, title="T", desc="D")

    def test_bar_chart_draws_rises_and_falls_from_one_baseline(self):
        svg = charts.bar_chart_svg([
            charts.BarRow("Up", 0.5, 0.0, "+0.50", "", "note", "hover"),
            charts.BarRow("Down", 0.0, -0.25, "", "−0.25", "note", "hover"),
        ], ids=charts.ChartIds("t", "d"), title="T", desc="D")
        root = ET.fromstring(svg)
        fills = [p.get("fill") for p in root.iter(f"{SVG}path")]
        assert fills == [charts.RISE, charts.FALL]
        texts = "".join(root.itertext())
        assert "+0.50" in texts and "−0.25" in texts and "Rises" in texts and "Falls" in texts


# -- CLIs ------------------------------------------------------------------------------


runner = CliRunner()


class _October(date):
    """date.today() pinned to the first run of October 2026."""

    @classmethod
    def today(cls):
        return cls(2026, 10, 5)


def _digest_app():
    import typer

    app = typer.Typer()
    app.command()(digest_mod._regenerate)
    return app


class TestBackfillCli:
    @pytest.mark.parametrize("args", [[], ["--run", "r", "--monthly", "2026-09"], ["--monthly", "2026-9"]])
    def test_argument_errors_exit_1(self, args, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
        assert runner.invoke(_digest_app(), args).exit_code == 1

    def test_unfinished_month_exits_1(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
        monkeypatch.setattr(digest_mod, "date", _October)
        assert runner.invoke(_digest_app(), ["--monthly", "2026-10"]).exit_code == 1

    def test_missing_api_key_exits_1(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        assert runner.invoke(_digest_app(), ["--monthly", "2026-09"]).exit_code == 1

    def test_regenerates_from_the_files_on_disk(self, monkeypatch, tmp_path):
        settings = seed(tmp_path)
        client = FakeClient(NARRATIVE)
        monkeypatch.setattr(digest_mod, "date", _October)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
        monkeypatch.setattr(digest_mod, "Settings", lambda: settings)
        monkeypatch.setattr(digest_mod.anthropic, "Anthropic", lambda **kw: client)
        result = runner.invoke(_digest_app(), ["--monthly", "2026-09", "--model", "claude-x"])
        assert result.exit_code == 0, result.output
        piece = json.loads((settings.digest_dir / "2026-09.json").read_text())
        assert piece["model"] == "claude-x" and piece["run_id"] is None
        assert piece["date"] == "2026-10-05"
        assert client.messages.calls[0]["model"] == "claude-x"

    def test_generation_failure_exits_2(self, monkeypatch, tmp_path):
        settings = seed(tmp_path)
        monkeypatch.setattr(digest_mod, "date", _October)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
        monkeypatch.setattr(digest_mod, "Settings", lambda: settings)
        monkeypatch.setattr(digest_mod.anthropic, "Anthropic", lambda **kw: FakeClient({"bad": 1}))
        assert runner.invoke(_digest_app(), ["--monthly", "2026-09"]).exit_code == 2


class TestScheduledTrigger:
    def test_only_scheduled_runs_write_the_monthly_piece(self, monkeypatch, tmp_path):
        calls = []
        monkeypatch.setattr(cli, "write_run_digest", lambda *a, **k: None)
        monkeypatch.setattr(cli, "write_monthly_if_due", lambda *a, **k: calls.append(k["run_date"]))
        result = digest_mod.RunResult(updated=0, failed=[], run_id="r")
        monkeypatch.delenv("GITHUB_EVENT_NAME", raising=False)
        cli._write_digest(result, None, Settings(root=tmp_path), "m", OCT_RUN)
        assert calls == []
        monkeypatch.setenv("GITHUB_EVENT_NAME", "schedule")
        cli._write_digest(result, None, Settings(root=tmp_path), "m", OCT_RUN)
        assert calls == [OCT_RUN]

    def test_monthly_failure_is_a_warning(self, monkeypatch, tmp_path):
        monkeypatch.setenv("GITHUB_EVENT_NAME", "schedule")
        monkeypatch.setattr(cli, "write_run_digest", lambda *a, **k: None)

        def explode(*a, **k):
            raise RuntimeError("monthly down")

        monkeypatch.setattr(cli, "write_monthly_if_due", explode)
        cli._write_digest(digest_mod.RunResult(updated=0, failed=[]), None, Settings(root=tmp_path), "m", OCT_RUN)
