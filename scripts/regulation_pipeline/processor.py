"""Result processing: transform API results into CSV row dicts."""


def calculate_average_score(result):
    """Calculate average from the 4 main score fields (excluding enforcement)."""
    score_fields = [
        result.get("regulation_status_score"),
        result.get("policy_lever_score"),
        result.get("governance_type_score"),
        result.get("actor_involvement_score"),
    ]
    valid_scores = [s for s in score_fields if s is not None]
    if not valid_scores:
        return None
    return round(sum(valid_scores) / len(valid_scores), 2)


def build_scores_row(country, result, current_version, today_str):
    """Build a scores CSV row dict from an API result."""
    avg_score = calculate_average_score(result)
    result["average_score"] = avg_score

    return {
        "Country": country,
        "Regulation Status": result.get("regulation_status_score", ""),
        "Policy Lever": result.get("policy_lever_score", ""),
        "Governance Type": result.get("governance_type_score", ""),
        "Actor Involvement": result.get("actor_involvement_score", ""),
        "Average Score": avg_score or "",
        "Enforcement Level": result.get("enforcement_level_score", ""),
        "Last Updated": today_str,
        "Data Version": current_version + 1,
    }


def build_regulation_row(country, result, today_str):
    """Build a regulation CSV row dict from an API result."""
    return {
        "Country": country,
        "Regulation Status": result.get("regulation_status_text", ""),
        "Policy Lever": result.get("policy_lever_text", ""),
        "Governance Type": result.get("governance_type_text", ""),
        "Actor Involvement": result.get("actor_involvement_text", ""),
        "Enforcement Level": result.get("enforcement_level_text", ""),
        "Specific Laws": result.get("specific_laws", ""),
        "Sources": result.get("sources", ""),
        "Last Updated": today_str,
        "Confidence": result.get("confidence", "medium"),
    }
