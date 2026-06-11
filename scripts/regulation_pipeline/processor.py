"""Result processing: transform API results into CSV row dicts.

Methodology v2 (2026-06): each dimension is scored through four named
sub-indicators (integers 1-5); the dimension score is their mean, giving
0.25-step decimals. The composite "Average Score" is a maturity index
over the three normative dimensions only — governance_type and
actor_involvement are descriptive (centralized<->distributed,
narrow<->broad participation) and no longer pull the headline number.
See public/methodology.html.
"""

SUBSCORE_FIELDS = {
    "regulation_status": ["binding_force", "scope", "implementation", "ai_specificity"],
    "policy_lever": ["binding_instruments", "soft_law", "economic_tools", "institutional_capacity"],
    "governance_type": ["regulator_plurality", "formal_coordination", "subnational_role", "nongovernmental_checks"],
    "actor_involvement": ["industry", "civil_society", "academia", "international"],
    "enforcement_level": ["sanctions_framework", "actions_taken", "dedicated_authority", "monitoring_practice"],
}

DIMENSIONS = list(SUBSCORE_FIELDS.keys())

# Dimensions where higher genuinely means "more developed". The two
# descriptive dimensions are excluded from the composite.
MATURITY_DIMENSIONS = ["regulation_status", "policy_lever", "enforcement_level"]


def validate_result(result):
    """Check that an API result carries every sub-indicator as an int 1-5.

    Returns a list of error strings; empty means valid. Invalid results
    must never reach the CSVs — a missing score would silently land as
    an empty cell.
    """
    errors = []
    for dim, subs in SUBSCORE_FIELDS.items():
        block = result.get(dim)
        if not isinstance(block, dict):
            errors.append(f"{dim} missing or not an object")
            continue
        for sub in subs:
            value = block.get(sub)
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 5:
                errors.append(f"{dim}.{sub}={value!r} (must be int 1-5)")
    return errors


def flatten_result(result):
    """Derive flat '<dim>_score' / '<dim>_text' keys from sub-indicator
    blocks. Dimension score = mean of its four sub-indicators, rounded
    to 2 decimals. Returns a new flat dict; also carries through
    specific_laws / sources / confidence."""
    flat = {}
    for dim, subs in SUBSCORE_FIELDS.items():
        block = result.get(dim) or {}
        values = [block.get(sub) for sub in subs]
        valid = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        flat[f"{dim}_score"] = round(sum(valid) / len(valid), 2) if valid else None
        flat[f"{dim}_text"] = block.get("text", "")
    for key in ("specific_laws", "sources", "confidence"):
        if key in result:
            flat[key] = result[key]
    return flat


def calculate_average_score(result):
    """Maturity index: mean of the three normative dimension scores
    (regulation status, policy lever, enforcement level)."""
    score_fields = [result.get(f"{dim}_score") for dim in MATURITY_DIMENSIONS]
    valid_scores = [s for s in score_fields if s is not None]
    if not valid_scores:
        return None
    return round(sum(valid_scores) / len(valid_scores), 2)


def build_scores_row(country, result, current_version, today_str):
    """Build a scores CSV row dict from a flattened result."""
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
    """Build a regulation CSV row dict from a flattened result."""
    sources = (result.get("sources") or "").strip()
    confidence = result.get("confidence") or "medium"
    # Unsourced claims are not citable — cap confidence at "low" so the
    # UI flags them and staleness logic re-researches them.
    if not sources:
        confidence = "low"

    return {
        "Country": country,
        "Regulation Status": result.get("regulation_status_text", ""),
        "Policy Lever": result.get("policy_lever_text", ""),
        "Governance Type": result.get("governance_type_text", ""),
        "Actor Involvement": result.get("actor_involvement_text", ""),
        "Enforcement Level": result.get("enforcement_level_text", ""),
        "Specific Laws": result.get("specific_laws", ""),
        "Sources": sources,
        "Last Updated": today_str,
        "Confidence": confidence,
    }


def build_subscores_entry(result, today_str):
    """Per-country entry for subscores.json — the audit trail showing
    which concrete sub-indicators produced each dimension score."""
    entry = {"date": today_str}
    for dim, subs in SUBSCORE_FIELDS.items():
        block = result.get(dim) or {}
        entry[dim] = {sub: block.get(sub) for sub in subs}
    return entry
