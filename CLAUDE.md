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
npm run lint       # ESLint (flat config in eslint.config.js)
npm run typecheck  # tsc --noEmit (strict; tsconfig.json)
npm test           # Vitest unit tests (tests/*.test.js)
```

Pipeline tests: `pip install -r requirements-dev.txt && python -m pytest` (configured in `pyproject.toml`, tests in `tests/pipeline/`). CI (`.github/workflows/ci.yml`) runs lint + tests + build on every push/PR.

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

# Message Batches API: 50% token pricing, results within ~1h.
# The recommended mode for full runs (the workflow defaults to it).
python scripts/update_data.py --force --batch

# Web search for every country (not just priority) — always uses
# Sonnet 4.6; pair with --batch. ~$10-12 for a full 196-country run.
python scripts/update_data.py --force --batch --search-all

# Evidence-grounded research: inject each country's verified policy
# initiatives (OECD/GAIIN, from Supabase) into the prompt. Countries
# without evidence fall back to the plain prompt. Grounded prompts are
# longer — pair with --batch.
python scripts/update_data.py --force --batch --grounded

# Supabase dual-write mirror: auto-on when SUPABASE_URL and
# SUPABASE_SERVICE_KEY are set; force with --mirror / disable with
# --no-mirror. Mirror failures never fail a run.
```

Requests use structured outputs (`output_config.format`, schema generated from
the pydantic model via `models.ResearchResult.output_schema()`), so responses are
guaranteed schema-valid JSON — sub-scores arrive as ints 1–5 with all fields present.

Requires `ANTHROPIC_API_KEY` in environment. Install Python dependencies:

```bash
pip install -r requirements.txt
```

## Architecture

### Frontend (`src/`)

Vanilla TypeScript + D3.js + TopoJSON, built with Vite. No framework. Full
pattern write-up (layering + mermaid diagrams: pub-sub store, the
single-writer interactions orchestrator, the `mainView` FSM, selectors, the
typed DOM seam) lives in [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md).

**The frontend is fully TypeScript** (strict mode, `tsc --noEmit` in CI). Relative imports are extensionless. The state shape lives in the `AppState` interface in `src/state/store.ts`; data row shapes (`ScoreEntry`, `RegulationEntry`) in `src/data/loader.ts`; the score-dimension unions (`AttributeKey`, `DimensionKey`) in `src/constants.ts`. All state writes go through intents in `src/state/interactions.ts`; derived reads through `src/state/selectors.ts`.

**Module structure:**

| Directory | Purpose |
|-----------|---------|
| `src/main.ts` | Entry point — boots app, loads data, wires subscriptions |
| `src/state/store.ts` | Centralized state store with event bus (`getState`, `setState`, `on`) |
| `src/constants.ts` | Attribute labels, legend endpoints, score options, shared regex |
| `src/data/loader.ts` | CSV loading and parsing (scores + regulation data) |
| `src/data/history.ts` | History JSON loading and date-based score reconstruction |
| `src/data/changelog.ts` | Per-country score-change computation from history snapshots |
| `src/data/searchIndex.ts` | Full-text index + substring search over regulation text |
| `src/data/countryMatch.ts` | Shared country-name autocomplete matcher |
| `src/data/blocs.ts` | Bloc membership loading + aggregate stats (`computeBlocStats`) |
| `src/data/sources.ts` | Source URL classification (official vs other) + copy formatting + `SourceMeta` |
| `src/data/subscores.ts` | subscores.json loading + sub-indicator labels (methodology v2) |
| `src/data/supabase.ts` | Thin PostgREST reader (env-gated; null on any failure) |
| `src/data/hydrate.ts` | Post-boot dataset hydration when the database is strictly newer |
| `src/data/sourceMeta.ts` | Source titles/types from the sources database |
| `src/map/` | Map rendering (renderer, legend, zoom, tooltip) |
| `src/panel/` | Country detail panel (scores, text sections, changelog, search results, policy initiatives) |
| `src/comparison/` | Side-by-side comparison panel + radar chart |
| `src/scatter/` | Cross-dimension scatter plot with deterministic jitter + trend overlay (`stats.ts`) |
| `src/controls/` | UI controls (search, score selector, filter, blocs, export, share, timeline, URL sync, citations) |
| `src/styles/` | CSS partials imported via Vite (`_tokens`, `_header`, `_map`, `_panel`, etc.) |

**State management:** All mutable state lives in `src/state/store.ts` as a single object. Modules read state via `getState()` and write via `setState(patch)`. The store emits events per changed key, allowing modules to subscribe with `on(key, handler)`.

**Data flow:**
1. `main.ts` loads `scores.csv` and `regulation_data.csv` in parallel via `Promise.all`
2. Data is stored in the centralized state store
3. D3 renders a choropleth SVG world map; TopoJSON provides country geometries
4. User interactions dispatch state changes which trigger subscribed re-renders

### Backend (`scripts/regulation_pipeline/`)

Python package that calls the Claude API to research regulation status per country. Full architecture write-up with mermaid diagrams (layering, run sequence, domain model, strategy/repository patterns, staleness, batch lifecycle, retry) lives in [`scripts/regulation_pipeline/README.md`](scripts/regulation_pipeline/README.md). Layered around a few design patterns so the concerns stay separated and testable:

- **Domain models** (`models.py`) — pydantic v2 `ResearchResult` is the single source of truth: it generates the structured-output JSON schema, validates responses, and computes dimension means / maturity composite / confidence. Sub-indicator field names live in exactly one place.
- **Repository** (`repository.py`) — `Dataset` owns the four data stores that always travel together (scores/regulation/history/subscores); loads, applies a validated result, and saves them atomically (temp file + `os.replace`).
- **Strategy** (`strategies.py`) — `ResearchStrategy` with `SyncStrategy` and `BatchStrategy` behind one generator interface, so the orchestrator treats sync and batch identically.
- **Service** (`service.py`) — `PipelineService` orchestrates selection → research → validation → persistence, with no CLI/exit-code concerns, so it is unit-testable with a fake strategy.
- **Settings** (`config.py`) — paths are anchored to the repo root via `pathlib` (not the CWD) and injectable, so tests redirect all I/O to a temp dir.

| Module | Purpose |
|--------|---------|
| `cli.py` | Typer CLI entry point — flags, logging, dependency wiring, exit codes |
| `service.py` | `PipelineService` orchestrator (selection, apply loop, save) |
| `models.py` | Pydantic `ResearchResult` — schema + validation + score projections |
| `repository.py` | `Dataset` repository — load/apply/validate/atomic-save the four stores |
| `strategies.py` | `ResearchStrategy` ABC + `SyncStrategy` / `BatchStrategy` |
| `api.py` | `ResearchClient` — request params + response parsing (Claude transport) |
| `batch.py` | `BatchRunner` — Message Batches submit/poll/classify (50% token pricing) |
| `retry.py` | Reusable transient-error retry policy (backoff, Retry-After, fatal classification) |
| `prompt.py` | Research prompt template + rendering |
| `config.py` | `Settings` (repo-root paths) + constants (fields, staleness, priority countries) |
| `staleness.py` | `StalenessPolicy` — which countries need re-research |
| `history.py` | History snapshot append/change-detection |
| `names.py` | `CountryNames` — country-name normalization via alias map |
| `sources.py` | Source-URL classifier (Python port of `src/data/sources.ts`, kept behaviourally aligned) |
| `db/` | Supabase layer: `client.py` (httpx PostgREST wrapper), `mirror.py` (dual-write with run provenance), `seed.py` (one-shot bootstrap CLI) |
| `evidence/` | Evidence layer: OECD/GAIIN adapter, conservative country matching, sync CLI (`python -m regulation_pipeline.evidence`), HTML stripping |
| `errors.py` | `FatalAPIError` |

`scripts/update_data.py` is a thin shim that calls `regulation_pipeline.cli.main()`; after `pip install -e .` the `update-regulation-data` console command is equivalent, and `python -m regulation_pipeline` also works. All logging goes through the stdlib `logging` module. Pipeline logic is covered by `tests/pipeline/` (run `python -m pytest`).

### Data Files (in `public/`)

| File | Purpose |
|------|---------|
| `public/scores.csv` | Numeric scores (1–5) for 6 dimensions per country |
| `public/regulation_data.csv` | Text descriptions, laws, source URLs, confidence, last_updated |
| `public/history.json` | Timestamped snapshots of score data for timeline playback |
| `public/data/country_names.json` | Canonical country names with alias arrays for normalization |
| `public/data/blocs.json` | Bloc membership lists (EU, G7, G20, ASEAN, AU, BRICS+, NATO, OECD); names must exactly match `scores.csv` |
| `public/data/subscores.json` | Per-country sub-indicator audit trail (4 sub-scores per dimension, methodology v2) |
| `public/data/country_iso.json` | ISO 3166 alpha-2/alpha-3/numeric per dataset name (verified against the TopoJSON geometry ids by `tests/pipeline/test_country_iso.py`) |

These files are served as static assets by Vite (via `publicDir`) and copied unchanged to `dist/` on build.

### Supabase (system of record + researcher API)

Supabase Postgres holds the same data plus what static files can't: the
`policy_initiatives` evidence records (OECD.AI Policy Navigator / GAIIN), the
accumulating `sources` database, per-run provenance in `research_runs`, and
queryable `score_history`. **The static files remain the frontend's boot path**
— they are the database's published snapshot, refreshed by the pipeline's
dual-write mirror on every run (`db/mirror.py`; failures never fail a run).
The frontend reads Supabase only as progressive enhancement: post-boot
hydration when the DB is strictly newer, source titles, and the per-country
Policy Initiatives panel section — all of which degrade to today's behavior
when unconfigured or unreachable. Schema migrations live in
`supabase/migrations/`; RLS is public-SELECT everywhere, writes via the
service role only. Researcher-facing docs (REST + CSV export examples) are in
`public/data.html`.

Environment variables: frontend builds take optional `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` (see `.env.example`; anon key is RLS-read-only and
safe to expose). The pipeline/mirror/evidence sync take `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY` (GitHub Actions secrets — never in the frontend).

### Scoring Dimensions

Six attributes scored 1–5 (used in the score selector dropdown):
- **avg_score** — maturity index: mean of the three normative dimensions (regulation_status, policy_lever, enforcement_level)
- **regulation_status** — existence and maturity of regulation (normative)
- **policy_lever** — breadth of policy instruments (normative)
- **governance_type** — centralized↔distributed (descriptive — excluded from the composite)
- **actor_involvement** — narrow↔broad participation (descriptive — excluded from the composite)
- **enforcement_level** — enforcement rigor (normative)

**Methodology v2 (June 2026):** each dimension score is the mean of 4 named sub-indicators (integers 1–5, defined in the `RESEARCH_PROMPT` in `scripts/regulation_pipeline/prompt.py` and modeled in `models.py`), producing quarter-point decimals. Sub-scores are persisted to `public/data/subscores.json`. Calibration: 5 = the global frontier at scoring time, not perfection; governance_type and actor_involvement are explicitly scored as descriptive, not quality, scales. Full write-up in `public/methodology.html`.

### Automated Updates

`.github/workflows/update-data.yml` runs `update_data.py` on the 1st of each month (6am UTC) and auto-commits any changed CSV/JSON files in `public/`; with `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` secrets set it also dual-writes to Supabase, and with the repo variable `EVIDENCE_SYNC_ENABLED=true` it refreshes OECD evidence first and researches `--grounded`. It can also be triggered manually with optional country list, force flag, and model selection inputs. Requires `ANTHROPIC_API_KEY` set as a GitHub Actions secret. `.github/workflows/evidence-sync.yml` offers manual probe / sync-delta / sync-full dispatches for the evidence layer.

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
