"""Decides which countries need re-researching."""

from __future__ import annotations

from datetime import date, datetime


class StalenessPolicy:
    """A country is stale (needs a fresh research pass) when its data is
    empty/NA, its confidence is ``low``, or its ``Last Updated`` stamp is
    missing, unparseable, or older than ``staleness_days``. The reference date
    is injected so a run has one consistent "today" and the logic is testable
    without patching the clock."""

    def __init__(self, staleness_days: int, today: date):
        self.staleness_days = staleness_days
        self.today = today

    def should_update(
        self,
        scores_row: dict | None,
        reg_row: dict | None,
        *,
        force: bool = False,
    ) -> bool:
        if force:
            return True

        reg = reg_row or {}
        # No usable regulation data at all.
        if all(value in ("", "NA", None) for key, value in reg.items() if key != "Country"):
            return True

        # Unsourced / low-confidence answers are re-researched.
        if reg.get("Confidence") == "low":
            return True

        last_updated = (scores_row or {}).get("Last Updated", "")
        if not last_updated:
            return True

        try:
            last_date = datetime.strptime(last_updated, "%Y-%m-%d").date()
        except ValueError:
            return True
        return (self.today - last_date).days > self.staleness_days
