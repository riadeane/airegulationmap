# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Regulation Map is a data visualization web app showing global AI regulation status by country, paired with an automated Python/Claude API pipeline that researches and updates the data monthly.

## Running the App

```bash
npm install      # install dependencies
npm run dev      # start Vite dev server with HMR
npm run build    # production build to dist/
npm run preview  # preview production build
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

Requires `ANTHROPIC_API_KEY` in environment. Install Python dependencies:

```bash
pip install -r requirements.txt
```

## Architecture

### Frontend (`src/`)

Vanilla JS + D3.js + TopoJSON, built with Vite. No framework.

**Module structure:**

| Directory | Purpose |
|-----------|---------|
| `src/main.js` | Entry point — boots app, loads data, wires subscriptions |
| `src/state/store.js` | Centralized state store with event bus (`getState`, `setState`, `on`) |
| `src/constants.js` | Attribute labels, legend endpoints, score options, shared regex |
| `src/data/loader.js` | CSV loading and parsing (scores + regulation data) |
| `src/data/history.js` | History JSON loading and date-based score reconstruction |
| `src/map/` | Map rendering (renderer, legend, zoom, tooltip) |
| `src/panel/` | Country detail panel (scores, text sections) |
| `src/controls/` | UI controls (search, score selector, filter, timeline) |
| `src/styles/` | CSS partials imported via Vite (`_tokens`, `_header`, `_map`, `_panel`, etc.) |

**State management:** All mutable state lives in `src/state/store.js` as a single object. Modules read state via `getState()` and write via `setState(patch)`. The store emits events per changed key, allowing modules to subscribe with `on(key, handler)`.

**Data flow:**
1. `main.js` loads `scores.csv` and `regulation_data.csv` in parallel via `Promise.all`
2. Data is stored in the centralized state store
3. D3 renders a choropleth SVG world map; TopoJSON provides country geometries
4. User interactions dispatch state changes which trigger subscribed re-renders

### Backend (`scripts/regulation_pipeline/`)

Python package that calls the Claude API to research regulation status per country.

| Module | Purpose |
|--------|---------|
| `cli.py` | CLI entry point — arg parsing, orchestration loop |
| `api.py` | Claude API calls, prompt template, response parsing |
| `config.py` | Constants — file paths, field lists, staleness threshold, priority countries |
| `data_io.py` | CSV/JSON loading and writing, validation |
| `names.py` | Country name normalization via alias map |
| `staleness.py` | Determines which countries need re-research |
| `history.py` | History snapshot append logic |
| `processor.py` | Transforms API results into CSV row dicts |

`scripts/update_data.py` is a thin shim that imports and calls `regulation_pipeline.cli.main()`.

### Data Files (in `public/`)

| File | Purpose |
|------|---------|
| `public/scores.csv` | Numeric scores (1–5) for 6 dimensions per country |
| `public/regulation_data.csv` | Text descriptions, laws, source URLs, confidence, last_updated |
| `public/history.json` | Timestamped snapshots of score data for timeline playback |
| `public/data/country_names.json` | Canonical country names with alias arrays for normalization |

These files are served as static assets by Vite (via `publicDir`) and copied unchanged to `dist/` on build.

### Scoring Dimensions

Six attributes scored 1–5 (used in the score selector dropdown):
- **avg_score** — composite average
- **regulation_status** — existence and maturity of regulation
- **policy_lever** — type of policy instrument used
- **governance_type** — governance model
- **actor_involvement** — which actors are involved
- **enforcement_level** — enforcement rigor

### Automated Updates

`.github/workflows/update-data.yml` runs `update_data.py` on the 1st of each month (6am UTC) and auto-commits any changed CSV/JSON files in `public/`. It can also be triggered manually with optional country list, force flag, and model selection inputs. Requires `ANTHROPIC_API_KEY` set as a GitHub Actions secret.

### Deployment

Hosted on Cloudflare Pages. Build command: `npm run build`, output directory: `dist`.

## Design Context

### Users

Policy researchers, academics, policymakers, and civil society actors working on AI governance. Typical context: desk research during working hours, cross-referencing country postures, pulling citations for briefs and papers, benchmarking one jurisdiction against peers. Reads carefully, distrusts marketing gloss, wants to verify claims against sources.

**Job to be done:** quickly form an accurate, comparable mental model of how different countries regulate AI across six dimensions — and get from that model to primary sources without friction.

### Brand Personality

**Three words:** rigorous, calm, global. Tone is measured authority — closer to a reference work than to a product. Treats the reader as a peer. Emotional goal is trust: the researcher should feel they can cite this in a footnote without apologizing.

### Aesthetic Direction

Contemporary data-viz — Observable, MIT Media Lab, The Pudding's restrained pieces, Our World in Data with more current typography. Technical confidence without being cold.

- Ship both light and dark themes with a persistent user toggle. Light is the default for citation-friendly daylight reading.
- Map is the protagonist; all UI chrome must justify its visual weight against it.
- Typography pairs a distinctive display/serif or grot with a precise neutral sans. Do not reach for Inter, IBM Plex, Fraunces, Space Grotesk, etc. — look further.
- Neutrals tinted toward a single considered hue. No pure #000 or #fff.
- Choropleth color uses perceptually uniform OKLCH and is colorblind-safe. Accent used sparingly.
- Asymmetric, left-aligned layouts. Country panel should read like a structured reference entry, not a card.

**Must NOT look like:** generic SaaS / AI startup, corporate consultancy, government portal cliché, or crypto / web3 dashboard.

### Design Principles

1. **The map is the protagonist.** Chrome recedes so the choropleth reads first.
2. **Rigor over ornament.** Every visual element earns its place. No border-left stripes, no gradient text, no decorative sparklines.
3. **Designed for comparison.** Side-by-side country reading is the natural path, not a special mode.
4. **Citeable by default.** Every score, claim, and description points to a primary source within one click. Confidence and last-updated are visible.
5. **Calm density.** Information-rich is the target; cluttered is the failure. Density through typographic hierarchy and restraint, not by removing substance.

Full context lives in [.impeccable.md](.impeccable.md).
