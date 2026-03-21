"""CLI entry point for the regulation data update pipeline."""

import argparse
import os
import sys
import time
from datetime import date

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic package not installed. Run: pip install anthropic")
    sys.exit(1)

from .api import FatalAPIError, research_country
from .config import PRIORITY_COUNTRIES
from .data_io import (
    load_history, load_regulation, load_scores,
    validate_outputs, write_history, write_regulation, write_scores,
)
from .history import append_history_snapshot
from .names import canonicalize, load_alias_map
from .processor import build_regulation_row, build_scores_row
from .staleness import should_update


def main():
    parser = argparse.ArgumentParser(description="Update AI regulation data using Claude API")
    parser.add_argument("--countries", default="", help="Comma-separated list of countries to update")
    parser.add_argument("--force", action="store_true", help="Force update regardless of staleness")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    parser.add_argument("--model", default="claude-haiku-4-5-20251001", help="Claude model to use")
    parser.add_argument("--search", action="store_true", help="Enable web search for priority countries")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable not set")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    aliases = load_alias_map()

    print("Loading existing data...")
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
            use_search = args.search and country in PRIORITY_COUNTRIES
            model = "claude-sonnet-4-6" if use_search else args.model
            result = research_country(client, country, reg_data.get(country), model, use_search)

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

            current_version = int(scores_data.get(country, {}).get("Data Version", 1) or 1)

            scores_data[country] = build_scores_row(country, result, current_version, today_str)
            reg_data[country] = build_regulation_row(country, result, today_str)

            added = append_history_snapshot(history, country, result, today_str)

            confidence = result.get("confidence", "?")
            avg_score = result.get("average_score")
            snapshot_note = "(new snapshot)" if added else "(no score change)"
            print(f"  Done. Avg score: {avg_score}, Confidence: {confidence} {snapshot_note}")

            updated_count += 1

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
