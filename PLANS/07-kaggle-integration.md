# Kaggle Dataset Integration

## Why Build This

Cross-referencing external datasets improves data confidence and coverage. The Kaggle Global AI Regulation Tracker 2025 may contain additional countries, laws, or regulatory details not captured by the Claude API pipeline. Using it as a validation layer can increase confidence scores and catch gaps. It also establishes a pattern for integrating future external sources.

## Research Links

- Kaggle dataset: https://www.kaggle.com/datasets/zohaibkhanjaffar/global-ai-regulation-tracker-2025-20250917181327
- Current pipeline: `scripts/regulation_pipeline/` — Claude API-based research
- Country name normalization: `scripts/regulation_pipeline/names.py` + `public/data/country_names.json`

## Current State

- `scripts/regulation_pipeline/` handles all data updates:
  - `api.py` — Claude API calls with structured prompts
  - `processor.py` — transforms API results into CSV row dicts
  - `data_io.py` — reads/writes `scores.csv` and `regulation_data.csv`
  - `names.py` — country name normalization via alias map
  - `config.py` — file paths, field lists, staleness thresholds
- `public/scores.csv` — current numeric scores
- `public/regulation_data.csv` — current text descriptions
- `public/data/country_names.json` — canonical names + aliases
- No existing external dataset integration

## Implementation Approach

### Step 0: Download and inspect the Kaggle dataset

**This step must be done first before proceeding.** The implementing agent should:

1. Download the dataset from Kaggle (may require `kaggle` CLI or manual download)
2. Inspect the CSV schema: column names, data types, row count
3. Sample 5–10 rows to understand content quality and coverage
4. Document the schema in this plan (update this section)

Until the schema is known, the steps below are speculative and should be adjusted.

### Step 1: Create a data directory for external sources

```
scripts/external_data/
  kaggle_tracker/
    raw/              # Original downloaded CSV
    README.md         # Source attribution, download date, license
```

### Step 2: Create a mapping/normalization script

Create `scripts/external_data/kaggle_tracker/normalize.py`:

```python
"""
Normalize Kaggle AI Regulation Tracker data to match
the project's country names and field structure.
"""
import csv
import json
from pathlib import Path

# Reuse existing name normalization
from regulation_pipeline.names import normalize_country_name

def load_kaggle_data(filepath):
    """Load and normalize the raw Kaggle CSV."""
    with open(filepath) as f:
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            # Normalize country name
            name = normalize_country_name(row.get('Country', ''))
            if not name:
                continue  # Skip unrecognizable entries
            row['normalized_country'] = name
            rows.append(row)
    return rows

def map_to_project_schema(kaggle_rows):
    """
    Map Kaggle fields to project fields.
    This function needs to be updated once the Kaggle schema is known.
    """
    # PLACEHOLDER — update after inspecting dataset
    mapped = {}
    for row in kaggle_rows:
        country = row['normalized_country']
        mapped[country] = {
            # Map Kaggle columns → project columns
            # e.g., 'Has_AI_Law' → supplementary data for regulationStatus
            # e.g., 'Law_Name' → supplement for specificLaws
        }
    return mapped
```

### Step 3: Create a cross-reference/validation script

Create `scripts/external_data/kaggle_tracker/validate.py`:

```python
"""
Cross-reference Kaggle data with existing project data.
Outputs a report of:
- Countries in Kaggle but not in project (coverage gaps)
- Countries in project but not in Kaggle
- Field-level disagreements (e.g., Kaggle says country has law, project says none)
- Specific laws mentioned in Kaggle but missing from project
"""

def generate_validation_report(kaggle_data, project_scores, project_regulation):
    report = {
        'kaggle_only': [],      # Countries in Kaggle not in project
        'project_only': [],     # Countries in project not in Kaggle
        'disagreements': [],    # Score or content mismatches
        'enrichments': [],      # New info Kaggle has that project lacks
    }

    kaggle_countries = set(kaggle_data.keys())
    project_countries = set(project_scores.keys())

    report['kaggle_only'] = sorted(kaggle_countries - project_countries)
    report['project_only'] = sorted(project_countries - kaggle_countries)

    for country in kaggle_countries & project_countries:
        # Compare fields and flag disagreements
        # This logic depends on the Kaggle schema
        pass

    return report
```

### Step 4: Decide integration strategy

Based on the validation report, choose one of:

**Option A: Enrichment layer** (recommended starting point)
- Use Kaggle data to fill gaps in `regulation_data.csv` (e.g., missing specific laws, additional sources)
- Don't override Claude-researched scores
- Add Kaggle as an additional source URL

**Option B: Confidence boost**
- When Kaggle data agrees with project data, bump confidence from "medium" to "high"
- When they disagree, flag for manual review or lower confidence
- Add a `cross_validated` field to `regulation_data.csv`

**Option C: Supplementary dataset**
- Keep Kaggle data as a separate `public/kaggle_data.csv`
- Show it in the country panel as "External source" section
- Let users see both perspectives

### Step 5: If integrating into the pipeline

Modify `scripts/regulation_pipeline/processor.py` to accept supplementary data:

```python
def enrich_with_external(row_dict, external_data):
    """
    Add external data references to a processed country row.
    - Append new law names to specificLaws
    - Append source URLs
    - Adjust confidence if cross-validated
    """
    country = row_dict.get('Country')
    ext = external_data.get(country)
    if not ext:
        return row_dict

    # Enrich specific laws
    existing_laws = row_dict.get('Specific Laws', '')
    new_laws = ext.get('laws', '')
    if new_laws and new_laws not in existing_laws:
        row_dict['Specific Laws'] = f"{existing_laws}; {new_laws}".strip('; ')

    # Append source
    existing_sources = row_dict.get('Sources', '')
    kaggle_source = 'Kaggle Global AI Regulation Tracker 2025'
    if kaggle_source not in existing_sources:
        row_dict['Sources'] = f"{existing_sources}|{kaggle_source}".strip('|')

    return row_dict
```

### Step 6: Add to the update pipeline (optional)

Modify `scripts/regulation_pipeline/cli.py` to optionally load and cross-reference Kaggle data during the monthly update cycle. Add a `--use-external` flag.

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `scripts/external_data/kaggle_tracker/normalize.py` |
| Create | `scripts/external_data/kaggle_tracker/validate.py` |
| Create | `scripts/external_data/kaggle_tracker/README.md` |
| Create | `scripts/external_data/kaggle_tracker/raw/` (directory for raw data) |
| Modify | `scripts/regulation_pipeline/processor.py` — add enrichment function |
| Modify | `scripts/regulation_pipeline/cli.py` — add `--use-external` flag (optional) |
| Modify | `scripts/regulation_pipeline/config.py` — add external data file paths |
| Possibly Modify | `public/data/country_names.json` — add aliases found in Kaggle data |

## Key Decisions / Open Questions

1. **Schema mapping is unknown**: The entire integration depends on the Kaggle dataset's actual columns and content. The implementing agent MUST download and inspect the data first. All code above is speculative.

2. **License compatibility**: Check the Kaggle dataset's license. If it's CC-BY or similar, attribution is required. If it's restrictive, the data cannot be redistributed in `public/`.

3. **Data freshness**: The Kaggle dataset is dated 2025-09-17. The project's Claude pipeline runs monthly and may have more recent data. The Kaggle data should be treated as historical reference, not as ground truth.

4. **Integration depth**: Start with Option A (enrichment) — it's the safest. Don't override Claude-researched data with unverified external data.

5. **Country name mismatches**: The biggest technical risk. The implementing agent should run the normalization script and manually review any unmatched countries. Add new aliases to `country_names.json` as needed.

6. **Automation**: Should Kaggle data be re-downloaded automatically? Probably not — it's a one-time dataset. Manual download + version tracking in README is sufficient.

## Verification

1. Download Kaggle CSV → document schema and row count
2. Run normalization → all country names match or are logged as unmatched
3. Run validation report → review coverage gaps and disagreements
4. Enrich 5 sample countries → verify laws and sources are appended correctly
5. Run `npm run build` → no frontend breakage from changed CSV fields
6. Spot-check 3 enriched countries in the app → new info appears in panel
7. Verify original scores are NOT overwritten by Kaggle data
