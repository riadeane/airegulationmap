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
npm run test:e2e   # Playwright smoke + axe checks (tests/e2e/) against the built preview; run after a build
                   # made with CI's dummy VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (see ci.yml), or the
                   # Supabase specs fail; CI=1 makes it start its own preview instead of reusing port 4173
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
Batches API (50% token pricing; results within 24h, and a full run took more than 4h in September 2026, see #194), Opus 5. A full
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

# Collect a batch an earlier run left running (state/open_batch.json, #194);
# exits 0 at once when none is recorded. Any run collects a recorded batch
# first, with the options it was submitted with, and submits nothing new.
python scripts/update_data.py --collect-only

# Research without web search (training data only)
python scripts/update_data.py --no-search

# Evidence-grounded research: inject each country's verified policy
# initiatives (OECD/GAIIN, from Supabase) into the prompt. Countries
# without evidence fall back to the plain prompt. Every run records each
# country's evidence coverage (see "Evidence coverage" below).
python scripts/update_data.py --grounded

# Supabase dual-write mirror: auto-on when SUPABASE_URL and
# SUPABASE_SERVICE_KEY are set; force with --mirror / disable with
# --no-mirror. Mirror failures never fail a run. If the run's research_runs
# row cannot be written after 3 attempts, the mirror turns itself off for
# the run with one warning.

# Stability gate (default on): a score change lands only with new
# evidence or when it repeats on the next run (a held candidate counts for
# 14 days); held candidates live in public/data/pending.json. --no-gate
# applies every score; on a full run it needs a reason, recorded as a
# calibration break in history.json.
python scripts/update_data.py --no-gate --break-reason "Model switch to Opus 5"

# Rubric guard: prompt.RUBRIC_VERSION names the rubric generation. When the
# newest break in history.json is for an older rubric, the first full forced
# run records a break ("Switch to scoring rubric v3.2 (model ...)") and runs
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
# the run's model; digest failures never fail a run. Files are named by ISO
# week: only a scheduled run replaces the week's digest; a manual --digest
# run fills a week that has none (or only "no changes") and otherwise keeps
# it without a request (#101).
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
| `src/map/` | Map rendering (renderer, the HTML legend, zoom, tooltip, low-confidence hatch pattern in `hatch.ts`, the two ramps in `ramp.ts`, small-state point markers in `smallStates.ts`) |
| `src/map/smallStates.ts` | Small states (#104): the scored countries the 1:110m atlas has no shape for, drawn as point markers from `small_states.json`. A marker is a `.country` path with a Point geometry (so fill, tooltip, click, selection, comparison, search and filter dimming, the hatch and the no-data/insufficient fills all apply), in `.small-state-layer` above the country hatch with its own `.small-state-hatch-layer` above it; its radius (`SMALL_STATE_RADIUS`, 4 px) and non-scaling stroke keep their screen size at every zoom |
| `src/map/countryTable.ts` | The map as a table for keyboard and screen-reader users (#139): visually hidden until focus enters it, sortable, roving tabindex |
| `src/map/geometryNames.ts` | `resolveFeatureNames`: gives each world-atlas geometry the dataset's country name via its ISO numeric id where the atlas name differs ("Dominican Rep.") |
| `src/panel/` | Country detail panel (scores, text sections, changelog, search results, policy initiatives, evidence coverage: `evidence.ts` renders the sentence under the confidence line and links to the Policy Initiatives section; `frontier.ts` renders the Frontier Risk Governance block: score, track in words, the four sub-indicators with level meanings or "Not applicable" / "Insufficient evidence", the EU-level and computed notes, the frontier text and sources, hidden for a country never scored on the lens) |
| `src/comparison/` | Side-by-side comparison panel + radar chart |
| `src/scatter/` | Cross-dimension scatter plot with deterministic jitter + trend overlay (`stats.ts`) |
| `src/controls/` | UI controls (search, grouped score selector, filter incl. the Evidence facet, blocs and bloc summary incl. the grounded share, export, share, timeline, URL sync, citations, print brief, issue reporting, header menu, "this week" strip, "Show uncertainty" toggle, the "How to read this map" dialog in `helpOverlay.ts`) |
| `src/data/digest.ts` | Weekly digest parsing + formatting helpers (pure; used by `src/changes.ts`, the `changes.html` entry) |
| `src/data/drift.ts` | Drift dashboard aggregations (pure): countries changed per run by dimension, delta bins, confidence by vintage, drift.json and `research_runs` parsing, per-bloc shares |
| `src/charts/drift.ts` | The drift dashboard's D3 small multiples (token-driven palette, hover tooltips); `src/drift.ts` is the `drift.html` entry |
| `src/styles/` | CSS partials imported via Vite (`_tokens`, `_header`, `_map`, `_panel`, etc.) |

**State management:** All mutable state lives in `src/state/store.ts` as a single object. Modules read state via `getState()`; only `src/state/` calls `setState(patch)`, and every other module writes through an intent in `src/state/interactions.ts` (data loaders through `receiveData`; `tests/singleWriter.test.js` enforces it, #150). The store emits events per changed key, allowing modules to subscribe with `on(key, handler)`.

**Data flow:**
1. `main.ts` loads `scores.csv` and `regulation_data.csv` in parallel via `Promise.all`
2. Data is stored in the centralized state store
3. D3 renders a choropleth SVG world map; TopoJSON provides country geometries
4. User interactions dispatch state changes which trigger subscribed re-renders

### Backend (`scripts/regulation_pipeline/`)

Python package that calls the Claude API to research regulation status per country. Full architecture write-up with mermaid diagrams (layering, run sequence, domain model, strategy/repository patterns, staleness, batch lifecycle, retry) lives in [`scripts/regulation_pipeline/README.md`](scripts/regulation_pipeline/README.md). Layered around a few design patterns so the concerns stay separated and testable:

- **Domain models** (`models.py`) - pydantic v2 `ResearchResult` is the single source of truth: it generates the structured-output JSON schema, validates responses, and computes dimension means / the composite (the implementation index) / confidence. Sub-indicator field names live in exactly one place.
- **Repository** (`repository.py`) - `Dataset` owns the five data stores that always travel together (scores/regulation/history/subscores/pending); loads, applies a validated result, and saves them as a set (all five temp files written and fsynced, then renamed back to back). On load the CLI checks that every country's latest history snapshot matches `scores.csv` (`consistency_errors`) and stops before researching if a save was interrupted between renames (#149).
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
| `batch.py` | `BatchRunner` - Message Batches submit/poll/classify (50% token pricing). Every call goes through the retry policy; one 4h wall-clock wait budget, counted from the first submit, covers all batches of a run (the job has 355 min); a run's main batch still processing at the end of it is left running and raised as `BatchPending` (the CLI records it for a later run, #194), while a follow-up batch is canceled and its finished requests salvaged; a submit that needed retries cancels the orphaned batch a lost response left running; follow-up batches resubmit transient failures once and continue `pause_turn` results (up to 3 rounds); already-billed results are never resubmitted |
| `handoff.py` | The open-batch record `state/open_batch.json` (#194): a batch a run left running, with the options it was submitted with (model, search, gate and calibration break, full run, digest). Any run collects a recorded batch before submitting anything (`--collect-only` exits at once when there is none), applies it with those options and deletes the record; a batch still running is handed on; a record older than the API's 29-day retention is removed and the run fails |
| `retry.py` | Reusable transient-error retry policy (backoff, Retry-After capped at 120s; 400/413/422 fail the one request, other 4xx are fatal) |
| `prompt.py` | Research prompt template + rendering |
| `config.py` | `Settings` (repo-root paths) + constants (CSV fields, staleness threshold, site URL, default model) |
| `staleness.py` | `StalenessPolicy` - which countries need re-research |
| `gate.py` | Stability gate - evidence and persistence rules for score changes |
| `digest.py` | Weekly digest: selects a run's gate-applied changes, one structured-output Claude request, writes `public/digest/` (week JSON, index, Atom feed); `python -m regulation_pipeline.digest --run <id>` regenerates from Supabase |
| `consistency.py` | Post-run EU consistency check (#95): lists EU members whose `regulation_status.binding_force` or `ai_specificity` (fixed by the AI Act for every member) differs from the EU's most common score, as `eu:` log lines and a step-summary table. Never changes a score |
| `links.py` | Source link check (#92): `LinkChecker` fetches each cited URL once per run and drops dead ones (404/410, a redirect to or a 200 not-found page, known-bad patterns) before gating; 401/403/429/5xx/timeouts stay. Reads live pages' titles for `sources.title` (#143). `python -m regulation_pipeline.links report|titles` |
| `gold.py` | Gold set and drift check: loads `gold_set.json`, compares a run's raw (ungated) results with it (`compare`, pure), appends `drift.json`, mirrors `gold_checks`, step-summary block; `python -m regulation_pipeline.gold --model <id>` is the model-comparison CLI. Frontier gold entries are compared separately (`compare_frontier`) into the drift row's `frontier` block |
| `frontier.py` | Frontier Risk Governance (PRD 15): `FrontierContext` loads `frontier_tracks.json`, `frontier_international.json` and EU membership, gives the prompt a country's track (`prompt_for`), computes `international_coordination` from the public lists, and `assemble`s a model's frontier block into a `FrontierRecord` (researched, computed and `na` sub-indicators). A missing track file turns the lens off; a malformed one stops the CLI before any API call |
| `frontier_checks.py` | One-off checks on the lens (PRD 15 req. 7, 15, 16): `python -m regulation_pipeline.frontier_checks sensitivity` (arithmetic, geometric and capped aggregation on the gold set, no API), `behaviour --model <id> --variant reversed\|paraphrased` (re-researches the gold countries with reversed anchors or a paraphrased section; reports how many frontier sub-indicators move), `crossval --indices <csv>` (Spearman against external indices) |
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
| `public/scores.csv` | Numeric scores (1–5) for 6 dimensions per country; an empty cell is "insufficient evidence" (rubric v3.1), distinct from a country with no row ("no data"). The last two columns are the Frontier Risk Governance lens (PRD 15): `Frontier Risk` and `Frontier Track` (H/C/G). An empty track means the country has not been scored on the lens (no data); an empty score with a track is insufficient evidence. Files written before the lens lack both columns; the first save adds them empty |
| `public/regulation_data.csv` | Text descriptions, laws, source URLs, confidence, last_updated; then the lens's `Frontier Risk` text and its own `Frontier Sources` |
| `public/history.json` | Change-point score snapshots per country (a dimension or `averageScore` may be `null`, insufficient evidence; a snapshot's `date` is the run that produced those scores; the timeline, changelog, "This week" strip and drift dashboard all read it that way; each snapshot also records the run's `confidence`, and a confidence-only change appends a snapshot with the same scores, which the changelog, strip and dashboard skip; snapshots from before September 2026 carry no `confidence` and are not backfilled), plus `breaks` (calibration breaks: `{date, model, prompt_version, rubric, reason, complete}`, recorded only when the run applied something; `complete: false` means some countries kept older-rubric scores, so the rubric guard still treats the switch as due; the June 2026 methodology v2 break is the first) |
| `public/data/country_names.json` | Canonical country names with alias arrays for normalization |
| `public/data/blocs.json` | Bloc membership lists (EU, G7, G20, ASEAN, AU, BRICS+, NATO, OECD); names must exactly match `scores.csv` |
| `public/data/subscores.json` | Per-country sub-indicator audit trail (4 sub-scores per dimension, methodology v2; `{score, rationale}` per sub-indicator since v2.1, `score: null` for insufficient evidence since rubric v3.1), plus the `evidence` record of each country's latest research pass (PRD 14; absent = no run record yet) |
| `public/data/pending.json` | The stability gate's state: `pending`, the score candidates it held for one run (`{country, candidate_scores, first_seen}`; a candidate score may be `null`), and `seen_sources`, every source URL each country has cited (normalised), so a re-cited URL is not new evidence |
| `public/data/frontier_tracks.json` | Frontier Risk Governance tracks (PRD 15), assigned by the maintainer from Epoch AI data, never by the model (#159): `{schema_version, reviewed_on, h_threshold_flop, rules: {H, C, G}, notes, countries: [{country, track, basis, sources, reviewed_on}]}`. Lists H and C countries only; every other country is G. October 2026: H = United States of America, China, Saudi Arabia, United Kingdom, France; C = Malaysia, Indonesia, Norway, Taiwan, Netherlands, Germany, South Korea, Japan. Validated by `frontier.load_tracks` and `tests/pipeline/test_frontier.py` (names match `scores.csv`). Review each quarter |
| `public/data/frontier_international.json` | The public lists `international_coordination` is computed from: `texts` (key, title, short, date, kind `frontier`\|`broad`, source, eu, countries: Bletchley, Seoul Declaration, Seoul Ministerial, the 2026 Call for Control of Frontier AI Models, Paris 2025, New Delhi 2026), `network` (the International Network for Advanced AI Measurement, Evaluation and Science), `dialogues` (standing bilateral frontier-safety dialogues; a test requires `last_met` within a year of `reviewed_on`), `leading_roles` (current only). EU signature is recorded per list and never counts for a member state. Re-check at each quarterly review (the 2026 Call is still open for endorsement) |
| `public/data/gold_set.json` | Gold sub-indicator scores for ten countries across the range of the implementation index: 20 scores, a justification per dimension, sources, and `status` (`draft` until the maintainer verifies, then `verified` + `verified_on`). All ten are drafts awaiting the maintainer's hand-check (September 2026). Each country also carries a `frontier` block (PRD 15) with its own `status`, `track`, the track's researched sub-indicators (integers; `international_coordination` is computed, never gold), a justification (FLAG lines mark placements a strict reader could move) and sources; all drafts (2026-10-01). Validated by `gold.load_gold_set` |
| `public/data/drift.json` | One row per full run from the gold-set drift check (a `--countries` run logs the metrics but writes no row, #99): `{run_id, date, model, prompt_version, countries_compared, countries_missing, mae_by_dimension, bias_by_dimension, within_one, max_dev, max_dev_at, gold_verified, gold_version, grounded_countries?}`; `bias_by_dimension` is the mean signed error (run minus gold), absent on rows from before #163; `gold_verified` counts the compared countries whose gold entry was verified (the rest were drafts) and `gold_version` is the first 12 hex digits of the gold file's SHA-256; a grounded run adds `grounded_countries` and records the plain prompt version when every compared country fell back to it. The drift dashboard marks rows computed against drafts. A run with frontier gold entries adds `frontier: {compared, missing, mae, bias, within_one, skipped, gold_verified}` (PRD 15). Mirrored to Supabase `gold_checks` (the gold-set columns need migration 0013; until then the row is written without them) |
| `public/data/country_iso.json` | ISO 3166 alpha-2/alpha-3/numeric per dataset name (verified against the TopoJSON geometry ids by `tests/pipeline/test_country_iso.py`) |
| `public/data/countries-110m.json` | Self-hosted world-atlas TopoJSON (Natural Earth 1:110m) the map draws; geometry ids are ISO 3166-1 numeric, and the map joins them to dataset names through `country_iso.json` |
| `public/data/small_states.json` | One `[lon, lat]` per scored country with no shape in `countries-110m.json` (29 small states: Singapore, Malta, Bahrain, Pacific and Caribbean island states), keyed by ISO numeric `id`; the map draws each as a point marker. Generated by `npx tsx scripts/build_small_states.ts` (the centroid of the country's largest polygon in world-atlas 2.0.2's 1:50m file, 1:10m for Tuvalu; Kiribati uses Tarawa); never edit by hand. `tests/smallStates.test.js` and `tests/pipeline/test_country_iso.py` fail when a scored country has neither a shape nor a point |
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
render time (`cssVar`), use one single-hue ramp off `--ramp-impl-high`
(the map's implementation ramp; `src/drift.ts` imports
`src/styles/_tokens.css`; the inline mirror in `drift.html` carries no
score tokens, `tests/driftTokens.test.js`) for ordered series and neutral
tints for the rest, and re-render on theme change and resize. Every
figure has a caption with the key numbers and a "Show as a table" twin.
The page renders with any source missing (each figure has an empty
state). Linked from the app header menu, `data.html` and `changes.html`;
listed in the sitemap.

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

Plus a separately presented lens, **frontier_risk** ("Frontier Risk Governance", PRD 15): evaluative against a stated standard, scored by track, never in the composite (see "Frontier Risk Governance" below).

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
arrows use one neutral colour (`--change-mark`). Three ramps in
`src/styles/_tokens.css`: `--ramp-impl-low/high` (one blue hue, light = less
in force, dark = more), `--ramp-style-low/high` (neutral stone) and the
frontier lens's plum ramp (PRD 15); none uses red. "How to read this map" is the `#help-overlay` dialog (guide first,
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

**Rubric v3 (September 2026):** the calibration block uses fixed anchors. Each level describes an observable state, and a 5 no longer means "the global frontier today", so scores compare across time. `PROMPT_VERSION` was `v3-2026-09` for the rubric switch, `v3.1-2026-09` once the v2.1 rationale field changed the output structure, `v3.2-2026-09` once the existing-data block also showed the Enforcement Level text (context only; same rubric), `v3.3-2026-09` for rubric v3.1, `v3.4-2026-09` once the existing-data block also showed the current Specific Laws and Sources, with style and source rules (#88, #92, #141; context only, same rubric v3.1, so no break), `v3.5-2026-10` for rubric v3.2, and is `v3.6-2026-10` once the prompt added the Frontier Risk Governance section and block (PRD 15; the five dimensions' rubric is unchanged, so no break).

**Rubric v3.1 (September 2026, #162):** the v3 anchors plus an insufficient-evidence value. A sub-indicator score is `null` when no source confirms either the presence or the absence of what it asks about (the rationale then says what was searched); a 1 needs positive evidence of absence. The "give the lower level" tie-break applies only when evidence supports both levels. Downstream: a dimension is the mean of its numeric sub-indicators, `None` when two or more are null; the implementation index (`averageScore`) is the mean of the scored normative dimensions, `None` with fewer than two; any unscored dimension caps confidence at `low` (so staleness re-researches it). Files: `scores.csv` writes an empty cell, `history.json` and `pending.json` hold `null`, `subscores.json` holds `{"score": null, "rationale": ...}`; the gate treats a move to or from null as a score change (always on the review list); the digest and changelog print "insufficient evidence" with no direction. Frontend: `isInsufficient(value)` and `INSUFFICIENT_EVIDENCE_LABEL` in `src/constants.ts` are the one test (read values as `entry?.[key]` so a missing row stays `undefined`, "no data"); the map paints `--score-insufficient` (`src/map/fill.ts`, never the colour for 1), and the legend adds an "Insufficient evidence" key only while a shown country is in that state; with the score range at the full scale such a country stays visible, with a narrowed range it is filtered out.

**Rubric v3.2 (October 2026):** the first v3.1 run (2026-09-28, 67 of 196 countries before the batch wait budget ran out, #194) gave 5s on the strength of a single instrument, counted US state statutes and general law applied to AI, and the calibration block told the model that "today's leading jurisdictions reach 5 on most sub-indicators". v3.2 keeps the v3.1 structure and null value and tightens the implementation dimensions: a 5 needs every element of its anchor in force, applicable and exercised (anything deferred, stayed or not yet used caps at 4; "expect 5s to be rare"); only the national level counts, with EU law counting for EU members (sub-national law goes to `governance_type.subnational_role` and the text); general law with no provision written for AI scores at most 2; a rule for one use case scores at most 3 on `binding_force` and 2 on `scope`; and the twelve implementation sub-indicators define all five levels (governance style keeps its 1/3/5 anchors). `tests/pipeline/test_rubric_v32.py` pins these rules, and `tests/pipeline/test_methodology_anchors.py` keeps `public/methodology.html` quoting every anchor. `RUBRIC_VERSION = "v3.2"` is what the rubric guard compares. The switch is recorded as a calibration break in `history.json` (`breaks`) by the first full forced run (automatically, via the guard), which the timeline marks and the changelog labels as "Recalibration"; the v3.1 run never landed in the files, so that one break covers v2 to v3.2. Until that run lands, all scores are rubric v2. The gold set (`gold_set.json`) was drafted against the v3 anchors and needs re-scoring under v3.2 before its drift numbers mean anything (#106).

### Frontier Risk Governance (PRD 15)

Frontend (PRD 15 req. 17 and PRD 16 phase 2): `frontierRisk` is the seventh `AttributeKey` (group `frontier`; `DimensionKey` stays the five rubric dimensions), with the tracks, sub-indicators and plain-word anchors in `src/constants.ts` (`FRONTIER_TRACKS`, `FRONTIER_SUBINDICATORS`, `hasFrontierTrack`). `ScoreEntry.frontierRisk`/`frontierTrack` are absent when the country has no frontier track (no data) and `frontierRisk` is `null` for insufficient evidence; `RegulationEntry` gains `frontierRisk` (text) and `frontierSources`; `subscores.ts` parses the `frontier` block ("na", null, `eu_level`, `computed`). The selector group, scatter axes, explainer entry, panel block, comparison row and static-page section appear only once some country has a track, and a `?mode=frontierRisk` link falls back to the implementation index without one. The map never shows "na" (it exists only per sub-indicator); insufficient evidence uses `--score-insufficient`. CSV export appends `Frontier Risk` and `Frontier Track`; the JSON export adds `meta.frontier` and a per-country `Frontier` block. The changelog lists frontier moves but not a first frontier assessment or a track change; `src/data/drift.ts` stays on the five dimensions. `tests/frontier.test.js` and `tests/e2e/frontier.spec.ts` (fixture data rewritten in flight) cover it.

A seventh score, presented as its own lens: whether a state can see, test and stop a dangerous frontier AI model, against the standard set out in `public/methodology.html#frontier-risk-governance`. Decisions (2026-10-01): national level only, EU law counting for EU members (#158); a voluntary evaluation regime can reach 4 on `evaluation_oversight` (#160); tracks as in `frontier_tracks.json` (#159); no launch switch, so merging is the launch. Still open before launch: the value statement's wording and the funding and authorship disclosure (#161, an HTML comment in the methodology marks the place) and verified frontier gold entries (#106).

- **Tracks** (`frontier_tracks.json`): H frontier host, C compute or chokepoint, G global (the default).
- **Sub-indicators** (`models.FRONTIER_SUBINDICATORS`): `developer_obligations` (H), `evaluation_oversight` (H, C), `incident_emergency_preparedness` (all), `international_coordination` (all; computed in `frontier.py` from `frontier_international.json`, never researched). A value is an integer 1–5, `null` (insufficient evidence) or `"na"` (does not apply on the track; assigned from the track, never by the model). Anchors live in `prompt.FRONTIER_ANCHORS` (and `FRONTIER_INCIDENT_ELEMENTS`); `tests/pipeline/test_methodology_anchors.py` keeps the methodology quoting them. `models.FRONTIER_RUBRIC_VERSION` (`f1`) is the anchors' generation, written into every frontier block; bump it when they change (a break for the lens only).
- **Score** (`models.frontier_score`): the mean of the applicable values capped at the lowest plus one, to 2 decimals; `None` when any applicable value is `null`. Never "na" at lens level. Not in `avg_score`.
- **Research**: one request per country as before. `ResearchClient` (with a `FrontierContext`) adds the lens's section to the prompt and the track's `frontier_risk` object to the schema (`models.result_model_for(track)`: `ResearchResultH/C/G`); `ResearchResult.parse` picks the class from the answer's shape, and `FrontierContext.assemble` checks the track. H and C requests get 16 searches and 20,000 max tokens (G keeps 12 and 16,000). The frontier block has its own `text` and `sources`; the link check filters both.
- **Gate and persistence**: the lens is gated in its own decision (`gate.decide_frontier`: a first score or a new track applies; otherwise a new frontier source or a repeat within 14 days), after the five dimensions land, so frontier evidence never moves them and the reverse. `Dataset.apply_frontier` writes `Frontier Risk`/`Frontier Track` (scores.csv), the text and `Frontier Sources` (regulation_data.csv, always), the `frontier` block of the country's subscores.json entry (`{date, track, rubric, <four sub-indicators>}`, `eu_level` on `developer_obligations` for EU members on track H, `computed` on `international_coordination`), and `frontierRisk`/`frontierTrack` in history (today's snapshot amended, or the last one copied). A main apply carries all of these over. Held frontier candidates live in `pending.json` `frontier_pending`. `split_subscores_entry` skips the `frontier` block like `evidence`. The step summary adds a frontier gate table.
- **Supabase**: migration `0014_frontier_risk_governance.sql` (not yet applied to the live project) adds `country_scores.frontier_risk/frontier_track/frontier_subscores`, `country_summaries.frontier_risk_text/frontier_sources_raw`, `gold_checks.frontier`, and appends the five to `public_export`. Until it is applied the mirror writes rows without them, with a warning. `score_history.scores` already carries the snapshot keys.

**Methodology v2 (June 2026):** each dimension score is the mean of 4 named sub-indicators (integers 1–5, defined in the `RESEARCH_PROMPT` in `scripts/regulation_pipeline/prompt.py` and modeled in `models.py`), producing quarter-point decimals. Sub-scores are persisted to `public/data/subscores.json`. **Methodology v2.1 (September 2026):** every sub-indicator also carries a one-sentence `rationale` (1–200 characters, validated in pydantic; the structured-output schema requires the field but cannot express length). The pipeline writes `{score, rationale}` per sub-indicator and a top-level `methodology: "v2.1"` tag from the first v2.1 run on (entries researched before keep v2 integers); the frontend loader (`src/data/subscores.ts`) accepts both v2 integers and v2.1 objects. Supabase mirrors rationales into `country_scores.rationales` (jsonb). governance_type and actor_involvement are explicitly scored as descriptive, not quality, scales. Full write-up in `public/methodology.html`.

### Automated Updates

`.github/workflows/update-data.yml` runs `update_data.py` every Monday (06:17 UTC, off the top of the hour, #189) with the pipeline defaults, so every country is re-researched with web search each week (~$100 per run on Opus 5), and auto-commits any changed CSV/JSON files in `public/` (including the gold-set drift row in `public/data/drift.json`). If main moved during the run the commit is rebased and retried, and if it still fails every output file is uploaded as a workflow artifact; with `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` secrets set it also dual-writes to Supabase, and with the repo variable `EVIDENCE_SYNC_ENABLED=true` it refreshes OECD evidence first and researches `--grounded`. It can also be dispatched manually with eight inputs: `countries`, `model` and `break_reason` (text), `force_update`, `search`, `batch` and `gate` (on by default; off passes the matching `--no-*` flag), and `digest` (off by default; on passes `--digest`). Before committing, it builds the site and runs the unit tests on the new data (data commits pushed with `GITHUB_TOKEN` never trigger CI); a failure keeps the data as an artifact instead of pushing it. After a push it runs the Playwright suite, so a data change that breaks e2e turns that run red the same day. A batch still processing after the run's 4-hour wait is left running and recorded in `state/open_batch.json` (committed as "chore: record the open research batch"); a second schedule (`47 */2 * * 1,2`, every two hours on Mondays and Tuesdays) runs with `--collect-only` and applies it once it has ended (#194), and any dispatch collects it first too. Requires `ANTHROPIC_API_KEY` set as a GitHub Actions secret. `.github/workflows/evidence-sync.yml` offers manual probe / sync-delta / sync-full dispatches for the evidence layer. `.github/workflows/link-check.yml` runs monthly (and on dispatch): it checks every URL in `regulation_data.csv` and opens or updates one "Dead source links" issue (label `data`); a dispatch with `titles` also fills Supabase `sources.title`.

### Deployment

Hosted on Cloudflare Pages. Build command: `npm run build`, output directory: `dist`. The Pages build reads its Node version from `.nvmrc` (keep it on the major CI's `setup-node` uses): the project's v2 build image otherwise defaults to Node 18, which Vite 8 cannot run on.

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
