from datetime import date, timedelta

from regulation_pipeline.config import STALENESS_DAYS
from regulation_pipeline.staleness import StalenessPolicy

TODAY = date(2026, 7, 1)
POLICY = StalenessPolicy(STALENESS_DAYS, TODAY)

FRESH_REG = {"Country": "Fiji", "Regulation Status": "Some text", "Confidence": "medium"}


def days_ago(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


def test_force_always_updates():
    assert POLICY.should_update(None, None, force=True) is True


def test_empty_regulation_data_updates():
    reg = {"Country": "Fiji", "Regulation Status": "", "Policy Lever": "NA", "Sources": None}
    assert POLICY.should_update({"Last Updated": days_ago(1)}, reg) is True


def test_country_only_regulation_row_counts_as_empty():
    assert POLICY.should_update({"Last Updated": days_ago(1)}, {"Country": "Fiji"}) is True


def test_low_confidence_updates():
    assert POLICY.should_update({"Last Updated": days_ago(1)}, dict(FRESH_REG, Confidence="low")) is True


def test_missing_scores_row_updates():
    assert POLICY.should_update(None, dict(FRESH_REG)) is True


def test_missing_last_updated_updates():
    assert POLICY.should_update({}, dict(FRESH_REG)) is True


def test_stale_date_updates():
    assert POLICY.should_update({"Last Updated": days_ago(STALENESS_DAYS + 1)}, dict(FRESH_REG)) is True


def test_fresh_date_skips():
    assert POLICY.should_update({"Last Updated": days_ago(STALENESS_DAYS - 1)}, dict(FRESH_REG)) is False


def test_malformed_date_updates():
    assert POLICY.should_update({"Last Updated": "not-a-date"}, dict(FRESH_REG)) is True
