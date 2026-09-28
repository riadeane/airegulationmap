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
# run records a break ("Switch to scoring rubric v3.1 (model ...)") and runs
# ungated by itself; partial runs stay gated and log that the break is due.
# Bump RUBRIC_VERSION only when the rubric changes (not for prompt context).

# --countries names resolve exactly, through the alias map, or
# case-insensitively; an unknown name exits 1 before any API call.

# Link check (default on): every cited URL is fetched after research; dead
# ones (404, 410, a not-found page, the dead oecd.ai country-dashboard
# pattern) are dropped before writing, and a result left with no source is
# capped at low confidence. Blocked or unreachable URLs are kept. Live pages'
# titles go to Supabase sources.title.
python scripts/update_data.py --no-link-check

# Link-rot report over the published CSV (Markdown; the monthly
# link-check.yml workflow opens or updates a "Dead source links" issue with
# it), and a one-off fill of sources.title for untitled rows.
python -m regulation_pipeline.links report
python -m regulation_pipeline.links titles

# Weekly changes digest (public/digest/): auto-on for scheduled runs
# (GITHUB_EVENT_NAME=schedule); force with --digest. One Claude request on
# the run's model; digest failures never fail a run.
python scripts/update_data.py --batch --digest

# Regenerate the digest for a past run from Supabase score_history
# (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY). It reads the
# run's calibration break from research_runs.calibration_break (migration
# 0012) and covers score changes only (the page says so).
python -m regulation_pipeline.digest --run <research_runs.id>

# Gold set and drift check (always on): after each run the raw results for
# the ten gold countries (public/data/gold_set.json) are compared with the
# gold scores (drafts awaiting the maintainer's hand-check) and one row is
# appended to public/data/drift.json (mirrored to Supabase gold_checks).
# Never fails a run; a within-one share below 0.8, or a dimension whose mean
# signed error (run minus gold) is beyond 0.5 either way, prefixes the step
# summary with "Calibration warning".
# Model comparison: research only the gold countries, print the metrics,
# write nothing (sync by default; --batch for the 50% pricing).
python -m regulation_pipeline.gold --model claude-sonnet-5
```

Requests use structured outputs (`output_config.format`, schema generated from
the pydantic model via `models.ResearchResult.output_schema()`), so responses are
guaranteed schema-valid JSON - every sub-indicator arrives as `{score, rationale}` with the
score an int 1–5 or null (insufficient evidence, rubric v3.1: `anyOf` enum-or-null, still
required) and all fields present (rationale length is checked in pydantic).

Requires `ANTHROPIC_API_KEY` in environment. Install Python dependencies:

```bash
pip install -r requirements.txt
```

`requirements.txt` is a pip-compile lock (every package pinned) compiled from
`requirements.in` (the direct dependencies as ranges), so the weekly run
installs exactly what CI tested (#98). Edit `requirements.in`, then
recompile on Python 3.12: `pip-compile --output-file=requirements.txt
--strip-extras requirements.in`. Dependabot's pip updates recompile it.

## Architecture

### Frontend (`src/`)

Vanilla TypeScript + D3.js + TopoJSON, built with Vite. No framework. Full
pattern write-up (layering + mermaid diagrams: pub-sub store, the
single-writer interactions orchestrator, the `mainView` FSM, selectors, the
typed DOM seam) lives in [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md).

**The frontend is fully TypeScript** (strict mode, `tsc --noEmit` in CI). Relative imports are extensionless. The state shape lives in the `AppState` interface in `src/state/store.ts`; data row shapes (`ScoreEntry`, `RegulationEntry`) in `src/data/loader.ts`; the score-dimension unions (`AttributeKey`, `DimensionKey`) and the score vocabulary (`ATTRIBUTES`, `GROUPS`; see "Score meaning" below) in `src/constants.ts`. All state writes go through intents in `src/state/interactions.ts`; derived reads through `src/state/selectors.ts`.

**Module structure:**

| Directory | Purpose |
|-----------|---------|
| `src/main.ts` | Entry point - boots app, loads data, wires subscriptions |
| `src/state/store.ts` | Centralized state store with event bus (`getState`, `setState`, `on`) |
| `src/constants.ts` | The score vocabulary, one record per attribute (`ATTRIBUTES`: `{label, group, question, low, high, notClaim}` plus the bloc card's end labels) and per lens (`GROUPS`), from which `ATTRIBUTE_LABELS`, `LEGEND_ENDPOINTS` and `SCORE_OPTIONS` derive; `IMPLEMENTATION_LEVELS` (the v3 ladder in plain words); shared regex |
| `src/data/meaning.ts` | The strings each surface shows about a score (pure): tooltip line, legend caption, live-region sentence, bloc card end labels, panel captions, sub-indicator level meanings, the #96 "No AI governance activity observed" rule, API docs column descriptions |
| `src/data/loader.ts` | CSV loading and parsing (scores + regulation data) |
| `src/data/history.ts` | History JSON loading and date-based score reconstruction |
| `src/data/changelog.ts` | Per-country score-change computation from history snapshots |
| `src/data/searchIndex.ts` | Full-text index + substring search over regulation text |
| `src/data/countryMatch.ts` | Shared country-name autocomplete matcher |
| `src/data/blocs.ts` | Bloc membership loading + aggregate stats (`computeBlocStats`) |
| `src/data/peers.ts` | Peer sets for the panel's "Compare with" shortcuts (bloc members closest in implementation index, similar implementation, similar profile) |
| `src/data/sources.ts` | Source URL classification (official vs other) + copy formatting + `SourceMeta` |
| `src/data/subscores.ts` | subscores.json loading + sub-indicator labels (methodology v2) + the governance style sub-indicators' 1/3/5 anchors (`STYLE_ANCHORS`) |
| `src/data/evidence.ts` | Evidence coverage (pure): `normalizeEvidence` for the subscores.json `evidence` record, `evidenceSentence` (panel and country pages), `matchesEvidenceFilter` / `parseEvidenceFilter` for the Evidence facet |
| `src/data/supabase.ts` | Thin PostgREST reader (env-gated; null on any failure) |
| `src/data/hydrate.ts` | Post-boot dataset hydration when the database is strictly newer: scores, text and the evidence record (overlaid on `subscores` for countries with a newer pass, whichever of the two loads first); sub-indicators stay from the static file |
| `src/data/sourceMeta.ts` | Source titles/types from the sources database |
| `src/data/slug.ts` | Country page slug and path (`/country/<slug>/`), shared by the app and the page generator |
| `src/data/countryIso.ts` | `country_iso.json` loading: ISO alpha-2/alpha-3 codes for the panel and print brief, and the ISO numeric -> dataset name index for the map join |
| `src/map/` | Map rendering (renderer, the HTML legend, zoom, tooltip, low-confidence hatch pattern in `hatch.ts`, the two ramps in `ramp.ts`) |
| `src/map/countryTable.ts` | The map as a table for keyboard and screen-reader users (#139): visually hidden until focus enters it, sortable, roving tabindex |
| `src/map/geometryNames.ts` | `resolveFeatureNames`: gives each world-atlas geometry the dataset's country name via its ISO numeric id where the atlas name differs ("Dominican Rep.") |
| `src/panel/` | Country detail panel (scores, text sections, changelog, search results, policy initiatives, evidence coverage: `evidence.ts` renders the sentence under the confidence line and links to the Policy Initiatives section) |
| `src/comparison/` | Side-by-side comparison panel + radar chart |
| `src/scatter/` | Cross-dimension scatter plot with deterministic jitter + trend overlay (`stats.ts`) |
| `src/controls/` | UI controls (search, grouped score selector, filter incl. the Evidence facet, blocs and bloc summary incl. the grounded share, export, share, timeline, URL sync, citations, print brief, issue reporting, header menu, "this week" strip, "Show uncertainty" toggle, the "How to read this map" dialog in `helpOverlay.ts`) |
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

- **Domain models** (`models.py`) - pydantic v2 `ResearchResult` is the single source of truth: it generates the structured-output JSON schema, validates responses, and computes dimension means / the composite (the implementation index) / confidence. Sub-indicator field names live in exactly one place.
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
| `consistency.py` | Post-run EU consistency check (#95): lists EU members whose `regulation_status.binding_force` or `ai_specificity` (fixed by the AI Act for every member) differs from the EU's most common score, as `eu:` log lines and a step-summary table. Never changes a score |
| `links.py` | Source link check (#92): `LinkChecker` fetches each cited URL once per run and drops dead ones (404/410, a redirect to or a 200 not-found page, known-bad patterns) before gating; 401/403/429/5xx/timeouts stay. Reads live pages' titles for `sources.title` (#143). `python -m regulation_pipeline.links report|titles` |
| `gold.py` | Gold set and drift check: loads `gold_set.json`, compares a run's raw (ungated) results with it (`compare`, pure), appends `drift.json`, mirrors `gold_checks`, step-summary block; `python -m regulation_pipeline.gold --model <id>` is the model-comparison CLI |
| `history.py` | History snapshot append/change-detection: a snapshot is a change-point in the scores or the confidence (an unchanged re-research leaves history alone; a same-day re-run supersedes that day's snapshot; a gate-held result with a new confidence appends a snapshot copying the held scores); `calibration_due` for the rubric guard |
| `names.py` | `CountryNames` - country-name normalization via alias map |
| `sources.py` | Source-URL classifier (Python port of `src/data/sources.ts`, kept behaviourally aligned) |
| `db/` | Supabase layer: `client.py` (httpx PostgREST wrapper), `mirror.py` (dual-write with run provenance), `seed.py` (one-shot bootstrap CLI) |
| `evidence/` | Evidence layer: OECD/GAIIN adapter, conservative country matching, sync CLI (`python -m regulation_pipeline.evidence`), HTML stripping |
| `errors.py` | `FatalAPIError` |

`scripts/update_data.py` is a thin shim that calls `regulation_pipeline.cli.main()`; after `pip install -e .` the `update-regulation-data` console command is equivalent, and `python -m regulation_pipeline` also works. All logging goes through the stdlib `logging` module. Pipeline logic is covered by `tests/pipeline/` (run `python -m pytest`).

### Data Files (in `public/`)

| File | Purpose |
|------|---------|
| `public/scores.csv` | Numeric scores (1–5) for 6 dimensions per country; an empty cell is "insufficient evidence" (rubric v3.1), distinct from a country with no row ("no data") |
| `public/regulation_data.csv` | Text descriptions, laws, source URLs, confidence, last_updated |
| `public/history.json` | Change-point score snapshots per country (a dimension or `averageScore` may be `null`, insufficient evidence; a snapshot's `date` is the run that produced those scores; the timeline, changelog, "This week" strip and drift dashboard all read it that way; each snapshot also records the run's `confidence`, and a confidence-only change appends a snapshot with the same scores, which the changelog, strip and dashboard skip; snapshots from before September 2026 carry no `confidence` and are not backfilled), plus `breaks` (calibration breaks: `{date, model, prompt_version, rubric, reason, complete}`, recorded only when the run applied something; `complete: false` means some countries kept older-rubric scores, so the rubric guard still treats the switch as due; the June 2026 methodology v2 break is the first) |
| `public/data/country_names.json` | Canonical country names with alias arrays for normalization |
| `public/data/blocs.json` | Bloc membership lists (EU, G7, G20, ASEAN, AU, BRICS+, NATO, OECD); names must exactly match `scores.csv` |
| `public/data/subscores.json` | Per-country sub-indicator audit trail (4 sub-scores per dimension, methodology v2; `{score, rationale}` per sub-indicator since v2.1, `score: null` for insufficient evidence since rubric v3.1), plus the `evidence` record of each country's latest research pass (PRD 14; absent = no run record yet) |
| `public/data/pending.json` | The stability gate's state: `pending`, the score candidates it held for one run (`{country, candidate_scores, first_seen}`; a candidate score may be `null`), and `seen_sources`, every source URL each country has cited (normalised), so a re-cited URL is not new evidence |
| `public/data/gold_set.json` | Gold sub-indicator scores for ten countries across the range of the implementation index: 20 scores, a justification per dimension, sources, and `status` (`draft` until the maintainer verifies, then `verified` + `verified_on`). All ten are drafts awaiting the maintainer's hand-check (September 2026). Validated by `gold.load_gold_set` |
| `public/data/drift.json` | One row per run from the gold-set drift check: `{run_id, date, model, prompt_version, countries_compared, countries_missing, mae_by_dimension, bias_by_dimension, within_one, max_dev, max_dev_at}`; `bias_by_dimension` is the mean signed error (run minus gold), absent on rows from before #163. Mirrored to Supabase `gold_checks` |
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

### Uncertainty on the map (`src/map/hatch.ts`, `src/controls/uncertainty.ts`)

Countries whose confidence is `low` carry a diagonal hatch over their score
fill: one `<pattern id="hatch-low">` in the map SVG's `<defs>` and a second
fill layer (`.hatch-layer`, pointer-events off) that repeats each hatched
country's path above the countries. Hatch paths draw no border; a hatched
country's selected, compared, search-match or hover outline is repeated on
its hatch path so the texture never stripes it. The marks use
`--map-stroke` at `--hatch-opacity` (per theme, `_tokens.css`), kept below
border strength. The pattern counter-scales with the zoom factor (snapped
to quarter-octave steps so a zoom animation re-records it only a few
times), so the lines stay about 4 px apart on screen at every zoom level. The hatch follows
`isLowConfidenceAtDate()` (`state/selectors.ts`): the snapshot's
`confidence` at the timeline date when `history.json` records one, else the
current confidence, in which case the legend adds "(current rating)".
"No data" countries are never hatched. The legend shows "Hatched: low
confidence"; the tooltip title adds "low confidence". The "Show
uncertainty" checkbox (filter popover, below "Reset filters", on by
default) is a per-browser display preference in `localStorage`
(`showUncertainty`); the URL does not carry it and "Reset filters" leaves
it alone.

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
when unconfigured or unreachable. Source titles: the pipeline's link check reads each live cited page's
title (`og:title`, else `<title>`) and the mirror writes it to
`sources.title` (an untitled row never overwrites a stored title);
`python -m regulation_pipeline.links titles` (or the link-check workflow's
`titles` dispatch) fills rows from before. `src/data/sourceMeta.ts` reads
them, and the panel shows hostnames for untitled sources. Schema
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
- **avg_score** - the implementation index (displayed "Implementation Index"; called the maturity index before PRD 16): mean of the three normative dimensions (regulation_status, policy_lever, enforcement_level). Data field names (`avg_score`, `averageScore`, the `Average Score` CSV/export column) are unchanged
- **regulation_status** - how much binding, AI-specific regulation is in force (normative)
- **policy_lever** - breadth of policy instruments in use (normative)
- **governance_type** - centralised↔distributed (descriptive - excluded from the composite)
- **actor_involvement** - narrow↔broad participation (descriptive - excluded from the composite)
- **enforcement_level** - enforcement activity observed (normative)

### Score meaning (PRD 16)

A score says how much is in force, or how a country governs; never that one
country regulates better than another. User-facing copy groups the
attributes into two lenses: **Implementation** (the index, regulation status,
policy lever, enforcement level: "how much is in force, not how good it
is") and **Governance style** (governance type, actor involvement: "how, not
how well"). "Normative" and "descriptive" stay in code and in the
methodology's technical section. The vocabulary lives once in
`src/constants.ts` (`ATTRIBUTES`, `GROUPS`) and every surface reads it: the
grouped score selector (each option with its `question`), the HTML legend
(ramp, endpoints in words, question, `notClaim`, "What does this mean?"),
the tooltip line ("Implementation Index: 4.25 / 5, how much is in force"),
the live region, the panel's group captions and sub-indicator level
meanings, the bloc card ("Most in force", "Most centralised"), the
comparison (radar plots implementation only; governance style is a
position strip; table rows under lens headings), the scatter key, the JSON
export's `meta` block (the export is now `{meta, countries}`; CSV columns
unchanged), the static pages (`scripts/build_pages.ts`) and the API docs
(load-time fixes in `src/apiDocs.ts`). There is no rank anywhere, and change
arrows use one neutral colour (`--change-mark`). Two ramps in
`src/styles/_tokens.css`: `--ramp-impl-low/high` (one blue hue, light = less
in force, dark = more) and `--ramp-style-low/high` (neutral stone); neither
uses red. "How to read this map" is the `#help-overlay` dialog (guide first,
keyboard shortcuts second), opened by any `[data-explainer]` control, the
header ? button and the ? key. Where every implementation dimension is 1 the
panel shows "No AI governance activity observed" instead of a governance
type score (#96, display only). The header folds its page links (below
1,440px), the freshness metadata (below 1,280px) and Export/Share (below
960px) behind the menu toggle (#73). `tests/copyAudit.test.js` fails if
"rank", "highest", "lowest", "best", "leading", "weak", "strong",
"comprehensive", "mature" or "maturity" reach the vocabulary, the panel,
legend, bloc card, tooltip, explainer or static page score sections; the
methodology keeps one history note on the old name.

**Rubric v3 (September 2026):** the calibration block uses fixed anchors. Each level describes an observable state, and a 5 no longer means "the global frontier today", so scores compare across time. `PROMPT_VERSION` was `v3-2026-09` for the rubric switch, `v3.1-2026-09` once the v2.1 rationale field changed the output structure, `v3.2-2026-09` once the existing-data block also showed the Enforcement Level text (context only; same rubric), `v3.3-2026-09` for rubric v3.1, and is `v3.4-2026-09` once the existing-data block also showed the current Specific Laws and Sources, with style and source rules (#88, #92, #141; context only, same rubric v3.1, so no break).

**Rubric v3.1 (September 2026, #162):** the v3 anchors plus an insufficient-evidence value. A sub-indicator score is `null` when no source confirms either the presence or the absence of what it asks about (the rationale then says what was searched); a 1 needs positive evidence of absence. The "give the lower level" tie-break applies only when evidence supports both levels. Downstream: a dimension is the mean of its numeric sub-indicators, `None` when two or more are null; the implementation index (`averageScore`) is the mean of the scored normative dimensions, `None` with fewer than two; any unscored dimension caps confidence at `low` (so staleness re-researches it). Files: `scores.csv` writes an empty cell, `history.json` and `pending.json` hold `null`, `subscores.json` holds `{"score": null, "rationale": ...}`; the gate treats a move to or from null as a score change (always on the review list); the digest and changelog print "insufficient evidence" with no direction. Frontend: `isInsufficient(value)` and `INSUFFICIENT_EVIDENCE_LABEL` in `src/constants.ts` are the one test (read values as `entry?.[key]` so a missing row stays `undefined`, "no data"); the map paints `--score-insufficient` (`src/map/fill.ts`, never the colour for 1), and the legend adds an "Insufficient evidence" key only while a shown country is in that state; with the score range at the full scale such a country stays visible, with a narrowed range it is filtered out. `RUBRIC_VERSION = "v3.1"` is what the rubric guard compares. The switch is recorded as a calibration break in `history.json` (`breaks`) by the first full forced run (automatically, via the guard), which the timeline marks and the changelog labels as "Recalibration"; no v3 break was ever recorded, so that one break covers v2 to v3.1. Until that run lands, all scores are rubric v2.

**Methodology v2 (June 2026):** each dimension score is the mean of 4 named sub-indicators (integers 1–5, defined in the `RESEARCH_PROMPT` in `scripts/regulation_pipeline/prompt.py` and modeled in `models.py`), producing quarter-point decimals. Sub-scores are persisted to `public/data/subscores.json`. **Methodology v2.1 (September 2026):** every sub-indicator also carries a one-sentence `rationale` (1–200 characters, validated in pydantic; the structured-output schema requires the field but cannot express length). The pipeline writes `{score, rationale}` per sub-indicator and a top-level `methodology: "v2.1"` tag from the first v2.1 run on (entries researched before keep v2 integers); the frontend loader (`src/data/subscores.ts`) accepts both v2 integers and v2.1 objects. Supabase mirrors rationales into `country_scores.rationales` (jsonb). governance_type and actor_involvement are explicitly scored as descriptive, not quality, scales. Full write-up in `public/methodology.html`.

### Automated Updates

`.github/workflows/update-data.yml` runs `update_data.py` every Monday (6am UTC) with the pipeline defaults, so every country is re-researched with web search each week (~$100 per run on Opus 5), and auto-commits any changed CSV/JSON files in `public/` (including the gold-set drift row in `public/data/drift.json`). If main moved during the run the commit is rebased and retried, and if it still fails every output file is uploaded as a workflow artifact; with `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` secrets set it also dual-writes to Supabase, and with the repo variable `EVIDENCE_SYNC_ENABLED=true` it refreshes OECD evidence first and researches `--grounded`. It can also be dispatched manually with eight inputs: `countries`, `model` and `break_reason` (text), `force_update`, `search`, `batch` and `gate` (on by default; off passes the matching `--no-*` flag), and `digest` (off by default; on passes `--digest`). Before committing, it builds the site and runs the unit tests on the new data (data commits pushed with `GITHUB_TOKEN` never trigger CI); a failure keeps the data as an artifact instead of pushing it. After a push it runs the Playwright suite, so a data change that breaks e2e turns that run red the same day. Requires `ANTHROPIC_API_KEY` set as a GitHub Actions secret. `.github/workflows/evidence-sync.yml` offers manual probe / sync-delta / sync-full dispatches for the evidence layer. `.github/workflows/link-check.yml` runs monthly (and on dispatch): it checks every URL in `regulation_data.csv` and opens or updates one "Dead source links" issue (label `data`); a dispatch with `titles` also fills Supabase `sources.title`.

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
