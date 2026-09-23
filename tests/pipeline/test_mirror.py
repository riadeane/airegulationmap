"""SupabaseMirror + the service's mirror seam.

Two layers of assertion: (a) with a fake httpx transport, the mirror emits
the exact PostgREST request sequence (run row → scores/summaries upserts →
history replace → sources/links); (b) at the service level, mirror calls
happen in the right places and a raising mirror NEVER changes the run
outcome, the exit-code contract, or the saved files.
"""

from __future__ import annotations

import json
from datetime import date

import httpx
from conftest import full_result
from regulation_pipeline.config import Settings
from regulation_pipeline.db.client import SupabaseClient
from regulation_pipeline.db.mirror import RunMeta, SupabaseMirror
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.names import CountryNames
from regulation_pipeline.repository import Dataset
from regulation_pipeline.service import PipelineService
from regulation_pipeline.staleness import StalenessPolicy

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
SUBSCORES = {"date": "2026-06-11", "regulation_status": {"binding_force": 4}}


class TestSupabaseMirror:
    def test_full_flush_sequence(self):
        fake = FakePostgrest()
        mirror = make_mirror(fake, usage=lambda: {"input": 1000, "output": 200})

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
        assert patch["notes"] == "gate: held=2 unchanged=1"

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


class TestServiceMirrorSeam:
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
