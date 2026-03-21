"""Data loading and writing for CSV and JSON files."""

import csv
import json
import os

from .config import (
    SCORES_CSV, REGULATION_CSV, HISTORY_JSON,
    SCORES_FIELDS, REGULATION_FIELDS,
)
from .names import canonicalize


def load_scores(aliases):
    """Read scores.csv, return dict keyed by canonical country name."""
    scores = {}
    if not os.path.exists(SCORES_CSV):
        return scores
    with open(SCORES_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = canonicalize(row["Country"], aliases)
            scores[name] = dict(row)
            scores[name]["Country"] = name
    return scores


def load_regulation(aliases):
    """Read regulation_data.csv, return dict keyed by canonical country name."""
    reg = {}
    if not os.path.exists(REGULATION_CSV):
        return reg
    with open(REGULATION_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = canonicalize(row["Country"], aliases)
            reg[name] = dict(row)
            reg[name]["Country"] = name
    return reg


def load_history():
    """Load history.json, return dict."""
    if not os.path.exists(HISTORY_JSON):
        return {"schema_version": 1, "countries": {}}
    with open(HISTORY_JSON, encoding="utf-8") as f:
        return json.load(f)


def write_scores(scores_data):
    with open(SCORES_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=SCORES_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in sorted(scores_data.values(), key=lambda r: r["Country"]):
            writer.writerow(row)


def write_regulation(reg_data):
    with open(REGULATION_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=REGULATION_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in sorted(reg_data.values(), key=lambda r: r["Country"]):
            writer.writerow(row)


def write_history(history):
    with open(HISTORY_JSON, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def validate_outputs(scores_data, reg_data):
    """Basic validation before writing. Returns list of error strings."""
    errors = []
    for country, row in scores_data.items():
        for field in ["Regulation Status", "Policy Lever", "Governance Type", "Actor Involvement"]:
            val = row.get(field, "")
            if val and val != "NA":
                try:
                    score = float(val)
                    if not (1 <= score <= 5):
                        errors.append(f"{country}: {field} score {score} out of range [1,5]")
                except ValueError:
                    errors.append(f"{country}: {field} value '{val}' is not numeric")
    return errors
