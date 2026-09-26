from regulation_pipeline.history import append_snapshot, calibration_due, rubric_of


def snap(date="2026-06-01", **overrides):
    s = {
        "date": date,
        "regulationStatus": 2, "policyLever": 2, "governanceType": 2,
        "actorInvolvement": 2, "enforcementLevel": 2, "averageScore": 2.0,
    }
    s.update(overrides)
    return s


def test_first_snapshot_is_appended():
    history = {"schema_version": 1, "countries": {}}
    assert append_snapshot(history, "Fiji", snap()) is True
    assert len(history["countries"]["Fiji"]) == 1
    assert history["countries"]["Fiji"][0]["averageScore"] == 2.0


def test_changed_scores_append_new_snapshot():
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    assert append_snapshot(history, "Fiji", snap(date="2026-07-01", policyLever=3)) is True
    assert len(history["countries"]["Fiji"]) == 2
    assert history["countries"]["Fiji"][1]["policyLever"] == 3


def test_unchanged_scores_leave_the_change_point_date_alone():
    # A snapshot's date is when the scores changed. Moving it to the latest
    # unchanged re-research would re-date the change on the timeline.
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    append_snapshot(history, "Fiji", snap(date="2026-07-01", policyLever=3))
    assert append_snapshot(history, "Fiji", snap(date="2026-08-01", policyLever=3)) is False
    assert append_snapshot(history, "Fiji", snap(date="2026-09-01", policyLever=3)) is False
    assert [s["date"] for s in history["countries"]["Fiji"]] == ["2026-06-01", "2026-07-01"]


def test_same_day_rerun_replaces_that_days_snapshot():
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    append_snapshot(history, "Fiji", snap(date="2026-07-01", policyLever=3))
    assert append_snapshot(history, "Fiji", snap(date="2026-07-01", policyLever=4)) is True
    snapshots = history["countries"]["Fiji"]
    assert [s["date"] for s in snapshots] == ["2026-06-01", "2026-07-01"]
    assert snapshots[-1]["policyLever"] == 4


def test_same_day_rerun_back_to_the_previous_scores_drops_the_day():
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    append_snapshot(history, "Fiji", snap(date="2026-07-01", policyLever=3))
    assert append_snapshot(history, "Fiji", snap(date="2026-07-01")) is False
    assert [s["date"] for s in history["countries"]["Fiji"]] == ["2026-06-01"]


def test_same_day_first_snapshot_is_replaced():
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    assert append_snapshot(history, "Fiji", snap(policyLever=4)) is True
    assert len(history["countries"]["Fiji"]) == 1
    assert history["countries"]["Fiji"][0]["policyLever"] == 4


def test_average_change_alone_does_not_append():
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    assert append_snapshot(history, "Fiji", snap(date="2026-07-01", averageScore=2.01)) is False


def test_rubric_of_reads_the_field_or_the_prompt_version():
    assert rubric_of({"rubric": "v3"}) == "v3"
    assert rubric_of({"prompt_version": "v3.1-grounded-2026-09"}) == "v3"
    assert rubric_of({"prompt_version": "v2-2026-06"}) == "v2"
    assert rubric_of({}) is None


def test_calibration_is_due_only_after_an_older_rubric_break():
    june = {"date": "2026-06-13", "prompt_version": "v2-2026-06", "reason": "v2"}
    september = {"date": "2026-09-28", "rubric": "v3", "reason": "v3"}
    assert calibration_due([], "v3") is False  # a fresh dataset never triggers it
    assert calibration_due([june], "v3") is True
    assert calibration_due([june, september], "v3") is False
    assert calibration_due([september, june], "v3") is False  # newest by date wins


def test_the_committed_history_records_the_v2_break():
    import json
    from pathlib import Path

    history = json.loads(
        (Path(__file__).resolve().parents[2] / "public" / "history.json").read_text(encoding="utf-8")
    )
    [june] = [b for b in history["breaks"] if b["date"] == "2026-06-13"]
    assert rubric_of(june) == "v2"
    # Snapshot dates are change-points: strictly increasing per country.
    for snapshots in history["countries"].values():
        dates = [s["date"] for s in snapshots]
        assert dates == sorted(set(dates))
