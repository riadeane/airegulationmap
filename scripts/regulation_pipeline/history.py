"""History snapshot management."""


def append_history_snapshot(history, country, scores, today_str):
    """Add a new snapshot only if scores changed from the last entry."""
    snapshots = history["countries"].setdefault(country, [])

    new_snapshot = {
        "date": today_str,
        "regulationStatus": scores.get("regulation_status_score"),
        "policyLever": scores.get("policy_lever_score"),
        "governanceType": scores.get("governance_type_score"),
        "actorInvolvement": scores.get("actor_involvement_score"),
        "enforcementLevel": scores.get("enforcement_level_score"),
        "averageScore": scores.get("average_score"),
    }

    if snapshots:
        last = snapshots[-1]
        changed = any(
            new_snapshot.get(k) != last.get(k)
            for k in ["regulationStatus", "policyLever", "governanceType",
                       "actorInvolvement", "enforcementLevel"]
        )
        if not changed:
            last["date"] = today_str
            return False

    snapshots.append(new_snapshot)
    return True
