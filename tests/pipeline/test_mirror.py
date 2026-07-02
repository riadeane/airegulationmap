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


class TestSupabaseMirror:
    def test_full_flush_sequence(self):
        fake = FakePostgrest()
        mirror = make_mirror(fake, usage=lambda: {"input": 1000, "output": 200})

        mirror.begin(attempted=2)
        mirror.record("A", model(), TODAY, data_version=5, history=HISTORY)
        mirror.finish(updated=1, failed=1, fatal=False)

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

        # Sources upserted (no first_seen — DB default must survive) + links.
        source_rows = fake.of("POST", "sources")[0]
        assert {r["url"] for r in source_rows} == {"https://example.gov/ai", "https://example.gov/law"}
        assert all("first_seen" not in r for r in source_rows)
        link_rows = fake.of("POST", "country_sources")[0]
        assert {(r["country_id"], r["source_id"]) for r in link_rows} == {("c-1", "s-1"), ("c-1", "s-2")}

        # Run finalized with counts + tokens.
        patch = fake.of("PATCH", "research_runs")[0]
        assert patch["countries_succeeded"] == 1
        assert patch["input_tokens"] == 1000

    def test_unknown_country_is_upserted_then_linked(self):
        fake = FakePostgrest()
        fake.select_rows["countries"] = []  # first lookup finds nothing

        mirror = make_mirror(fake)
        mirror.begin(attempted=1)
        mirror.record("A", model(), TODAY, data_version=1, history=[])
        mirror.finish(updated=1, failed=0, fatal=False)

        # The mirror upserted the missing country, re-resolved its id, and
        # used it for the children rows.
        country_upserts = fake.of("POST", "countries")
        assert country_upserts and country_upserts[0][0]["name"] == "A"
        score_row = fake.of("POST", "country_scores")[0][0]
        assert score_row["country_id"] == "c-gen-0"

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
    """Raises on every call — the run must be entirely unaffected."""

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

    def record(self, country, result, today, *, data_version, history):
        self.calls.append(("record", country, data_version, len(history)))

    def finish(self, updated, failed, fatal):
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
        svc_loud, _ = _service(tmp_path, loud)
        loud_result = svc_loud.run(ListStrategy([("A", model()), ("B", None)]), ["A", "B"])

        svc_quiet, _ = _service(tmp_path, quiet)
        quiet_result = svc_quiet.run(ListStrategy([("A", model()), ("B", None)]), ["A", "B"])

        assert loud_result == quiet_result
        assert loud.calls == ["begin", "record", "finish"]

    def test_no_mirror_is_identical_to_before(self, tmp_path):
        svc, ds = _service(tmp_path)
        result = svc.run(ListStrategy([("A", model())]), ["A"])
        assert result.updated == 1
        assert ds.scores_row("A") is not None
