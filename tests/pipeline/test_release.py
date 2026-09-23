"""Versioned dataset releases (PRD 10): the week tag, matching the Zenodo
record for a release across both API serializations, the polling lookup,
the release.json document, the release notes, and the two CLI commands."""

from __future__ import annotations

import json
from datetime import date
from functools import partial

import httpx
import pytest
from regulation_pipeline import release as release_mod
from regulation_pipeline.release import (
    ZenodoRecord,
    app,
    concept_record_id,
    drift_row_for,
    find_record,
    is_sandbox,
    load_release,
    load_week_digest,
    lookup_doi,
    match_record,
    parse_record,
    record_matches,
    release_payload,
    render_notes,
    week_tag,
    write_release,
)
from typer.testing import CliRunner

TAG = "data-2026-W39"
DAY = date(2026, 9, 21)
TREE = f"https://github.com/riadeane/airegulationmap/tree/{TAG}"
DOI = "10.5281/zenodo.1234567"
CONCEPT = "10.5281/zenodo.1234566"

# The pre-2023 serialization: DOIs as top-level keys.
LEGACY_HIT = {
    "id": 1234567,
    "doi": DOI,
    "conceptdoi": CONCEPT,
    "metadata": {
        "version": TAG,
        "title": "AI Regulation Map: dataset",
        "related_identifiers": [{"identifier": TREE, "relation": "isSupplementTo"}],
    },
}
# The InvenioRDM serialization: DOIs under pids / parent.pids, and a version
# that is not the tag (only the tree URL identifies the release).
RDM_HIT = {
    "id": "1234567",
    "pids": {"doi": {"identifier": DOI}},
    "parent": {"pids": {"doi": {"identifier": CONCEPT}}},
    "metadata": {
        "version": "1.0",
        "related_identifiers": [{"identifier": TREE, "relation": "issupplementto"}],
    },
}
RECORD = ZenodoRecord(doi=DOI, concept_doi=CONCEPT, version=TAG, record_id="1234567")

runner = CliRunner()


def search_payload(hits: list) -> dict:
    return {"hits": {"hits": hits, "total": len(hits)}}


def zenodo(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


# -- tags ------------------------------------------------------------------------


def test_week_tag_uses_the_iso_week_and_year():
    assert week_tag(date(2026, 9, 21)) == "data-2026-W39"
    assert week_tag(date(2026, 1, 1)) == "data-2026-W01"
    # 1 January 2027 falls in ISO week 53 of 2026.
    assert week_tag(date(2027, 1, 1)) == "data-2026-W53"


def test_is_sandbox():
    assert is_sandbox("https://sandbox.zenodo.org/api")
    assert not is_sandbox("https://zenodo.org/api")


def test_concept_record_id():
    assert concept_record_id(CONCEPT) == "1234566"


# -- record matching -------------------------------------------------------------


def test_record_matches_by_version_or_tree_url():
    assert record_matches(LEGACY_HIT, TAG)
    assert record_matches(RDM_HIT, TAG)
    assert not record_matches({**RDM_HIT, "metadata": {"version": "other"}}, TAG)
    assert not record_matches(LEGACY_HIT, "data-2026-W40")
    # Another repository's release with the same tag name is not ours.
    assert not record_matches({"metadata": {"related_identifiers": [{"identifier": TREE}]}}, TAG, repo="someone/else")
    assert not record_matches("junk", TAG)
    assert not record_matches({"metadata": {"related_identifiers": "junk"}}, TAG)


def test_parse_record_reads_both_serializations():
    assert parse_record(LEGACY_HIT) == RECORD
    rdm = parse_record(RDM_HIT)
    assert (rdm.doi, rdm.concept_doi, rdm.version, rdm.record_id) == (DOI, CONCEPT, "1.0", "1234567")
    # No DOI, no record: the lookup must keep waiting.
    assert parse_record({"metadata": {"version": TAG}}) is None
    assert parse_record(None) is None
    # A record without a concept DOI still yields its version DOI.
    assert parse_record({"doi": DOI}).concept_doi is None


def test_match_record_skips_other_versions_and_doi_less_hits():
    hits = [
        {"metadata": {"version": "data-2026-W38"}, "doi": "10.5281/zenodo.1"},
        {"metadata": {"version": TAG}},
        LEGACY_HIT,
    ]
    assert match_record(hits, TAG) == RECORD
    assert match_record([], TAG) is None
    assert match_record(None, TAG) is None


# -- lookup ----------------------------------------------------------------------


def test_find_record_reads_the_concept_record_first():
    paths = []

    def handler(request):
        paths.append(request.url.path)
        if request.url.path == "/api/records/1234566":
            return httpx.Response(200, json=LEGACY_HIT)
        return httpx.Response(200, json=search_payload([]))

    with zenodo(handler) as client:
        assert find_record(client, "https://zenodo.org/api", TAG, concept_doi=CONCEPT) == RECORD
    assert paths == ["/api/records/1234566"]


def test_find_record_falls_through_to_search_when_the_concept_record_is_stale():
    def handler(request):
        if request.url.path == "/api/records/1234566":
            stale = {**LEGACY_HIT, "metadata": {"version": "data-2026-W38"}}
            return httpx.Response(200, json=stale)
        if request.url.params.get("q") == f'"{TAG}"':
            return httpx.Response(200, json=search_payload([RDM_HIT]))
        return httpx.Response(200, json=search_payload([]))

    with zenodo(handler) as client:
        record = find_record(client, "https://zenodo.org/api", TAG, concept_doi=CONCEPT)
    assert record.doi == DOI
    assert record.concept_doi == CONCEPT


def test_find_record_tries_the_search_queries_in_order():
    seen = []

    def handler(request):
        seen.append((request.url.path, dict(request.url.params)))
        return httpx.Response(200, json=search_payload([]))

    with zenodo(handler) as client:
        assert find_record(client, "https://sandbox.zenodo.org/api/", TAG) is None
    assert [path for path, _ in seen] == ["/api/records"] * 3
    assert [params["q"] for _, params in seen] == [
        f'metadata.version:"{TAG}"', f'version:"{TAG}"', f'"{TAG}"',
    ]
    assert all(p["all_versions"] == "true" and p["size"] == "50" for _, p in seen)


@pytest.mark.parametrize(
    "handler",
    [
        lambda request: (_ for _ in ()).throw(httpx.ConnectError("down")),
        lambda request: httpx.Response(500, text="boom"),
        lambda request: httpx.Response(200, text="<html>not json</html>"),
        lambda request: httpx.Response(200, json={"hits": "odd"}),
    ],
)
def test_find_record_swallows_transport_and_shape_errors(handler):
    with zenodo(handler) as client:
        assert find_record(client, "https://zenodo.org/api", TAG, concept_doi=CONCEPT) is None


def test_lookup_doi_polls_until_the_record_exists():
    state = {"ready": False}
    naps = []

    def handler(request):
        return httpx.Response(200, json=search_payload([LEGACY_HIT] if state["ready"] else []))

    def sleep(seconds):
        naps.append(seconds)
        state["ready"] = len(naps) >= 2

    with zenodo(handler) as client:
        record = lookup_doi(client, "https://zenodo.org/api", TAG, attempts=5, interval=7, sleep=sleep)
    assert record == RECORD
    assert naps == [7, 7]


def test_lookup_doi_gives_up_after_the_attempts():
    naps = []
    with zenodo(lambda request: httpx.Response(200, json=search_payload([]))) as client:
        assert lookup_doi(client, "https://zenodo.org/api", TAG, attempts=3, interval=1.5, sleep=naps.append) is None
    # No nap after the last attempt.
    assert naps == [1.5, 1.5]


# -- release.json ----------------------------------------------------------------


def test_release_payload_with_a_record():
    assert release_payload(TAG, DAY, RECORD, sandbox=False) == {
        "tag": TAG, "date": "2026-09-21", "doi": DOI, "concept_doi": CONCEPT, "sandbox": False,
    }


def test_release_payload_without_a_record_carries_the_concept_doi_forward():
    previous = {"tag": "data-2026-W38", "date": "2026-09-14", "doi": "10.5281/zenodo.1", "concept_doi": CONCEPT, "sandbox": False}
    payload = release_payload(TAG, DAY, None, sandbox=False, previous=previous)
    assert payload == {"tag": TAG, "date": "2026-09-21", "doi": None, "concept_doi": CONCEPT, "sandbox": False}
    # Never across Zenodo instances: a sandbox concept DOI is not a production one.
    assert release_payload(TAG, DAY, None, sandbox=True, previous=previous)["concept_doi"] is None
    # A file without the flag is a production file.
    assert release_payload(TAG, DAY, None, sandbox=False, previous={"concept_doi": CONCEPT})["concept_doi"] == CONCEPT
    assert release_payload(TAG, DAY, None, sandbox=False, previous=None)["concept_doi"] is None
    # The record's own concept DOI wins over the carried one.
    fresh = ZenodoRecord(doi=DOI, concept_doi="10.5281/zenodo.2", version=TAG, record_id=None)
    assert release_payload(TAG, DAY, fresh, sandbox=False, previous=previous)["concept_doi"] == "10.5281/zenodo.2"


def test_write_and_load_release_round_trip(tmp_path):
    path = tmp_path / "data" / "release.json"
    payload = release_payload(TAG, DAY, RECORD, sandbox=False)
    write_release(path, payload)
    assert load_release(path) == payload
    text = path.read_text(encoding="utf-8")
    assert text.endswith("}\n")
    assert '"tag": "data-2026-W39"' in text
    assert not path.with_name("release.json.tmp").exists()
    assert load_release(tmp_path / "missing.json") is None
    (tmp_path / "bad.json").write_text("[1]", encoding="utf-8")
    assert load_release(tmp_path / "bad.json") is None


# -- notes -----------------------------------------------------------------------


def test_render_notes_without_extras():
    text = render_notes(TAG, "abcdef1234567", DAY)
    assert text.startswith(
        "Weekly snapshot of the AI Regulation Map dataset for ISO week 2026-W39: "
        "data commit `abcdef1` (2026-09-21)."
    )
    assert "https://airegulationmap.org/methodology.html" in text
    for heading in ("## This week", "## Drift check", "## Run summary"):
        assert heading not in text
    assert text.endswith("\n") and not text.endswith("\n\n")


def test_render_notes_with_digest_drift_and_summary():
    digest = {
        "lead": "Two countries moved.",
        "items": [{"country": "Germany", "headline": "AI Act enforcement began."}, "junk"],
    }
    drift = {"model": "claude-opus-5", "prompt_version": "v3.1-2026-09", "within_one": 0.9, "max_dev": 2}
    text = render_notes(TAG, "abc", DAY, digest=digest, drift=drift, summary="## Data update\n```\nDone.\n```\n")
    assert (
        "## This week\n\nTwo countries moved.\n\n- **Germany**: AI Act enforcement began.\n\n"
        "Full digest: https://airegulationmap.org/changes.html?week=2026-W39"
    ) in text
    assert (
        "Model `claude-opus-5`, prompt `v3.1-2026-09`: share of gold-set sub-indicators "
        "within one point 0.9, largest deviation 2."
    ) in text
    assert text.endswith("## Run summary\n\n## Data update\n```\nDone.\n```\n")
    # A blank summary adds no section.
    assert "## Run summary" not in render_notes(TAG, "abc", DAY, summary="  \n")


def test_load_week_digest_and_drift_row(tmp_path):
    digest_dir = tmp_path / "digest"
    digest_dir.mkdir()
    (digest_dir / "2026-W39.json").write_text(json.dumps({"week": "2026-W39", "lead": "x"}), encoding="utf-8")
    assert load_week_digest(digest_dir, "2026-W39")["lead"] == "x"
    assert load_week_digest(digest_dir, "2026-W40") is None

    drift = tmp_path / "drift.json"
    drift.write_text(json.dumps({"schema_version": 1, "checks": [
        {"date": "2026-09-14", "model": "a"},
        {"date": "2026-09-21", "model": "b"},
        {"date": "2026-09-21", "model": "c"},
    ]}), encoding="utf-8")
    assert drift_row_for(drift, DAY)["model"] == "c"
    assert drift_row_for(drift, date(2026, 9, 28)) is None
    assert drift_row_for(tmp_path / "nope.json", DAY) is None


# -- CLI -------------------------------------------------------------------------


def test_doi_command_writes_release_json_and_step_outputs(tmp_path, monkeypatch):
    def handler(request):
        assert request.headers["Authorization"] == "Bearer tok"
        return httpx.Response(200, json=search_payload([LEGACY_HIT]))

    monkeypatch.setattr(release_mod, "make_client", partial(release_mod.make_client, transport=httpx.MockTransport(handler)))
    out = tmp_path / "release.json"
    gh_output = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(gh_output))
    monkeypatch.delenv("ZENODO_API_BASE", raising=False)

    result = runner.invoke(app, [
        "doi", "--tag", TAG, "--date", "2026-09-21", "--out", str(out),
        "--api-base", "https://zenodo.org/api", "--token", "tok", "--attempts", "1",
    ])
    assert result.exit_code == 0, result.output
    assert json.loads(out.read_text(encoding="utf-8")) == {
        "tag": TAG, "date": "2026-09-21", "doi": DOI, "concept_doi": CONCEPT, "sandbox": False,
    }
    assert f"release: {TAG} doi={DOI} concept_doi={CONCEPT} sandbox=false" in result.output
    assert gh_output.read_text(encoding="utf-8") == f"doi={DOI}\nconcept_doi={CONCEPT}\nsandbox=false\n"


def test_doi_command_never_fails_when_zenodo_has_nothing_yet(tmp_path, monkeypatch):
    def handler(request):
        assert "Authorization" not in request.headers
        return httpx.Response(200, json=search_payload([]))

    monkeypatch.setattr(release_mod, "make_client", partial(release_mod.make_client, transport=httpx.MockTransport(handler)))
    monkeypatch.delenv("ZENODO_API_BASE", raising=False)
    monkeypatch.delenv("ZENODO_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    out = tmp_path / "release.json"
    write_release(out, {"tag": "data-2026-W38", "date": "2026-09-14", "doi": "10.5072/zenodo.98", "concept_doi": "10.5072/zenodo.97", "sandbox": True})

    result = runner.invoke(app, ["doi", "--tag", TAG, "--date", "2026-09-21", "--out", str(out), "--attempts", "2", "--interval", "0"])
    assert result.exit_code == 0, result.output
    # The sandbox is the default instance; the tag is recorded, the DOI is
    # pending, and the sandbox concept DOI carries over.
    assert json.loads(out.read_text(encoding="utf-8")) == {
        "tag": TAG, "date": "2026-09-21", "doi": None, "concept_doi": "10.5072/zenodo.97", "sandbox": True,
    }
    assert f"no Zenodo record for {TAG} after 2 attempt(s)" in result.output


def test_doi_command_reads_the_instance_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setattr(release_mod, "make_client", partial(
        release_mod.make_client,
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=search_payload([LEGACY_HIT]))),
    ))
    monkeypatch.setenv("ZENODO_API_BASE", "https://zenodo.org/api")
    monkeypatch.setenv("ZENODO_TOKEN", "tok")
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    out = tmp_path / "release.json"
    result = runner.invoke(app, ["doi", "--tag", TAG, "--date", "2026-09-21", "--out", str(out), "--attempts", "1"])
    assert result.exit_code == 0, result.output
    assert json.loads(out.read_text(encoding="utf-8"))["sandbox"] is False


def test_doi_command_rejects_a_bad_date(tmp_path):
    result = runner.invoke(app, ["doi", "--tag", TAG, "--date", "21/09/2026", "--out", str(tmp_path / "r.json")])
    assert result.exit_code != 0
    assert not (tmp_path / "r.json").exists()


def test_notes_command(tmp_path):
    summary = tmp_path / "run-summary.md"
    summary.write_text("## Data update\n```\nDone.\n```\n", encoding="utf-8")
    result = runner.invoke(app, [
        "notes", "--tag", TAG, "--commit", "abcdef1234", "--date", "2026-09-21",
        "--digest-dir", str(tmp_path), "--drift", str(tmp_path / "drift.json"), "--summary", str(summary),
    ])
    assert result.exit_code == 0, result.output
    assert result.output.startswith("Weekly snapshot of the AI Regulation Map dataset for ISO week 2026-W39")
    assert result.output.endswith("## Run summary\n\n## Data update\n```\nDone.\n```\n")
