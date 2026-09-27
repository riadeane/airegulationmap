"""SupabaseMirror + the service's mirror seam.

Two layers of assertion: (a) with a fake httpx transport, the mirror emits
the exact PostgREST request sequence (run row → scores/summaries upserts →
history replace → sources/links); (b) at the service level, mirror calls
happen in the right places and a raising mirror NEVER changes the run
outcome, the exit-code contract, or the saved files.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import httpx
from conftest import full_result
from regulation_pipeline.config import Settings
from regulation_pipeline.db.client import SupabaseClient
from regulation_pipeline.db.mirror import RunMeta, SupabaseMirror, evidence_columns
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.models import ResearchProvenance, ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "supabase" / "migrations"
TODAY = date(2026, 6, 11)
META = RunMeta(trigger="manual", model="claude-x", strategy="sync", prompt_version="v2-test")


def model():
    return ResearchResult.model_validate(full_result())


class FakePostgrest:
    """Collects requests; answers selects with configurable rows."""

    def __init__(self):
        self.requests: list[tuple[str, str, dict | list | None]] = []
        self.select_rows: dict[str, list[dict]] = {
            "countries": [{"id": "c-1", "name": "A"}],
            "sources": [
                {"id": "s-1", "url": "https://example.gov/ai"},
                {"id": "s-2", "url": "https://example.gov/law"},
            ],
        }

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            table = request.url.path.rsplit("/", 1)[-1]
            body = json.loads(request.content) if request.content else None
            self.requests.append((request.method, table, body))
            if request.method == "GET":
                return httpx.Response(200, json=self.select_rows.get(table, []))
            # Keep the fake self-consistent: an upserted country becomes
            # visible to subsequent selects (like the real thing).
            if request.method == "POST" and table == "countries":
                known = {r["name"] for r in self.select_rows["countries"]}
                for row in body:
                    if row["name"] not in known:
                        self.select_rows["countries"].append(
                            {"id": f"c-gen-{len(self.select_rows['countries'])}", "name": row["name"]}
                        )
            return httpx.Response(201, json=[])

        return httpx.MockTransport(handler)

    def of(self, method: str, table: str) -> list:
        return [b for m, t, b in self.requests if m == method and t == table]


def make_mirror(fake: FakePostgrest, usage=None) -> SupabaseMirror:
    client = SupabaseClient("https://x.supabase.co", "key", transport=fake.transport())
    return SupabaseMirror(client, META, usage_provider=usage)


HISTORY = [
    {"date": "2026-01-01", "regulationStatus": 3, "averageScore": 3},
    {"date": "2026-06-11", "regulationStatus": 4, "averageScore": 3.67},
]

# The gated scores.csv row / subscores entry the dataset holds after apply().
SCORES_ROW = {
    "Country": "A", "Regulation Status": 4.0, "Policy Lever": 3.0,
    "Governance Type": 2.0, "Actor Involvement": 3.0, "Average Score": 3.67,
    "Enforcement Level": 4.0, "Last Updated": "2026-06-11", "Data Version": 5,
}
# v2.1 shape: {score, rationale} per sub-indicator. The mirror splits it
# into the subscores and rationales columns.
SUBSCORES = {
    "date": "2026-06-11",
    "regulation_status": {"binding_force": {"score": 4, "rationale": "Fact."}},
}


class TestSupabaseMirror:
    def test_full_flush_sequence(self):
        fake = FakePostgrest()
        mirror = make_mirror(
            fake, usage=lambda: {"input": 1000, "output": 200, "searches": 11, "est_cost_usd": 0.12},
        )

        mirror.begin(attempted=2)
        mirror.record("A", model(), TODAY, scores_row=SCORES_ROW, subscores=SUBSCORES, history=HISTORY)
        mirror.finish(updated=1, failed=1, fatal=False, gate_counts={"held": 2, "unchanged": 1})

        # Run row first, with meta + attempted count.
        run_insert = fake.of("POST", "research_runs")[0][0]
        assert run_insert["trigger"] == "manual"
        assert run_insert["prompt_version"] == "v2-test"
        assert run_insert["countries_attempted"] == 2

        # Scores/summaries upserted with resolved country id + provenance.
        score_row = fake.of("POST", "country_scores")[0][0]
        assert score_row["country_id"] == "c-1"
        assert score_row["data_version"] == 5
        assert score_row["avg_score"] == 3.67
        assert score_row["subscores"]["regulation_status"]["binding_force"] == 4
        assert score_row["rationales"]["regulation_status"]["binding_force"] == "Fact."
        assert "date" not in score_row["rationales"]
        assert score_row["run_id"] == run_insert["id"]
        summary_row = fake.of("POST", "country_summaries")[0][0]
        assert summary_row["specific_laws"] == "AI Act (2024)"

        # History replaced: DELETE then INSERT with the file's snapshots.
        assert fake.of("DELETE", "score_history") == [None]
        hist_rows = fake.of("POST", "score_history")[0]
        assert [r["snapshot_date"] for r in hist_rows] == ["2026-01-01", "2026-06-11"]
        assert "date" not in hist_rows[0]["scores"]

        # Sources upserted (no first_seen - DB default must survive) + links.
        source_rows = fake.of("POST", "sources")[0]
        assert {r["url"] for r in source_rows} == {"https://example.gov/ai", "https://example.gov/law"}
        assert all("first_seen" not in r for r in source_rows)
        link_rows = fake.of("POST", "country_sources")[0]
        assert {(r["country_id"], r["source_id"]) for r in link_rows} == {("c-1", "s-1"), ("c-1", "s-2")}

        # Run finalized with counts + tokens + the gate tally in notes.
        patch = fake.of("PATCH", "research_runs")[0]
        assert patch["countries_succeeded"] == 1
        assert patch["input_tokens"] == 1000
        assert patch["est_cost_usd"] == 0.12
        assert patch["notes"] == "gate: held=2 unchanged=1; web searches: 11"

    def test_evidence_columns_mirror_the_file(self):
        # PRD 14: the entry's evidence block becomes three columns; the
        # subscores and rationales jsonb columns never carry it.
        fake = FakePostgrest()
        mirror = make_mirror(fake)
        evidence = {
            "grounded": True, "initiatives_used": 7, "search": True,
            "model": "claude-x", "run_id": mirror.run_id,
        }
        mirror.begin(attempted=1)
        mirror.record("A", model(), TODAY, scores_row=SCORES_ROW,
                      subscores={**SUBSCORES, "evidence": evidence}, history=[])
        mirror.finish(updated=1, failed=0, fatal=False)
        score_row = fake.of("POST", "country_scores")[0][0]
        assert (score_row["grounded"], score_row["initiatives_used"], score_row["web_search"]) == (True, 7, True)
        assert "evidence" not in score_row["subscores"]
        assert "evidence" not in score_row["rationales"]
        assert score_row["subscores"] == {"date": "2026-06-11", "regulation_status": {"binding_force": 4}}

    def test_search_only_record_keeps_zero_and_null_apart(self):
        fake = FakePostgrest()
        mirror = make_mirror(fake)
        mirror.begin(attempted=1)
        for used in (0, None):
            evidence = {"grounded": False, "initiatives_used": used, "search": True, "model": "m", "run_id": "r"}
            mirror.record("A", model(), TODAY, scores_row=SCORES_ROW,
                          subscores={**SUBSCORES, "evidence": evidence}, history=[])
        mirror.finish(updated=2, failed=0, fatal=False)
        rows = fake.of("POST", "country_scores")[0]
        assert [(r["grounded"], r["initiatives_used"], r["web_search"]) for r in rows] == [
            (False, 0, True), (False, None, True),
        ]

    def test_no_run_record_mirrors_nulls(self):
        fake = FakePostgrest()
        mirror = make_mirror(fake)
        mirror.begin(attempted=1)
        mirror.record("A", model(), TODAY, scores_row=SCORES_ROW, subscores=SUBSCORES, history=[])
        mirror.finish(updated=1, failed=0, fatal=False)
        score_row = fake.of("POST", "country_scores")[0][0]
        # Present and null, so the upsert clears a stale value.
        assert {k: score_row[k] for k in ("grounded", "initiatives_used", "web_search")} == {
            "grounded": None, "initiatives_used": None, "web_search": None,
        }

    def test_held_row_mirrors_the_stored_scores_not_the_result(self):
        # The gate held the result: the dataset row still carries the old
        # scores (as CSV strings) and the mirror must replay THOSE.
        fake = FakePostgrest()
        mirror = make_mirror(fake)
        held_row = {**SCORES_ROW, "Regulation Status": "2.25", "Average Score": "2.5", "Data Version": "3"}
        mirror.begin(attempted=1)
        mirror.record("A", model(), TODAY, scores_row=held_row, subscores={"date": "2026-05-01"}, history=[])
        mirror.finish(updated=1, failed=0, fatal=False)
        score_row = fake.of("POST", "country_scores")[0][0]
        assert score_row["regulation_status"] == 2.25
        assert score_row["avg_score"] == 2.5
        assert score_row["data_version"] == 3
        assert score_row["scored_at"] == "2026-05-01"
        # Text fields always apply, so the summary carries the new result.
        assert fake.of("POST", "country_summaries")[0][0]["specific_laws"] == "AI Act (2024)"

    def test_unknown_country_is_upserted_then_linked(self):
        fake = FakePostgrest()
        fake.select_rows["countries"] = []  # first lookup finds nothing

        mirror = make_mirror(fake)
        mirror.begin(attempted=1)
        mirror.record("A", model(), TODAY, scores_row=SCORES_ROW, subscores=SUBSCORES, history=[])
        mirror.finish(updated=1, failed=0, fatal=False)

        # The mirror upserted the missing country, re-resolved its id, and
        # used it for the children rows.
        country_upserts = fake.of("POST", "countries")
        assert country_upserts and country_upserts[0][0]["name"] == "A"
        score_row = fake.of("POST", "country_scores")[0][0]
        assert score_row["country_id"] == "c-gen-0"

    def test_history_replace_keeps_run_id_of_existing_snapshots(self):
        # score_history.run_id means "the run that introduced this change
        # point": an existing snapshot keeps its id even though its date may
        # have advanced; only the new snapshot gets this run's id.
        fake = FakePostgrest()
        fake.select_rows["score_history"] = [
            {"scores": {"regulationStatus": 3, "averageScore": 3}, "run_id": "run-old"},
        ]
        mirror = make_mirror(fake)
        mirror.begin(attempted=1)
        mirror.record("A", model(), TODAY, scores_row=SCORES_ROW, subscores=SUBSCORES, history=HISTORY)
        mirror.finish(updated=1, failed=0, fatal=False)

        hist_rows = fake.of("POST", "score_history")[0]
        assert [r["run_id"] for r in hist_rows] == ["run-old", mirror.run_id]
        assert mirror.run_id == fake.of("POST", "research_runs")[0][0]["id"]

    def test_finish_without_records_only_updates_run(self):
        fake = FakePostgrest()
        mirror = make_mirror(fake)
        mirror.begin(attempted=3)
        mirror.finish(updated=0, failed=3, fatal=False)
        assert fake.of("POST", "country_scores") == []
        assert len(fake.of("PATCH", "research_runs")) == 1


class ListStrategy:
    def __init__(self, answers, raise_fatal=False):
        self._answers = answers
        self._raise_fatal = raise_fatal

    def research(self, countries, reg_rows):
        yield from self._answers
        if self._raise_fatal:
            raise FatalAPIError("boom")


class ExplodingMirror:
    """Raises on every call - the run must be entirely unaffected."""

    def __init__(self):
        self.calls: list[str] = []

    def begin(self, attempted):
        self.calls.append("begin")
        raise RuntimeError("mirror down")

    def record(self, *a, **k):
        self.calls.append("record")
        raise RuntimeError("mirror down")

    def finish(self, *a, **k):
        self.calls.append("finish")
        raise RuntimeError("mirror down")


class RecordingMirror:
    def __init__(self):
        self.calls: list[tuple] = []

    def begin(self, attempted):
        self.calls.append(("begin", attempted))

    def record(self, country, result, today, *, scores_row, subscores, history):
        self.calls.append(("record", country, scores_row["Data Version"], len(history)))

    def finish(self, updated, failed, fatal, *, gate_counts=None):
        self.calls.append(("finish", updated, failed, fatal))


def _service(tmp_path, mirror=None):
    ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
    return PipelineService(ds, StalenessPolicy(90, TODAY), TODAY, mirror=mirror), ds


class SubscoresMirror(RecordingMirror):
    """Keeps the subscores entry each record() call receives."""

    def __init__(self):
        super().__init__()
        self.subscores: dict[str, dict] = {}

    def record(self, country, result, today, *, scores_row, subscores, history):
        self.subscores[country] = subscores


class TestServiceMirrorSeam:
    def test_record_receives_the_evidence_block_with_the_run_id(self, tmp_path):
        mirror = SubscoresMirror()
        ds = Dataset.load(Settings(root=tmp_path), CountryNames({}))
        svc = PipelineService(ds, StalenessPolicy(90, TODAY), TODAY, mirror=mirror, run_id="run-9")
        provenance = ResearchProvenance(initiatives_used=3, search=False, model="claude-x")
        svc.run(ListStrategy([("A", model().with_provenance(provenance))]), ["A"])
        assert mirror.subscores["A"]["evidence"] == {
            "grounded": True, "initiatives_used": 3, "search": False,
            "model": "claude-x", "run_id": "run-9",
        }

    def test_calls_in_order_with_provenance_args(self, tmp_path):
        mirror = RecordingMirror()
        svc, _ = _service(tmp_path, mirror)
        result = svc.run(ListStrategy([("A", model()), ("B", None)]), ["A", "B"])
        assert result.updated == 1
        assert mirror.calls[0] == ("begin", 2)
        # data_version bumped to 2 by apply; one history snapshot exists.
        assert mirror.calls[1] == ("record", "A", 2, 1)
        assert mirror.calls[2] == ("finish", 1, 1, False)

    def test_fatal_path_still_finishes_mirror_after_save(self, tmp_path):
        mirror = RecordingMirror()
        svc, _ = _service(tmp_path, mirror)
        result = svc.run(ListStrategy([("A", model())], raise_fatal=True), ["A"])
        assert result.fatal is True
        assert mirror.calls[-1] == ("finish", 1, 0, True)

    def test_exploding_mirror_changes_nothing(self, tmp_path):
        loud, quiet = ExplodingMirror(), None
        svc_loud, _ = _service(tmp_path / "loud", loud)
        loud_result = svc_loud.run(ListStrategy([("A", model()), ("B", None)]), ["A", "B"])

        svc_quiet, _ = _service(tmp_path / "quiet", quiet)
        quiet_result = svc_quiet.run(ListStrategy([("A", model()), ("B", None)]), ["A", "B"])

        # Same outcome (run_id/changes differ by construction: fresh id per
        # service, and the second run sees the first run's saved rows).
        assert (loud_result.updated, loud_result.failed, loud_result.fatal) == (
            quiet_result.updated, quiet_result.failed, quiet_result.fatal
        )
        assert loud.calls == ["begin", "record", "finish"]

    def test_no_mirror_is_identical_to_before(self, tmp_path):
        svc, ds = _service(tmp_path)
        result = svc.run(ListStrategy([("A", model())]), ["A"])
        assert result.updated == 1
        assert ds.scores_row("A") is not None


EVIDENCE_COLUMNS = ("grounded", "initiatives_used", "web_search")


def _public_export_columns(sql: str) -> list[str]:
    """The select list of the public_export view in a migration, in order."""
    match = re.search(
        r"create (?:or replace )?view public_export\s+with \(security_invoker = true\) as\s+"
        r"select\s+(.*?)\s+from countries c",
        sql, re.S,
    )
    assert match, "public_export view definition not found"
    return [col.strip() for col in match.group(1).split(",")]


class TestEvidenceMigration:
    """PRD 14: migration 0008, the mirror's column names and the committed
    OpenAPI snapshot must agree."""

    sql = (MIGRATIONS / "0008_evidence_coverage.sql").read_text(encoding="utf-8")

    def test_adds_the_three_nullable_columns_with_comments(self):
        assert "add column grounded boolean," in self.sql
        assert "add column initiatives_used integer" in self.sql
        assert "check (initiatives_used is null or initiatives_used >= 0)" in self.sql
        assert "add column web_search boolean;" in self.sql
        assert "not null" not in self.sql
        assert "grounded = (coalesce(initiatives_used, 0) > 0)" in self.sql
        for column in EVIDENCE_COLUMNS:
            assert f"comment on column country_scores.{column} is" in self.sql
            assert f"comment on column public_export.{column} is" in self.sql

    def test_view_keeps_the_0003_columns_and_appends_the_new_ones(self):
        # create or replace view can only append columns: the old list must be
        # an exact prefix, in order.
        before = _public_export_columns((MIGRATIONS / "0003_views.sql").read_text(encoding="utf-8"))
        after = _public_export_columns(self.sql)
        assert after == before + [f"s.{column}" for column in EVIDENCE_COLUMNS]

    def test_mirror_writes_exactly_the_migration_columns(self):
        assert tuple(evidence_columns({})) == EVIDENCE_COLUMNS

    def test_openapi_snapshot_documents_the_columns(self):
        spec = json.loads((REPO / "public" / "openapi.json").read_text(encoding="utf-8"))
        for table in ("country_scores", "public_export"):
            properties = spec["definitions"][table]["properties"]
            assert properties["grounded"]["type"] == "boolean"
            assert properties["initiatives_used"]["type"] == "integer"
            assert properties["web_search"]["type"] == "boolean"
            get_params = [p.get("$ref") for p in spec["paths"][f"/{table}"]["get"]["parameters"]]
            for column in EVIDENCE_COLUMNS:
                assert properties[column]["description"]
                assert f"rowFilter.{table}.{column}" in spec["parameters"]
                assert f"#/parameters/rowFilter.{table}.{column}" in get_params


class TestRationalesExportMigration:
    """#74: migration 0009 appends country_scores.rationales to public_export,
    and the committed OpenAPI snapshot lists it."""

    sql = (MIGRATIONS / "0009_public_export_rationales.sql").read_text(encoding="utf-8")

    def test_view_keeps_the_0008_columns_and_appends_rationales(self):
        before = _public_export_columns((MIGRATIONS / "0008_evidence_coverage.sql").read_text(encoding="utf-8"))
        assert _public_export_columns(self.sql) == before + ["s.rationales"]
        assert "comment on column public_export.rationales is" in self.sql

    def test_latest_view_definition_carries_rationales(self):
        # Whichever migration last replaces the view must keep the column.
        latest = [
            path for path in sorted(MIGRATIONS.glob("*.sql"))
            if "view public_export" in path.read_text(encoding="utf-8")
        ][-1]
        assert "s.rationales" in _public_export_columns(latest.read_text(encoding="utf-8"))

    def test_openapi_snapshot_documents_the_column(self):
        spec = json.loads((REPO / "public" / "openapi.json").read_text(encoding="utf-8"))
        properties = spec["definitions"]["public_export"]["properties"]
        assert properties["rationales"]["format"] == "jsonb"
        assert properties["rationales"]["description"]
        assert "rowFilter.public_export.rationales" in spec["parameters"]
        get_params = [p.get("$ref") for p in spec["paths"]["/public_export"]["get"]["parameters"]]
        assert "#/parameters/rowFilter.public_export.rationales" in get_params

    def test_corrected_column_comments_reach_the_snapshot(self):
        # 0004 described sources_raw as newline separated (it is pipe
        # separated) and data_version as a schema version.
        raw = (REPO / "public" / "openapi.json").read_text(encoding="utf-8")
        for wrong in ("newline separated", "oecd_gaiin", "Dataset schema version"):
            assert wrong not in raw
        assert "comment on column country_summaries.sources_raw is" in self.sql


class TestSelectAllPagination:
    def test_paginates_past_the_postgrest_row_cap(self):
        # PostgREST caps responses at ~1,000 rows regardless of limit;
        # select_all must keep paging until a short page.
        pages: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            offset = int(request.url.params["offset"])
            limit = int(request.url.params["limit"])
            pages.append({"offset": offset, "limit": limit})
            total = 2500
            n = max(0, min(limit, total - offset))
            rows = [{"id": f"r-{offset + i}"} for i in range(n)]
            return httpx.Response(200, json=rows)

        client = SupabaseClient("https://x.supabase.co", "key",
                                transport=httpx.MockTransport(handler))
        rows = client.select_all("sources", {"select": "id"})
        assert len(rows) == 2500
        assert [p["offset"] for p in pages] == [0, 1000, 2000]
        assert rows[0]["id"] == "r-0" and rows[-1]["id"] == "r-2499"
