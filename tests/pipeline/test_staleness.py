from datetime import date, timedelta

from regulation_pipeline.config import STALENESS_DAYS
from regulation_pipeline.staleness import should_update


def days_ago(n):
    return (date.today() - timedelta(days=n)).isoformat()


FRESH_REG = {
    "Country": "Fiji",
    "Regulation Status": "Some text",
    "Confidence": "medium",
}


def test_force_always_updates():
    assert should_update("Fiji", {}, {}, force=True) is True


def test_empty_regulation_data_updates():
    reg = {"Country": "Fiji", "Regulation Status": "", "Policy Lever": "NA", "Sources": None}
    scores = {"Fiji": {"Last Updated": days_ago(1)}}
    assert should_update("Fiji", scores, {"Fiji": reg}) is True


def test_low_confidence_updates():
    reg = dict(FRESH_REG, Confidence="low")
    scores = {"Fiji": {"Last Updated": days_ago(1)}}
    assert should_update("Fiji", scores, {"Fiji": reg}) is True


def test_missing_last_updated_updates():
    assert should_update("Fiji", {"Fiji": {}}, {"Fiji": dict(FRESH_REG)}) is True


def test_stale_date_updates():
    scores = {"Fiji": {"Last Updated": days_ago(STALENESS_DAYS + 1)}}
    assert should_update("Fiji", scores, {"Fiji": dict(FRESH_REG)}) is True


def test_fresh_date_skips():
    scores = {"Fiji": {"Last Updated": days_ago(STALENESS_DAYS - 1)}}
    assert should_update("Fiji", scores, {"Fiji": dict(FRESH_REG)}) is False


def test_malformed_date_updates():
    scores = {"Fiji": {"Last Updated": "not-a-date"}}
    assert should_update("Fiji", scores, {"Fiji": dict(FRESH_REG)}) is True
