# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Regulation Map is a data visualization web app showing global AI regulation status by country, paired with an automated Python/Claude API pipeline that researches and updates the data weekly.

## Running the App

```bash
npm install      # install dependencies
npm run dev      # start Vite dev server with HMR
npm run pages    # static country pages + sitemap (runs before build as `prebuild`)
npm run build    # production build to dist/
npm run preview  # preview production build
npm run lint       # ESLint (flat config in eslint.config.js)
npm run typecheck  # tsc --noEmit (strict; tsconfig.json)
npm test           # Vitest unit tests (tests/*.test.js)
npm run test:e2e   # Playwright smoke + axe checks (tests/e2e/) against the built preview; run after build
```

Pipeline tests: `pip install -r requirements-dev.txt && python -m pytest` (configured in `pyproject.toml`, tests in `tests/pipeline/`). CI (`.github/workflows/ci.yml`) runs on every push/PR: lint, typecheck, a `madge --circular` import check, Vitest and the build (frontend job); Playwright e2e against the build (e2e job); pytest and `ruff check scripts tests/pipeline` (pipeline job).

## Found something off? File an issue

If you notice anything wrong outside your task, file a GitHub issue for it
before you finish, even mid-way through other work: a bug, a flaky or
skipped test, a doc that no longer matches the code, odd data, a manual step
nobody did, a follow-up a PR promised. Notes left only in PR descriptions,
commit messages or chat replies get lost: #74 was a listed PR follow-up that
nobody picked up, and #59 and #61 to #64 were noticed during PRD work well
before anyone filed them.

- **Search first.** Check open and closed issues and open PRs. If it is
  already there, comment with the new evidence instead of filing a duplicate.
- **Verify, then file.** Reproduce it, or cite `file:line` and the input
  that breaks it. Say plainly when you could not reproduce it.
- **Use the bug form's sections** (`.github/ISSUE_TEMPLATE/bug-report.yml`):
  Problem, Steps to reproduce, Where (commit), Cause, Suggested fix, Test.
- **Label it** `bug`, `documentation` or `enhancement`. Add `decision` when
  the fix needs the maintainer to choose (a layout, a cost, a policy), and
  list the options with their tradeoffs and a recommended default. Add
  `maintainer-action` when only the maintainer can do it (a secret or repo
  variable, applying a migration to the live project, a workflow dispatch,
  a third-party account).
- **Fix in scope, file out of scope.** A small fix inside the files you are
  already changing goes in your PR with `Fixes #N`. Anything else gets an
  issue, and your PR stays the size it was.
- **No orphaned follow-ups.** Every "follow-up", "known limitation" or
  "not done" line in a PR description links an issue.

## Data Update Script

The defaults are the weekly run: every country, web search on, Message
Batches API (50% token pricing, results within ~1h), Opus 5. A full
196-country run costs ~$100 on Opus 5 or ~$50 on Sonnet 5; web search
results re-sent across search iterations dominate input tokens (measured
September 2026: ~140k input tokens and 11 searches per country on Opus 5).
Flags only opt out.

```bash
# Full weekly run (force + search + batch, default model)
python scripts/update_data.py

# Update specific countries
python scripts/update_data.py --countries "Germany,France,Japan"

# Only stale or low-confidence countries
python scripts/update_data.py --no-force

# Preview what would be updated without writing
python scripts/update_data.py --dry-run

# Use a specific Claude model
python scripts/update_data.py --model claude-sonnet-5

# Synchronous requests instead of the Batches API
python scripts/update_data.py --no-batch

# Research without web search (training data only)
python scripts/update_data.py --no-search

# Evidence-grounded research: inject each country's verified policy
# initiatives (OECD/GAIIN, from Supabase) into the prompt. Countries
# without evidence fall back to the plain prompt. Every run records each
# country's evidence coverage (see "Evidence coverage" below).
python scripts/update_data.py --grounded

# Supabase dual-write mirror: auto-on when SUPABASE_URL and
# SUPABASE_SERVICE_KEY are set; force with --mirror / disable with
# --no-mirror. Mirror failures never fail a run.

# Stability gate (default on): a score change lands only with new
# evidence or when it repeats on the next run (a held candidate counts for
# 14 days); held candidates live in public/data/pending.json. --no-gate
# applies every score; on a full run it needs a reason, recorded as a
# calibration break in history.json.
python scripts/update_data.py --no-gate --break-reason "Model switch to Opus 5"

# Rubric guard: prompt.RUBRIC_VERSION names the rubric generation. When the
# newest break in history.json is for an older rubric, the first full forced
# run records a break ("Switch to scoring rubric v3 (model ...)") and runs
# ungated by itself; partial runs stay gated and log that the break is due.
# Bump RUBRIC_VERSION only when the rubric changes (not for prompt context).

# --countries names resolve exactly, through the alias map, or
# case-insensitively; an unknown name exits 1 before any API call.

# Weekly changes digest (public/digest/): auto-on for scheduled runs
# (GITHUB_EVENT_NAME=schedule); force with --digest. One Claude request on
# the run's model; digest failures never fail a run.
python scripts/update_data.py --batch --digest

# Regenerate the digest for a past run from Supabase score_history
# (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY).
python -m regulation_pipeline.digest --run <research_runs.id>

# Gold set and drift check (always on): after each run the raw results for
# the ten gold countries (public/data/gold_set.json) are compared with the
# gold scores (drafts awaiting the maintainer's hand-check) and one row is
# appended to public/data/drift.json (mirrored to Supabase gold_checks).
# Never fails a run; a within-one share below 0.8 prefixes the step summary
# with "Calibration warning".
# Model comparison: research only the gold countries, print the metrics,
# write nothing (sync by default; --batch for the 50% pricing).
python -m regulation_pipeline.gold --model claude-sonnet-5
```

Requests use structured outputs (`output_config.format`, schema generated from
the pydantic model via `models.ResearchResult.output_schema()`), so responses are
guaranteed schema-valid JSON - every sub-indicator arrives as `{score, rationale}` with the
score an int 1–5 and all fields present (rationale length is checked in pydantic).

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
| `src/main.ts` | Entry point - boots app, loads data, wires subscriptions |
| `src/state/store.ts` | Centralized state store with event bus (`getState`, `setState`, `on`) |
| `src/constants.ts` | Attribute labels, legend endpoints, score options, shared regex |
| `src/data/loader.ts` | CSV loading and parsing (scores + regulation data) |
| `src/data/history.ts` | History JSON loading and date-based score reconstruction |
| `src/data/changelog.ts` | Per-country score-change computation from history snapshots |
| `src/data/searchIndex.ts` | Full-text index + substring search over regulation text |
| `src/data/countryMatch.ts` | Shared country-name autocomplete matcher |
| `src/data/blocs.ts` | Bloc membership loading + aggregate stats (`computeBlocStats`) |
| `src/data/peers.ts` | Peer sets for the panel's "Compare with" shortcuts (bloc, similar maturity, similar profile) |
| `src/data/sources.ts` | Source URL classification (official vs other) + copy formatting + `SourceMeta` |
| `src/data/subscores.ts` | subscores.json loading + sub-indicator labels (methodology v2) |
| `src/data/evidence.ts` | Evidence coverage (pure): `normalizeEvidence` for the subscores.json `evidence` record, `evidenceSentence` (panel and country pages), `matchesEvidenceFilter` / `parseEvidenceFilter` for the Evidence facet |
| `src/data/supabase.ts` | Thin PostgREST reader (env-gated; null on any failure) |
| `src/data/hydrate.ts` | Post-boot dataset hydration when the database is strictly newer: scores, text and the evidence record (overlaid on `subscores` for countries with a newer pass, whichever of the two loads first); sub-indicators stay from the static file |
| `src/data/sourceMeta.ts` | Source titles/types from the sources database |
| `src/data/slug.ts` | Country page slug and path (`/country/<slug>/`), shared by the app and the page generator |
| `src/data/countryIso.ts` | `country_iso.json` loading: ISO alpha-2/alpha-3 codes for the panel and print brief, and the ISO numeric -> dataset name index for the map join |
| `src/map/` | Map rendering (renderer, legend, zoom, tooltip) |
| `src/map/geometryNames.ts` | `resolveFeatureNames`: gives each world-atlas geometry the dataset's country name via its ISO numeric id where the atlas name differs ("Dominican Rep.") |
| `src/panel/` | Country detail panel (scores, text sections, changelog, search results, policy initiatives, evidence coverage: `evidence.ts` renders the sentence under the confidence line and links to the Policy Initiatives section) |
| `src/comparison/` | Side-by-side comparison panel + radar chart |
| `src/scatter/` | Cross-dimension scatter plot with deterministic jitter + trend overlay (`stats.ts`) |
| `src/controls/` | UI controls (search, score selector, filter incl. the Evidence facet, blocs and bloc summary incl. the grounded share, export, share, timeline, URL sync, citations, print brief, issue reporting, header menu, "this week" strip) |
| `src/data/digest.ts` | Weekly digest parsing + formatting helpers (pure; used by `src/changes.ts`, the `changes.html` entry) |
| `src/data/drift.ts` | Drift dashboard aggregations (pure): countries changed per run by dimension, delta bins, confidence by vintage, drift.json and `research_runs` parsing, per-bloc shares |
| `src/charts/drift.ts` | The drift dashboard's D3 small multiples (token-driven palette, hover tooltips); `src/drift.ts` is the `drift.html` entry |
| `src/styles/` | CSS partials imported via Vite (`_tokens`, `_header`, `_map`, `_panel`, etc.) |

**State management:** All mutable state lives in `src/state/store.ts` as a single object. Modules read state via `getState()` and write via `setState(patch)`. The store emits events per changed key, allowing modules to subscribe with `on(key, handler)`.

**Data flow:**
1. `main.ts` loads `scores.csv` and `regulation_data.csv` in parallel via `Promise.all`
2. Data is stored in the centralized state store
3. D3 renders a choropleth SVG world map; TopoJSON provides country geometries
4. User interactions dispatch state changes which trigger subscribed re-renders

### Backend (`scripts/regulation_pipeline/`)

Python package that calls the Claude API to research regulation status per country. Full architecture write-up with mermaid diagrams (layering, run sequence, domain model, strategy/repository patterns, staleness, batch lifecycle, retry) lives in [`scripts/regulation_pipeline/README.md`](scripts/regulation_pipeline/README.md). Layered around a few design patterns so the concerns stay separated and testable:

- **Domain models** (`models.py`) - pydantic v2 `ResearchResult` is the single source of truth: it generates the structured-output JSON schema, validates responses, and computes dimension means / maturity composite / confidence. Sub-indicator field names live in exactly one place.
- **Repository** (`repository.py`) - `Dataset` owns the five data stores that always travel together (scores/regulation/history/subscores/pending); loads, applies a validated result, and saves them atomically (temp file + `os.replace`).
- **Strategy** (`strategies.py`) - `ResearchStrategy` with `SyncStrategy` and `BatchStrategy` behind one generator interface, so the orchestrator treats sync and batch identically.
- **Service** (`service.py`) - `PipelineService` orchestrates selection → research → validation → persistence, with no CLI/exit-code concerns, so it is unit-testable with a fake strategy.
- **Settings** (`config.py`) - paths are anchored to the repo root via `pathlib` (not the CWD) and injectable, so tests redirect all I/O to a temp dir.

| Module | Purpose |
|--------|---------|
| `cli.py` | Typer CLI entry point - flags, logging, dependency wiring, exit codes |
| `service.py` | `PipelineService` orchestrator (selection, apply loop, save) |
| `models.py` | Pydantic `ResearchResult` - schema + validation + score projections |
| `repository.py` | `Dataset` repository - load/apply/validate/atomic-save the five stores |
| `strategies.py` | `ResearchStrategy` ABC + `SyncStrategy` / `BatchStrategy` |
| `api.py` | `ResearchClient` - request params + response parsing (Claude transport); resumes `pause_turn` responses (web search's server-side loop limit) up to 3 times, and rejects `max_tokens`/`refusal` answers with the stop reason logged |
| `batch.py` | `BatchRunner` - Message Batches submit/poll/classify (50% token pricing). Every call goes through the retry policy; one 4h wait budget covers all batches of a run (the job has 355 min); follow-up batches resubmit transient failures once and continue `pause_turn` results (up to 3 rounds); already-billed results are never resubmitted |
| `retry.py` | Reusable transient-error retry policy (backoff, Retry-After capped at 120s; 400/413/422 fail the one request, other 4xx are fatal) |
| `prompt.py` | Research prompt template + rendering |
| `config.py` | `Settings` (repo-root paths) + constants (CSV fields, staleness threshold, site URL, default model) |
| `staleness.py` | `StalenessPolicy` - which countries need re-research |
| `gate.py` | Stability gate - evidence and persistence rules for score changes |
| `digest.py` | Weekly digest: selects a run's gate-applied changes, one structured-output Claude request, writes `public/digest/` (week JSON, index, Atom feed); `python -m regulation_pipeline.digest --run <id>` regenerates from Supabase |
| `gold.py` | Gold set and drift check: loads `gold_set.json`, compares a run's raw (ungated) results with it (`compare`, pure), appends `drift.json`, mirrors `gold_checks`, step-summary block; `python -m regulation_pipeline.gold --model <id>` is the model-comparison CLI |
| `history.py` | History snapshot append/change-detection: a snapshot is a change-point (an unchanged re-research leaves history alone; a same-day re-run supersedes that day's snapshot); `calibration_due` for the rubric guard |
| `names.py` | `CountryNames` - country-name normalization via alias map |
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
| `public/history.json` | Change-point score snapshots per country (a snapshot's `date` is the run that produced those scores; the timeline, changelog, "This week" strip and drift dashboard all read it that way), plus `breaks` (calibration breaks: `{date, model, prompt_version, rubric, reason}`; the June 2026 methodology v2 break is the first) |
| `public/data/country_names.json` | Canonical country names with alias arrays for normalization |
| `public/data/blocs.json` | Bloc membership lists (EU, G7, G20, ASEAN, AU, BRICS+, NATO, OECD); names must exactly match `scores.csv` |
| `public/data/subscores.json` | Per-country sub-indicator audit trail (4 sub-scores per dimension, methodology v2; `{score, rationale}` per sub-indicator since v2.1), plus the `evidence` record of each country's latest research pass (PRD 14; absent = no run record yet) |
| `public/data/pending.json` | Score candidates the stability gate held for one run (`{country, candidate_scores, first_seen}`) |
| `public/data/gold_set.json` | Gold sub-indicator scores for ten countries across the maturity range: 20 scores, a justification per dimension, sources, and `status` (`draft` until the maintainer verifies, then `verified` + `verified_on`). All ten are drafts awaiting the maintainer's hand-check (September 2026). Validated by `gold.load_gold_set` |
| `public/data/drift.json` | One row per run from the gold-set drift check: `{run_id, date, model, prompt_version, countries_compared, countries_missing, mae_by_dimension, within_one, max_dev, max_dev_at}`. Mirrored to Supabase `gold_checks` |
| `public/data/country_iso.json` | ISO 3166 alpha-2/alpha-3/numeric per dataset name (verified against the TopoJSON geometry ids by `tests/pipeline/test_country_iso.py`) |
| `public/data/countries-110m.json` | Self-hosted world-atlas TopoJSON (Natural Earth 1:110m) the map draws; geometry ids are ISO 3166-1 numeric, and the map joins them to dataset names through `country_iso.json` |
| `public/openapi.json` | Committed snapshot of PostgREST's OpenAPI output; drives the Swagger UI at `api-docs.html` (Supabase serves the live spec endpoint only to secret keys, so the browser can never fetch it) |
| `public/digest/` | Weekly changes digest: `YYYY-Www.json` per run week, `index.json` (weeks, newest first), `feed.xml` (Atom). Written by the pipeline after scheduled runs; rendered by `changes.html` |
| `public/data/country_slugs.json` | Slug -> canonical name for the static country pages; generated by `scripts/build_pages.ts`, committed so API consumers can resolve `/country/<slug>/` |
| `public/country/` | Generated static country pages (`<slug>/index.html` per country plus an index); gitignored, written by `npm run pages` |
| `public/sitemap.xml` | Generated sitemap (top-level pages + every country page); gitignored, written by `npm run pages`. `public/robots.txt` points at it |

These files are served as static assets by Vite (via `publicDir`) and copied unchanged to `dist/` on build.

Refresh `public/openapi.json` whenever a schema migration lands (needs the secret key, so run it locally, never in the frontend):

```bash
curl -sS -H "apikey: $SUPABASE_SERVICE_KEY" \
  "$SUPABASE_URL/rest/v1/" | jq . > public/openapi.json
```

Display fixes (title, host, dropping write verbs) are applied at load time in `src/apiDocs.ts`, so a plain refresh never loses them.

### Issue reporting (`src/controls/report.ts`)

The panel's "Report an issue" action opens the GitHub issue form
`.github/ISSUE_TEMPLATE/data-error.yml` in a new tab with the country and
the entry as shown (scores, confidence, the evidence coverage sentence once
the country has a run record, last updated, data version, the APA citation
string, the app URL, the source list, and the sub-indicator rows in a
collapsed block once rationales exist) already filled in. GitHub prefills
form fields from query parameters named after the field ids, so the URL
carries `template`, `title`, `labels`, `country` and `entry`; the free-text
`body` parameter only applies to Markdown templates. The entry sheds detail
(unlisted sources with a count, then rationales, then the sub-indicator
block) to stay under 6,000 characters and 7,000 encoded, well inside
GitHub's URL limit. Nothing but on-screen data is sent. Reports do not
trigger re-research; `CONTRIBUTING.md` ("Data issues") describes how a fix
flows through the pipeline.

### Drift dashboard (`drift.html`, `src/drift.ts`)

A static report of how much the dataset moves per research run and how
confident it is: countries changed per run stacked by the dimension that
moved most, the distribution of score deltas per run (a run-by-quarter-point
heat grid), confidence by research vintage, the gold-set agreement per run
(when `public/data/drift.json` carries checks), and a bloc-by-run grid of the
share of members changed. Below the figures, a "Latest run" section shows
the run's provenance and gate tally from `research_runs` (Supabase, only when
`VITE_SUPABASE_*` is set; otherwise what the files record) and the ten
largest moves with app deep links. Sources: `history.json` (movement, via
`computeChangelog`), `regulation_data.csv` (confidence), `data/drift.json`,
`data/blocs.json`. Aggregations live in `src/data/drift.ts` (pure, tested in
`tests/drift.test.js`); charts in `src/charts/drift.ts` read the tokens at
render time (`cssVar`), use one single-hue ramp off `--score-high` for
ordered series and neutral tints for the rest, and re-render on theme
change and resize. Every figure has a caption with the key numbers and a
"Show as a table" twin. The page renders with any source missing (each
figure has an empty state). Linked from the app header menu, `data.html`
and `changes.html`; listed in the sitemap.

### Static country pages (`scripts/build_pages.ts`)

Every country has a JavaScript-free reference page at `/country/<slug>/`.
`npm run pages` (the npm `prebuild` step, so `npm run build` always runs it)
reads the data files in `public/`, renders one HTML document per row of
`scores.csv`, and writes them to `public/country/`, which Vite copies to
`dist/`. The template is one function that returns a string; there is no
template engine. It reuses the app's CSV parsers (`src/data/loader.ts`),
the source classifier, the sub-indicator labels, and the display-time text
cleanup, so a page shows what the panel shows. Each page carries a canonical
URL, Open Graph tags, and JSON-LD `Dataset` markup with the six scores as
`variableMeasured`. The panel's "Permanent link" button copies the page URL
for the selected country. Slugs come from `src/data/slug.ts`
(lowercase ASCII, hyphens: `Côte d'Ivoire` -> `cote-divoire`). Pages
show the evidence coverage sentence as plain text (no link).

### Supabase (system of record + researcher API)

Supabase Postgres holds the same data plus what static files can't: the
`policy_initiatives` evidence records (OECD.AI Policy Navigator / GAIIN), the
accumulating `sources` database, per-run provenance in `research_runs`, and
queryable `score_history`. **The static files remain the frontend's boot path**:
they are the database's published snapshot, refreshed by the pipeline's
dual-write mirror on every run (`db/mirror.py`; failures never fail a run).
The frontend reads Supabase only as progressive enhancement: post-boot
hydration when the DB is strictly newer, source titles, and the per-country
Policy Initiatives panel section - all of which degrade to today's behavior
when unconfigured or unreachable. Source titles are a read path only so far:
`src/data/sourceMeta.ts` fetches rows with a title, but no code in the
repository writes `sources.title` yet, so the panel shows hostnames. Schema
migrations live in `supabase/migrations/`; RLS is public-SELECT everywhere, writes via the
service role only. Researcher-facing docs live at `public/data.html` (static
overview: downloads, endpoint table, recipe links) and `api-docs.html`
(Swagger UI over the committed `public/openapi.json` snapshot; interactive
"Try it out" querying lives here). Both docs pages share the app's theme
token (`localStorage.theme`) and have their own toggle.

Environment variables: frontend builds take optional `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` (see `.env.example`; anon key is RLS-read-only and
safe to expose). The pipeline/mirror/evidence sync take `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY` (GitHub Actions secrets - never in the frontend).

### Evidence coverage (PRD 14)

Every applied result records how the country's latest research pass was
grounded, including results the stability gate holds (the record describes
the pass behind the entry's text, sources and confidence). In
`subscores.json` it is `countries.<name>.evidence = {grounded,
initiatives_used, search, model, run_id}`; in Supabase it is
`country_scores.grounded` / `initiatives_used` / `web_search` (migration
`0008_evidence_coverage.sql`, also appended to `public_export`; the model is
`research_runs.model` via `run_id`). `initiatives_used` is the number of
verified initiatives embedded in the prompt (capped at 15): `0` = the run
consulted the evidence database and it held none, `null` = the run did not
consult it (not `--grounded`), so the panel never claims "no verified
initiatives on record" for a run that did not look. `grounded` is always
`initiatives_used > 0` with null counted as 0 (a check constraint in the
database). No record (no
key, or all three columns null) = not researched since PRD 14; the panel
then shows nothing. The panel sentence (`evidenceSentence`) reads "Grounded
in 7 verified policy initiatives and web search" (or "...; no web search"
without search); an ungrounded pass reads "Web search only" or "No web
search", followed by "; no verified initiatives on record" (`0`) or ";
verified initiatives not consulted" (`null`). The filter's Evidence facet
(any / grounded / search only, URL parameter `evidence=grounded|search`)
composes with the confidence and official-source filters in
`passesCountryFilters`; the bloc summary shows the bloc's grounded share. The JSON export carries the record under its own
`Evidence` key, and the issue report adds the sentence. There is no evidence
colour mode on the map. Migration 0008 is applied to the live project
(September 2026).

### Scoring Dimensions

Six attributes scored 1–5 (used in the score selector dropdown):
- **avg_score** - maturity index: mean of the three normative dimensions (regulation_status, policy_lever, enforcement_level)
- **regulation_status** - existence and maturity of regulation (normative)
- **policy_lever** - breadth of policy instruments (normative)
- **governance_type** - centralized↔distributed (descriptive - excluded from the composite)
- **actor_involvement** - narrow↔broad participation (descriptive - excluded from the composite)
- **enforcement_level** - enforcement rigor (normative)

**Rubric v3 (September 2026):** the calibration block uses fixed anchors. Each level describes an observable state, and a 5 no longer means "the global frontier today", so scores compare across time. `PROMPT_VERSION` was `v3-2026-09` for the rubric switch, `v3.1-2026-09` once the v2.1 rationale field changed the output structure, and is `v3.2-2026-09` since the existing-data block also shows the Enforcement Level text (context only; same rubric). `RUBRIC_VERSION = "v3"` is what the rubric guard compares. The switch is recorded as a calibration break in `history.json` (`breaks`) by the first full v3 run (automatically, via the guard), which the timeline marks and the changelog labels as "Recalibration". Until that run lands, all scores are rubric v2.

**Methodology v2 (June 2026):** each dimension score is the mean of 4 named sub-indicators (integers 1–5, defined in the `RESEARCH_PROMPT` in `scripts/regulation_pipeline/prompt.py` and modeled in `models.py`), producing quarter-point decimals. Sub-scores are persisted to `public/data/subscores.json`. **Methodology v2.1 (September 2026):** every sub-indicator also carries a one-sentence `rationale` (1–200 characters, validated in pydantic; the structured-output schema requires the field but cannot express length). The pipeline writes `{score, rationale}` per sub-indicator and a top-level `methodology: "v2.1"` tag from the first v2.1 run on (entries researched before keep v2 integers); the frontend loader (`src/data/subscores.ts`) accepts both v2 integers and v2.1 objects. Supabase mirrors rationales into `country_scores.rationales` (jsonb). governance_type and actor_involvement are explicitly scored as descriptive, not quality, scales. Full write-up in `public/methodology.html`.

### Automated Updates

`.github/workflows/update-data.yml` runs `update_data.py` every Monday (6am UTC) with the pipeline defaults, so every country is re-researched with web search each week (~$100 per run on Opus 5), and auto-commits any changed CSV/JSON files in `public/` (including the gold-set drift row in `public/data/drift.json`). If main moved during the run the commit is rebased and retried, and if it still fails every output file is uploaded as a workflow artifact; with `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` secrets set it also dual-writes to Supabase, and with the repo variable `EVIDENCE_SYNC_ENABLED=true` it refreshes OECD evidence first and researches `--grounded`. It can also be dispatched manually with eight inputs: `countries`, `model` and `break_reason` (text), `force_update`, `search`, `batch` and `gate` (on by default; off passes the matching `--no-*` flag), and `digest` (off by default; on passes `--digest`). Requires `ANTHROPIC_API_KEY` set as a GitHub Actions secret. `.github/workflows/evidence-sync.yml` offers manual probe / sync-delta / sync-full dispatches for the evidence layer.

### Deployment

Hosted on Cloudflare Pages. Build command: `npm run build`, output directory: `dist`.

## Design Context

### Users

Policy researchers, academics, policymakers, and civil society actors working on AI governance. Typical context: desk research during working hours, cross-referencing country postures, pulling citations for briefs and papers, benchmarking one jurisdiction against peers. Reads carefully, distrusts marketing gloss, wants to verify claims against sources.

**Job to be done:** quickly form an accurate, comparable mental model of how different countries regulate AI across six dimensions - and get from that model to primary sources without friction.

### Brand Personality

**Three words:** rigorous, calm, global. Tone is measured authority - closer to a reference work than to a product. Treats the reader as a peer. Emotional goal is trust: the researcher should feel they can cite this in a footnote without apologizing.

### Aesthetic Direction

Contemporary data-viz - Observable, MIT Media Lab, The Pudding's restrained pieces, Our World in Data with more current typography. Technical confidence without being cold.

- Ship both light and dark themes with a persistent user toggle. Light is the default for citation-friendly daylight reading.
- Map is the protagonist; all UI chrome must justify its visual weight against it.
- Typography pairs a distinctive display/serif or grot with a precise neutral sans. Do not reach for Inter, IBM Plex, Fraunces, Space Grotesk, etc. - look further.
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
