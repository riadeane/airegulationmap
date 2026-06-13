from regulation_pipeline.history import append_history_snapshot


def scores(**overrides):
    base = {
        "regulation_status_score": 2,
        "policy_lever_score": 2,
        "governance_type_score": 2,
        "actor_involvement_score": 2,
        "enforcement_level_score": 2,
        "average_score": 2.0,
    }
    base.update(overrides)
    return base


def test_first_snapshot_is_appended():
    history = {"schema_version": 1, "countries": {}}
    assert append_history_snapshot(history, "Fiji", scores(), "2026-06-01") is True
    assert len(history["countries"]["Fiji"]) == 1
    snap = history["countries"]["Fiji"][0]
    assert snap["date"] == "2026-06-01"
    assert snap["regulationStatus"] == 2
    assert snap["averageScore"] == 2.0


def test_changed_scores_append_new_snapshot():
    history = {"schema_version": 1, "countries": {}}
    append_history_snapshot(history, "Fiji", scores(), "2026-06-01")
    assert append_history_snapshot(history, "Fiji", scores(policy_lever_score=3), "2026-07-01") is True
    assert len(history["countries"]["Fiji"]) == 2
    assert history["countries"]["Fiji"][1]["policyLever"] == 3


def test_unchanged_scores_refresh_date_without_appending():
    history = {"schema_version": 1, "countries": {}}
    append_history_snapshot(history, "Fiji", scores(), "2026-06-01")
    assert append_history_snapshot(history, "Fiji", scores(), "2026-07-01") is False
    assert len(history["countries"]["Fiji"]) == 1
    # The single snapshot's date moves forward — it documents "still
    # true as of this re-research".
    assert history["countries"]["Fiji"][0]["date"] == "2026-07-01"


def test_average_change_alone_does_not_append():
    history = {"schema_version": 1, "countries": {}}
    append_history_snapshot(history, "Fiji", scores(), "2026-06-01")
    assert append_history_snapshot(history, "Fiji", scores(average_score=2.01), "2026-07-01") is False
