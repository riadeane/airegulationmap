# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Regulation Map is a static data visualization web app showing global AI regulation status by country, paired with an automated Python/Claude API pipeline that researches and updates the data monthly.

## Running the App

There is no build step. Open `index.html` directly in a browser, or serve it with any static file server:

```bash
python -m http.server 8000
```

## Data Update Script

```bash
# Update stale/low-confidence countries automatically
python scripts/update_data.py

# Update specific countries
python scripts/update_data.py --countries "Germany,France,Japan"

# Force re-research all countries (ignores staleness)
python scripts/update_data.py --force

# Preview what would be updated without writing
python scripts/update_data.py --dry-run

# Use a specific Claude model
python scripts/update_data.py --model claude-opus-4-5
```

Requires `ANTHROPIC_API_KEY` in environment. Install the one dependency:

```bash
pip install anthropic
```

## Architecture

### Frontend (`index.html`, `map.js`, `style.css`)

Vanilla JS + D3.js 7 + TopoJSON — no bundler, no npm. All dependencies load from CDN.

**Data flow:**
1. `map.js` loads `scores.csv` (numeric scores) and `regulation_data.csv` (descriptions, laws, URLs, metadata) in parallel
2. Optionally loads `history.json` for the timeline slider
3. D3 renders a choropleth SVG world map; TopoJSON provides country geometries
4. User interactions (score selector, search, filter sliders, timeline, zoom) re-render or update map fill/highlights in place

**Global state** (module-level variables in `map.js`): `currentAttribute`, `currentScoreData`, `currentRegData`, `filterMin/Max`, `currentHistoryData`, `countryAliases`.

Country name matching between TopoJSON features and CSV rows uses `data/country_names.json` (canonical names → alias arrays). The same alias map is used by the Python script.

### Backend (`scripts/update_data.py`)

Python pipeline that calls the Claude API to research regulation status per country:

1. Loads both CSVs and determines which countries are stale (>90 days) or low-confidence
2. Calls Claude with a detailed structured prompt, receiving JSON with 6 numeric scores + qualitative text fields
3. Validates score ranges (1–5), writes back to both CSVs
4. Appends a snapshot to `history.json` only when scores actually change

### Data Files

| File | Purpose |
|------|---------|
| `scores.csv` | Numeric scores (1–5) for 6 dimensions per country |
| `regulation_data.csv` | Text descriptions, laws, source URLs, confidence, last_updated |
| `history.json` | Timestamped snapshots of score data for timeline playback |
| `data/country_names.json` | Canonical country names with alias arrays for normalization |

### Scoring Dimensions

Six attributes scored 1–5 (used in the score selector dropdown):
- **avg_score** — composite average
- **regulation_status** — existence and maturity of regulation
- **policy_lever** — type of policy instrument used
- **governance_type** — governance model
- **actor_involvement** — which actors are involved
- **enforcement_level** — enforcement rigor

### Automated Updates

`.github/workflows/update-data.yml` runs `update_data.py` on the 1st of each month (6am UTC) and auto-commits any changed CSV/JSON files. It can also be triggered manually with optional country list, force flag, and model selection inputs. Requires `ANTHROPIC_API_KEY` set as a GitHub Actions secret.
