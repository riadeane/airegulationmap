from regulation_pipeline.history import append_snapshot


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


def test_unchanged_scores_refresh_date_without_appending():
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    assert append_snapshot(history, "Fiji", snap(date="2026-07-01")) is False
    assert len(history["countries"]["Fiji"]) == 1
    assert history["countries"]["Fiji"][0]["date"] == "2026-07-01"


def test_average_change_alone_does_not_append():
    history = {"schema_version": 1, "countries": {}}
    append_snapshot(history, "Fiji", snap())
    assert append_snapshot(history, "Fiji", snap(date="2026-07-01", averageScore=2.01)) is False
