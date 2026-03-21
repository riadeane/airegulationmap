#!/usr/bin/env python3
"""
AI Regulation Map - Data Update Script

Uses the Claude API to research and update AI regulation data for each country.
Updates scores.csv, regulation_data.csv, and history.json.

Usage:
  python scripts/update_data.py [--countries "Germany,France"] [--force] [--dry-run] [--model MODEL]

Requirements:
  pip install anthropic

Environment:
  ANTHROPIC_API_KEY - required
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import date, datetime, timedelta

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic package not installed. Run: pip install anthropic")
    sys.exit(1)


class FatalAPIError(Exception):
    """Raised when the API returns an unrecoverable error."""
    pass


# ── Configuration ─────────────────────────────────────────────

SCORES_CSV = "scores.csv"
REGULATION_CSV = "regulation_data.csv"
HISTORY_JSON = "history.json"
COUNTRY_NAMES_JSON = "data/country_names.json"

SCORES_FIELDS = [
    "Country", "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Average Score", "Enforcement Level",
    "Last Updated", "Data Version"
]

REGULATION_FIELDS = [
    "Country", "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Enforcement Level", "Specific Laws",
    "Sources", "Last Updated", "Confidence"
]

STALENESS_DAYS = 90  # Re-research if data is older than this


# ── Name normalization ────────────────────────────────────────

def load_alias_map():
    """Load country name alias map for normalization."""
    if not os.path.exists(COUNTRY_NAMES_JSON):
        return {}
    with open(COUNTRY_NAMES_JSON, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("aliases", {})


def canonicalize(name, aliases):
    """Normalize a country name to its canonical form."""
    return aliases.get(name.strip(), name.strip())


# ── Data loading ──────────────────────────────────────────────

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


# ── Staleness check ────────────────────────────────────────────

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


# ── Claude API research ────────────────────────────────────────

RESEARCH_PROMPT = """You are a researcher specializing in AI policy and regulation worldwide.

Country: {country}
Today's date: {today}

Existing data (may be outdated):
- Regulation Status: {existing_reg_status}
- Policy Lever: {existing_policy}
- Governance Type: {existing_governance}
- Actor Involvement: {existing_actors}

Research the current state of AI regulation in {country} as of {today}.
Consider recent legislation, executive orders, national strategies, and international agreements.

Return ONLY a valid JSON object with these exact keys:
{{
  "regulation_status_score": <integer 1-5>,
  "regulation_status_text": "<current regulatory approach, 1-3 sentences>",
  "policy_lever_score": <integer 1-5>,
  "policy_lever_text": "<policy mechanisms used, 1-2 sentences>",
  "governance_type_score": <integer 1-5>,
  "governance_type_text": "<governance structure, 1-2 sentences>",
  "actor_involvement_score": <integer 1-5>,
  "actor_involvement_text": "<actors and geographic scope, 1-2 sentences>",
  "enforcement_level_score": <integer 1-5>,
  "enforcement_level_text": "<how strictly rules are enforced, 1 sentence>",
  "specific_laws": "<comma-separated named laws/acts with years, or empty string>",
  "sources": "<pipe-separated URLs to primary sources (government sites preferred), or empty string>",
  "confidence": "<high|medium|low>"
}}

Scoring guidance:
- 1 = No regulation / minimal engagement
- 2 = Early-stage / voluntary guidelines only
- 3 = Draft legislation / national strategy in progress
- 4 = Active regulation / laws enacted
- 5 = Comprehensive binding regulation with enforcement

Enforcement level:
- 1 = No enforcement mechanism
- 3 = Some oversight bodies / soft enforcement
- 5 = Active enforcement, penalties, audits

Return ONLY the JSON object. No preamble, no explanation, no markdown.
"""


def research_country(client, country, existing_reg, model):
    """Call Claude API to research one country. Returns parsed dict or None on error."""
    existing_reg = existing_reg or {}
    prompt = RESEARCH_PROMPT.format(
        country=country,
        today=date.today().isoformat(),
        existing_reg_status=existing_reg.get("Regulation Status", "Unknown"),
        existing_policy=existing_reg.get("Policy Lever", "Unknown"),
        existing_governance=existing_reg.get("Governance Type", "Unknown"),
        existing_actors=existing_reg.get("Actor Involvement", "Unknown"),
    )

    try:
        response = client.messages.create(
            model=model,
            max_tokens=2048,
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=[{"role": "user", "content": prompt}]
        )
        text = next((block.text for block in response.content if block.type == "text"), None)
        if not text:
            print(f"  WARNING: no text block in response for {country}")
            return None
        text = text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"  WARNING: JSON parse error for {country}: {e}")
        return None
    except anthropic.AuthenticationError as e:
        raise FatalAPIError(f"Authentication failed (invalid API key): {e}")
    except anthropic.PermissionDeniedError as e:
        raise FatalAPIError(f"Permission denied (check credits/permissions): {e}")
    except anthropic.RateLimitError as e:
        print(f"  WARNING: Rate limited for {country}: {e}")
        return None
    except anthropic.APITimeoutError as e:
        print(f"  WARNING: Timeout for {country}: {e}")
        return None
    except anthropic.APIConnectionError as e:
        print(f"  WARNING: Connection error for {country}: {e}")
        return None
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            print(f"  WARNING: Server error ({e.status_code}) for {country}: {e}")
            return None
        raise FatalAPIError(f"API error {e.status_code}: {e}")
    except Exception as e:
        print(f"  ERROR researching {country}: {e}")
        return None


# ── History management ────────────────────────────────────────

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
        # Only add if any score changed
        changed = any(
            new_snapshot.get(k) != last.get(k)
            for k in ["regulationStatus", "policyLever", "governanceType",
                       "actorInvolvement", "enforcementLevel"]
        )
        if not changed:
            # Update date of last snapshot instead of duplicating
            last["date"] = today_str
            return False  # no new snapshot

    snapshots.append(new_snapshot)
    return True  # new snapshot added


# ── Output writing ────────────────────────────────────────────

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


# ── Validation ────────────────────────────────────────────────

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


# ── Main ──────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Update AI regulation data using Claude API")
    parser.add_argument("--countries", default="", help="Comma-separated list of countries to update")
    parser.add_argument("--force", action="store_true", help="Force update regardless of staleness")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    parser.add_argument("--model", default="claude-sonnet-4-6", help="Claude model to use")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable not set")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    aliases = load_alias_map()

    print(f"Loading existing data...")
    scores_data = load_scores(aliases)
    reg_data = load_regulation(aliases)
    history = load_history()

    today_str = date.today().isoformat()

    # Determine which countries to process
    if args.countries:
        target_countries = [canonicalize(c.strip(), aliases) for c in args.countries.split(",") if c.strip()]
    else:
        target_countries = sorted(scores_data.keys())

    to_update = [c for c in target_countries if should_update(c, scores_data, reg_data, force=args.force)]

    print(f"Countries to update: {len(to_update)} / {len(target_countries)}")
    if not to_update:
        print("Nothing to update.")
        return

    if args.dry_run:
        print("DRY RUN - would update:")
        for c in to_update:
            print(f"  {c}")
        return

    updated_count = 0
    failed_countries = []
    consecutive_failures = 0

    try:
        for i, country in enumerate(to_update, 1):
            print(f"[{i}/{len(to_update)}] Researching {country}...")
            result = research_country(client, country, reg_data.get(country), args.model)

            if result is None:
                failed_countries.append(country)
                consecutive_failures += 1
                if consecutive_failures >= 5:
                    raise FatalAPIError(
                        f"{consecutive_failures} consecutive failures — likely a systemic issue"
                    )
                time.sleep(2)
                continue

            consecutive_failures = 0

            # Calculate average score
            score_fields = [
                result.get("regulation_status_score"),
                result.get("policy_lever_score"),
                result.get("governance_type_score"),
                result.get("actor_involvement_score"),
            ]
            valid_scores = [s for s in score_fields if s is not None]
            avg_score = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else None

            result["average_score"] = avg_score

            # Get current data version
            current_version = int(scores_data.get(country, {}).get("Data Version", 1) or 1)

            # Update scores dict
            if country not in scores_data:
                scores_data[country] = {"Country": country}
            scores_data[country].update({
                "Country": country,
                "Regulation Status": result.get("regulation_status_score", ""),
                "Policy Lever": result.get("policy_lever_score", ""),
                "Governance Type": result.get("governance_type_score", ""),
                "Actor Involvement": result.get("actor_involvement_score", ""),
                "Average Score": avg_score or "",
                "Enforcement Level": result.get("enforcement_level_score", ""),
                "Last Updated": today_str,
                "Data Version": current_version + 1,
            })

            # Update regulation dict
            if country not in reg_data:
                reg_data[country] = {"Country": country}
            reg_data[country].update({
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
            })

            # Append to history
            added = append_history_snapshot(history, country, result, today_str)

            confidence = result.get("confidence", "?")
            snapshot_note = "(new snapshot)" if added else "(no score change)"
            print(f"  Done. Avg score: {avg_score}, Confidence: {confidence} {snapshot_note}")

            updated_count += 1

            # Small delay to be polite to the API
            if i < len(to_update):
                time.sleep(0.5)

    except FatalAPIError as e:
        print(f"\nFATAL: {e}")
        print(f"Aborting. {updated_count} countries updated before failure.")
        if updated_count > 0:
            print("Saving partial progress...")
            write_scores(scores_data)
            write_regulation(reg_data)
            write_history(history)
        sys.exit(2)

    # Validate before writing
    errors = validate_outputs(scores_data, reg_data)
    if errors:
        print(f"\nWARNING: Validation errors found:")
        for err in errors:
            print(f"  {err}")

    print(f"\nWriting output files...")
    write_scores(scores_data)
    write_regulation(reg_data)
    write_history(history)

    print(f"\nDone. Updated {updated_count} countries.")
    if failed_countries:
        print(f"Failed countries ({len(failed_countries)}): {', '.join(failed_countries)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
