"""Staleness check logic for determining which countries need re-research."""

from datetime import date, datetime

from .config import STALENESS_DAYS


def should_update(country, scores_data, reg_data, force=False):
    """Return True if this country needs re-researching."""
    if force:
        return True

    row = scores_data.get(country, {})

    # Always update if data is all empty/NA
    reg = reg_data.get(country, {})
    if all(v in ("", "NA", None) for k, v in reg.items() if k != "Country"):
        return True

    # Update if confidence is low
    if reg.get("Confidence") == "low":
        return True

    # Update if last_updated is missing or stale
    last_updated = row.get("Last Updated", "")
    if not last_updated:
        return True

    try:
        last_date = datetime.strptime(last_updated, "%Y-%m-%d").date()
        if (date.today() - last_date).days > STALENESS_DAYS:
            return True
    except ValueError:
        return True

    return False
