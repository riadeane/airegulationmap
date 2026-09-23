# Supabase + OECD Integration Design

**Date:** 2026-04-06
**Status:** Superseded (2026-07) — implemented in revised form; see
[docs/plans/2026-07-supabase-evidence-and-ux.md](../../plans/2026-07-supabase-evidence-and-ux.md).
Key differences from this spec: methodology v2 sub-indicators are modeled
(jsonb on `country_scores`); the existing `regulation_pipeline` was EXTENDED
(mirror/evidence modules) rather than replaced by a new `sync_pipeline`; the
static CSVs were kept as the frontend's boot path (published snapshots via
dual-write) rather than removed; the OECD source is the official
`api.oecdai.org` GAIIN endpoint with the wrapper as fallback.
**Scope:** Replace static CSVs with Supabase, ingest OECD AI Policy Observatory data as structured policy initiatives, use Claude to score and summarize from verified facts rather than open-ended research.

---

## Goals

1. **Replace static CSVs** (`scores.csv`, `regulation_data.csv`, `history.json`) with Supabase as the single source of truth
2. **Reduce hallucination** — Claude analyzes structured policy initiative records instead of researching from scratch
3. **Reduce cost** — Claude prompt shrinks from open-ended research to structured scoring of known facts
4. **Enable researcher access** — PostgREST API + CSV export endpoint from Supabase
5. **Keep data current** — delta sync from OECD API on the monthly GitHub Actions schedule

---

## Data Sources

| Source | Role | Refresh |
|--------|------|---------|
| OECD AI Policy Observatory API (`https://oecd-ai.case-api.buddyweb.fr/policy-initiatives`) | Primary: 2,218 policy initiatives, paginated (20/page, 111 pages), delta-syncable via `updatedAt` | Monthly delta sync |
| Kaggle Global AI Regulation Tracker 2025 | Gap-fill: countries where OECD returned 0 initiatives | Manual re-import as needed |
| Claude (web search fallback) | Countries with 0 initiatives after both OECD + Kaggle | Monthly, only where needed |

> **Risk:** The OECD API endpoint (`buddyweb.fr`) is a third-party wrapper, not an official OECD service. If it goes offline, `oecd_sync.py` should degrade gracefully (log a warning, skip sync, do not delete existing data). The official `oecd.ai` site should be monitored as an alternative source if the wrapper becomes unavailable.

**OECD Terms:** Data freely usable with attribution, even commercially. Required citation format: `OECD (year), (dataset name), oecd.ai, accessed (date)`.

### Peer projects (not ingestion sources)

**regulations.ai** (Smitteck GmbH / Martin Smit, solo operator) — per-regulation catalog across ~100+ jurisdictions (including supra-national bodies: NATO, APEC, BRICS, IAEA, ICAO). Taxonomy: 7 regulation types (Act, Bill, Decree, Regulation, Policy, Guideline, Standard), 10 lifecycle statuses (Draft → Proposed → Under Review → Stalled / Withdrawn → Adopted → Awaiting Entry → In Force → In Force (Amended) → Repealed), 13 topics. Features a count-based choropleth, full DB download, and AI chat over the corpus.

- **Not an ingestion source.** No published methodology, sourcing policy, update cadence, or license terms. Solo-built with AI assistance per founder's about page.
- **Useful as a coverage spot-check** — if OECD returns 0 initiatives for a country, cross-reference regulations.ai before falling back to Claude web search.
- **Validates the catalog/scoring split.** Regulations.ai counts laws (US=36, Slovakia=24, UK=23); we score regimes across 6 dimensions. After the Supabase migration we'll own both layers — the fact catalog (`policy_initiatives`) and the comparative index (`country_scores`). The index is the differentiator.

**trackpolicy.org** (Isabelle Reksopuro, solo operator, **open source** with published methodology) — bill-level tracker for AI **and data center** policy. 734 bills, 283 data center facilities, 561 legislators, 590 news stories. Heavy US coverage (federal + all 50 states), plus UK / EU / APAC.

- **Upstream sources** (primary government repositories): LegiScan (US state bills), Congress.gov (US federal), EUR-Lex (EU directives), Epoch AI's CC-BY dataset (data center facilities), RSS feeds from major outlets (news).
- **Claude Sonnet 4.6 as classifier**, not researcher — assigns impact tags from a fixed taxonomy and infers jurisdiction stance (`restrictive` / `concerning` / `review` / `favorable` / `none`). **Externally validates this spec's "Claude as analyst" pattern** — two independent projects converged on the same split between upstream facts and model-generated interpretation.
- **Stage-weighted scoring**: enacted bills weighted highest, filed bills lowest. See "Stage-weighted scoring" note below in the summarizer prompt design.
- **Not an ingestion source, not a competitor.** Different unit of analysis (bills + facilities, not country scores) and different geographic emphasis (US state depth vs. our global breadth). A researcher would use both.
- **Primary-source escalation path.** If US state-level or bill-level depth ever becomes a requirement for this project, LegiScan / Congress.gov / EUR-Lex are the sources to add — not more Claude research. Out of scope for v1 (OECD curation is the whole point), but worth flagging for v2+.

---

## Database Schema

### `countries`
Canonical country registry. Replaces `public/data/country_names.json`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text UNIQUE | Canonical name |
| `iso3` | char(3) UNIQUE | Matches OECD `code` field (e.g. `EGY`, `BRA`) |
| `iso2` | char(2) | For frontend flag/map use |
| `aliases` | text[] | For name normalization (from existing `country_names.json`) |
| `region` | text | |
| `updated_at` | timestamptz | |

### `policy_initiatives`
One row per law, strategy, guideline, or agreement. The core fact table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `country_id` | uuid FK → countries | |
| `oecd_id` | integer UNIQUE | OECD's `id`; null for non-OECD rows. Used for delta dedup. |
| `name` | text | OECD `englishName` |
| `category` | text | OECD `category` (e.g. "Regulations, guidelines and standards") |
| `initiative_type` | text | OECD `initiativeType` |
| `binding` | text | `"Binding"` \| `"Non-binding"` \| null |
| `status` | text | `"Active"` \| `"Inactive – initiative complete"` |
| `start_year` | integer | |
| `end_year` | integer | nullable |
| `description` | text | Short summary |
| `overview` | text | Full plain text (HTML stripped). Fed to Claude. |
| `source_url` | text | oecd.ai permalink or external source |
| `source` | text | `"oecd"` \| `"kaggle"` \| `"manual"` |
| `principles` | text[] | OECD AI Principles linked |
| `tags` | text[] | |
| `target_sectors` | text[] | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | OECD's `updatedAt`. Drives delta sync and staleness detection. |

> **Status taxonomy note:** OECD's `status` field is binary (`Active` / `Inactive – initiative complete`), which is sufficient for v1 scoring. If researchers later want lifecycle nuance (e.g. distinguishing proposed bills from enacted laws from repealed frameworks), derive a `lifecycle_stage` column from `status` + `start_year` + `end_year` + `binding`. The peer project regulations.ai uses a 10-step lifecycle (Draft → Proposed → Under Review → Stalled / Withdrawn → Adopted → Awaiting Entry → In Force → In Force Amended → Repealed) worth mirroring if we go there. Out of scope for v1.

### `country_scores`
Claude-generated numeric scores. One current row per country (upserted, not appended).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `country_id` | uuid FK UNIQUE | One active row per country |
| `regulation_status` | integer | 1–5 |
| `policy_lever` | integer | 1–5 |
| `governance_type` | integer | 1–5 |
| `actor_involvement` | integer | 1–5 |
| `enforcement_level` | integer | 1–5 |
| `avg_score` | numeric | Computed average |
| `confidence` | text | `"high"` \| `"medium"` \| `"low"` |
| `initiative_count` | integer | How many initiatives Claude read when scoring |
| `model` | text | Claude model used |
| `scored_at` | timestamptz | |

### `country_summaries`
Claude-generated text descriptions. One current row per country (upserted).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `country_id` | uuid FK UNIQUE | |
| `regulation_status_text` | text | |
| `policy_lever_text` | text | |
| `governance_type_text` | text | |
| `actor_involvement_text` | text | |
| `enforcement_level_text` | text | |
| `specific_laws` | text | Pipe-separated initiative names — auto-populated from `policy_initiatives.name` for the country, not Claude-generated |
| `sources` | text | Pipe-separated `source_url` values — auto-populated from `policy_initiatives.source_url`, not Claude-generated |
| `model` | text | |
| `summarized_at` | timestamptz | |

### `score_history`
Append-only snapshot log. Replaces `public/history.json`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `country_id` | uuid FK | |
| `snapshot_date` | date | |
| `scores` | jsonb | `{regulation_status, policy_lever, governance_type, actor_involvement, enforcement_level, avg_score}` |
| `initiative_count` | integer | |

### `sync_state`
Tracks last successful sync per source.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `source` | text UNIQUE | `"oecd"` \| `"kaggle"` |
| `last_synced_at` | timestamptz | Used as delta cursor for OECD API |
| `last_total` | integer | Total initiatives at last sync |

### Row Level Security
- **Public:** `SELECT` on all tables. No public `INSERT`/`UPDATE`/`DELETE`.
- **Service role** (GitHub Actions only): full access via `SUPABASE_SERVICE_KEY`.
- Anon key is safe to expose in frontend bundle.

### Researcher Export View
```sql
CREATE VIEW public_export AS
SELECT
  c.name AS country, c.iso2, c.iso3, c.region,
  s.regulation_status, s.policy_lever, s.governance_type,
  s.actor_involvement, s.enforcement_level, s.avg_score, s.confidence,
  su.regulation_status_text, su.policy_lever_text, su.governance_type_text,
  su.actor_involvement_text, su.enforcement_level_text,
  su.specific_laws, su.sources, su.summarized_at
FROM countries c
LEFT JOIN country_scores s ON s.country_id = c.id
LEFT JOIN country_summaries su ON su.country_id = c.id;
```
Accessible via PostgREST with `Accept: text/csv` for bulk download.

---

## Backend Pipeline

Replaces `scripts/regulation_pipeline/`. New package at `scripts/sync_pipeline/`.

### Module Structure

```
scripts/
  sync_pipeline/
    __init__.py
    cli.py           — orchestrates full run, CLI flags, reporting
    oecd_sync.py     — fetches OECD API (delta), upserts policy_initiatives
    kaggle_import.py — one-time + manual Kaggle CSV import
    summarizer.py    — Claude reads initiatives, writes scores + summaries
    staleness.py     — identifies countries needing re-summarization
    db.py            — Supabase client wrapper (supabase-py)
    config.py        — env vars, API endpoints, model, thresholds
```

The existing `scripts/regulation_pipeline/` is kept during migration, removed once Supabase is live.

### Run Order (GitHub Actions, monthly)

```
Step 1: oecd_sync.py
  - Read sync_state WHERE source = 'oecd' → last_synced_at
  - Fetch OECD API pages where updatedAt > last_synced_at
    (full sync on first run; delta thereafter)
  - Strip HTML from overview field
  - Match country via iso3 code → countries table
  - Upsert policy_initiatives ON CONFLICT (oecd_id)
  - Update sync_state.last_synced_at = now()
  - Return: set of affected country_ids

Step 2: staleness.py
  - Find countries where:
      max(policy_initiatives.updated_at) > country_summaries.summarized_at
    OR country_summaries row does not exist
  - Also flag countries with initiative_count = 0 (no OECD coverage)
    for optional Claude web-search fallback
  - Return: list of (country_id, has_initiatives, needs_websearch)

Step 3: summarizer.py
  - For each stale country:
    a. SELECT active policy_initiatives for country, ORDER BY start_year DESC
    b. Build structured prompt (see Prompt Design below)
    c. Call Claude → parse JSON response
    d. Upsert country_scores ON CONFLICT (country_id)
    e. Upsert country_summaries ON CONFLICT (country_id)
    f. INSERT score_history (snapshot_date = today)
  - Respect --countries, --force, --dry-run flags (same as current CLI)

Step 4: cli.py reports
  - N initiatives synced (X new, Y updated)
  - M countries re-summarized
  - P countries skipped (no OECD coverage, no web search)
  - Estimated Claude API cost
```

### Claude Prompt Design

Claude's role changes from **researcher** to **analyst**. The prompt is grounded in verified facts:

```
You are scoring AI regulation maturity for {country}.

The following policy initiatives are verified records from the OECD AI Policy Observatory
and other authoritative sources. Base your scores and summaries ONLY on these initiatives.
Do not add information not present below.

POLICY INITIATIVES ({count} total):

1. {name} ({start_year})
   Type: {category} | {initiative_type}
   Binding: {binding}
   Status: {status}
   Overview: {overview}
   Source: {source_url}

2. ...

Return ONLY a valid JSON object:
{
  "regulation_status_score": <1-5>,
  "regulation_status_text": "<1-3 sentences citing specific initiatives>",
  "policy_lever_score": <1-5>,
  "policy_lever_text": "<1-2 sentences>",
  "governance_type_score": <1-5>,
  "governance_type_text": "<1-2 sentences>",
  "actor_involvement_score": <1-5>,
  "actor_involvement_text": "<1-2 sentences>",
  "enforcement_level_score": <1-5>,
  "enforcement_level_text": "<1 sentence>",
  "confidence": "<high|medium|low>"
}

Confidence guide: high = 3+ binding initiatives; medium = strategies/guidelines only; low = 0-1 initiatives.
```

#### Scoring rubrics (all five dimensions)

Every 1–5 scale ships with all five levels defined — no 1/3/5-only rubrics. Intermediate points exist so Claude can distinguish between regimes that are "emerging" (2) vs "in-progress" (3), or between "formal but selective" (4) vs "active enforcement" (5). Anchored to the existing `LEGEND_ENDPOINTS` labels in [src/constants.js](../../../src/constants.js).

**regulation_status** (Minimal → Comprehensive):
1. No regulation, no national engagement
2. Early voluntary guidelines or AI strategy drafted
3. Multiple strategies or draft legislation in progress; some non-binding frameworks in force
4. Binding regulation enacted in specific domains (e.g. public sector, high-risk AI)
5. Comprehensive binding regulation across major AI domains, in force and actively updated

**policy_lever** (Narrow → Broad):
1. Single instrument type (e.g. strategy only, or regulation only)
2. Two instrument types (e.g. strategy + guideline)
3. Three or four instrument types spanning regulation, soft-law, and funding
4. Mix of binding regulation, soft-law, fiscal instruments, and standards
5. Full toolbox — regulation, strategy, funding, standards, international agreements, capacity-building

**governance_type** (Centralized → Distributed):
1. Single central authority handling all AI governance
2. One lead authority with informal sectoral involvement
3. Lead authority plus two or three named sectoral regulators (privacy, finance, health)
4. Multi-actor network with formal coordination mechanisms
5. Fully distributed — independent regulators, civil society bodies, industry self-regulation, cross-border coordination

**actor_involvement** (Limited → Broad):
1. Government only
2. Government plus industry consultation
3. Government plus industry and academia
4. Multi-stakeholder — government, industry, academia, civil society
5. Multi-stakeholder plus international or cross-border actors (OECD, EU, bilateral agreements)

**enforcement_level** (Weak → Strong):
1. No enforcement mechanism
2. Voluntary / advisory-only bodies; no sanctioning power
3. Oversight bodies with soft enforcement (guidance, reporting requirements)
4. Formal oversight with sanctioning powers; selective or inconsistent enforcement
5. Active enforcement — regular audits, documented penalties, visible case history

These rubrics are inserted into the prompt above the `POLICY INITIATIVES` block so Claude has the full scale before reading the facts. The existing `scripts/regulation_pipeline/api.py` prompt has been updated in parallel to close the same gap on its `enforcement_level` scale (previously defined only 1/3/5).

#### Stage-weighted scoring

All initiatives are not equal. A `Binding` regulation in `Active` status carries more signal than a `Non-binding` guideline or an `Inactive – initiative complete` strategy. trackpolicy.org uses this explicitly (enacted bills weighted highest, filed bills lowest) — worth mirroring.

Two implementation options, in order of increasing complexity:

1. **Ordering cue (simplest):** Sort the initiatives in the prompt by descending weight before handing them to Claude. Claude tends to anchor on early items. No weight value exposed to the model — the order itself is the signal.
2. **Explicit guidance line (recommended):** Add one sentence to the prompt, e.g.: *"Weight in-force binding regulations most heavily; weight non-binding strategies and inactive initiatives less. Scores should reflect the regulatory regime in force today, not the stated intent of strategies."*
3. **Numeric weights:** Pre-compute a weight per initiative (e.g. `binding × status_weight × recency`) and include it in the prompt. More precise, but adds a weighting function to maintain. Defer unless option 2 produces inconsistent results across countries with similar initiative counts but different binding/status mixes.

**Recommendation for v1:** Ship option 2. Revisit if scoring variance between countries with similar OECD coverage reveals the model is not weighting binding-ness consistently.

For countries with zero OECD coverage, fall back to current web-search prompt (existing `api.py` logic), but flag confidence as `low`.

### Environment Variables

```
SUPABASE_URL            — Supabase project URL
SUPABASE_SERVICE_KEY    — Service role key (GitHub Actions secret, never in frontend)
ANTHROPIC_API_KEY       — existing
KAGGLE_USERNAME         — for kaggle CLI (optional)
KAGGLE_KEY              — for kaggle CLI (optional)
```

### Python Dependencies to Add

```
supabase>=2.0.0         — Supabase Python client
beautifulsoup4          — HTML stripping for OECD overview field
```

---

## Frontend Changes

### What Changes
`src/data/loader.js` and `src/data/history.js` — replace CSV/JSON fetches with Supabase queries.

### What Does Not Change
Map rendering, legend, zoom, tooltip, panel, controls, state store, CSS. Data shape fed into state remains identical to current structure.

### New File: `src/data/supabase.js`

Initializes the Supabase JS client and exposes typed query helpers.

```js
// Environment variables injected by Vite at build time
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function getScoresAndSummaries() { ... }
// Returns array shaped like current CSV rows for drop-in compatibility

export async function getPolicyInitiatives(countryId) { ... }
// Returns initiatives for country detail panel

export async function getScoreHistory(countryId) { ... }
// Returns snapshots for timeline feature
```

### Modified: `src/data/loader.js`

```js
// Before: fetch + Papa.parse two CSVs in Promise.all
// After:  single Supabase query joining country_scores + country_summaries
```

Return shape is preserved — same field names the state store and map renderer expect.

### Modified: `src/data/history.js`

```js
// Before: fetch('/history.json')
// After:  supabase.from('score_history').select(...)
```

### Country Detail Panel Addition

The panel already shows text descriptions and sources. Add a **Policy Initiatives** section that lists the raw initiatives for a country (name, year, binding status, link). This is the transparency/sourcing layer that prevents hallucination from being invisible.

### Build-time Environment Variables (`.env` / Cloudflare Pages)

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>    ← safe to expose, RLS enforces read-only
```

---

## GitHub Actions Changes

### `update-data.yml` (modified)
- Remove: git commit step (no more CSV files to commit)
- Add: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` secrets
- Run: `python scripts/sync_pipeline/cli.py` instead of `update_data.py`
- Keep: same triggers (1st of month + manual dispatch with country/force/model inputs)

### No Cloudflare deploy trigger needed
Supabase is the live data source — Cloudflare Pages only needs to redeploy when frontend code changes, not when data updates.

---

## Migration Plan (high-level)

1. **Supabase setup** — create project, run schema migrations, configure RLS
2. **Seed countries table** — from existing `country_names.json`
3. **OECD full sync** — run `oecd_sync.py` once to populate all 2,218 initiatives
4. **Kaggle import** — run `kaggle_import.py` for gap-fill countries
5. **Initial summarization** — run `summarizer.py --force` for all countries
6. **Frontend migration** — swap CSV loaders for Supabase queries, test locally
7. **Deploy** — add env vars to Cloudflare Pages, deploy
8. **Cutover** — verify app works end-to-end, remove CSV files from `public/`
9. **Retire old pipeline** — remove `scripts/regulation_pipeline/` once stable

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source for initiatives | OECD API (primary) + Kaggle (gap-fill) | OECD has 2,218 structured records, freely usable with attribution |
| OECD data storage | Yes — store in Supabase | TOU explicitly permits redistribution with citation |
| Claude's role | Analyst (scores + summaries from given facts) | Reduces hallucination and token cost vs. open-ended research |
| Frontend data loading | Supabase JS client, no static CSVs | Single source of truth, enables researcher API |
| Write access | Service role key only (GitHub Actions) | Anon key is read-only via RLS |
| Staleness trigger | `policy_initiatives.updated_at > summarized_at` | Event-driven vs. time-based — only re-summarize when facts change |
| Countries with no OECD coverage | Claude web-search fallback, confidence = low | Maintains global coverage without degrading verified countries |
| History / timeline | `score_history` table (append-only) | Replaces `history.json`, same data shape |
| Peer catalogs (regulations.ai) | Reference only, not ingested | No published methodology or license; better to own the full sourcing chain via OECD + Kaggle + Claude |
| Peer catalogs (trackpolicy.org) | Reference only, not ingested | Different scope (US-heavy bill-level + data centers); its upstream sources (LegiScan / Congress.gov / EUR-Lex) are the v2+ escalation path if we need deeper legislative granularity |
| Status taxonomy | OECD binary (`Active`/`Inactive`) for v1 | Richer 10-step lifecycle deferred; derive later if researchers ask for it |
| Stage-weighted scoring | Guidance line in prompt (option 2 from summarizer section) | Aligns Claude with trackpolicy.org's weighting model without the overhead of numeric pre-computation |
