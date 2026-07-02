# Evidence-Grounded Supabase Backend + Product/UX Round

**Date:** 2026-07-02
**Status:** Implemented (this document is the as-built record)
**Supersedes:** [docs/superpowers/specs/2026-04-06-supabase-oecd-integration-design.md](../superpowers/specs/2026-04-06-supabase-oecd-integration-design.md)

## Context

The two architecture PRs (#18 backend, #19 frontend) left the codebase in
excellent shape but changed no product substance. This round shipped the
product work on top of them: fixing real researcher-flow defects, making
every view citeable, and building the long-planned Supabase backend — in a
revised, safer shape than the 2026-04 spec.

## The architecture call

**Supabase is the system of record and researcher API; the static files in
`public/` are its published snapshot.** The pipeline dual-writes both on
every run; the frontend boots from the static files always and reads
Supabase only as progressive enhancement. Rationale: dual-write keeps the
statics exactly as fresh as the database, a free-tier project pauses when
idle (so a Supabase-primary boot would be *less* robust), and env-gated
enhancement keeps CI hermetic. The 2026-04 spec's "remove the CSVs / retire
regulation_pipeline" steps were deliberately not executed.

The goal the owner actually asked for — scoring that is "not just dependent
on the prompt" — is delivered by the evidence layer: verified OECD/GAIIN
policy-initiative records ground the research prompt (`--grounded`), an
accumulating sources database records every URL ever cited with
classification and provenance, and a `research_runs` table makes every
score traceable to the run, model, and prompt version that produced it.

## What shipped

### Stage 0 — UX round (3 commits)
- **Bug fixes:** filtered exports ignored the bloc filter (three surfaces
  had diverging visibility predicates — now one selector,
  `visibleCountrySet()`); the country panel silently showed latest scores
  while the timeline scrubbed the map (panel now re-vintages with a
  notice); the score-range filter was not in the URL (now `min`/`max`).
- **Citability:** header Share popover (permalink + APA/Chicago/MLA for ANY
  view); committed full-text search (`?q=`) with a persistent results list,
  jump-to-matched-field highlighting, exportable match set, and dimming
  that survives browsing; comparison-set export; source display upgrade
  path (titles when metadata exists).
- **Discovery:** confidence + official-sources-only filter axes
  (deep-linkable `conf`/`official`); scatter trend line with Pearson's r
  over the visible dots; persistent methodology links in the panel.

### Stage 1 — Schema + seed
`supabase/migrations/`: `countries` (with ISO codes from the new
`public/data/country_iso.json`, machine-verified against the TopoJSON
geometry ids), `country_scores` (methodology-v2 sub-indicators as lossless
jsonb), `country_summaries`, `score_history` (change-point snapshots,
replace-per-country semantics), `sources` + `country_sources` (the
deep-research database), `policy_initiatives` (nullable `country_id`;
unmatched stays unlinked, never guessed), `research_runs`, `sync_state`.
RLS: public SELECT everywhere; writes via service role only.
`public_export`/`sources_export` views serve PostgREST JSON + CSV.
Seeded from the live files: 196 countries, 451 history snapshots, 750
sources, verified row-for-row.

### Stage 2 — Dual-write mirror
`db/mirror.py` as an optional `PipelineService` collaborator — outside
`Dataset`, so the byte contracts stay untouched; every call is downgraded
to a warning so mirror failure can never change a run's outcome. Cumulative
token usage lands in the run row.

### Stage 3 — Evidence layer
`evidence/`: OECD/GAIIN adapter built against the live API shape
(`api.oecdai.org` primary, older wrapper fallback; no server-side
filtering exists → client-side delta on `updated_at`), conservative
country matching (ISO3 → canonical name → unlinked; never fuzzy),
never-deleting sync, `probe`/`sync` CLI, and the grounded prompt mode
(evidence block capped at 15 initiatives / 400-char overviews; identical
output schema). Live full sync: 2,354 initiatives, 2,248 linked across 89
countries, 11 unmatched labels — all IGOs, by design. Sources database
grew 750 → 2,661 URLs.

### Stage 4 — Frontend enhancement
`data/supabase.ts` (40-line PostgREST reader, no client library),
post-boot hydration (strictly-newer gate, same validation boundary as the
CSV loader), Policy Initiatives panel section with OECD attribution,
source-title upgrades, and `public/data.html` — the researcher-facing
Data & API documentation.

### Stage 5 — Workflows + docs
`update-data.yml` gains the Supabase secrets (mirror auto-activates), an
evidence-sync pre-step and `--grounded` both gated on the repo variable
`EVIDENCE_SYNC_ENABLED`, and a step summary. `evidence-sync.yml` offers
manual probe/sync dispatches. CI gains a circular-import check and builds
the e2e bundle with dummy Supabase env so the enhancement path is
exercised hermetically.

## Operational notes

- Project: Supabase free tier, `eu-central-1`. Free projects pause after
  ~1 week of idle; the app tolerates this (static boot) — the researcher
  API resumes on restore.
- Secrets: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (Actions),
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (Cloudflare Pages build).
- Rollout order for grounding: dispatch `evidence-sync.yml` (probe, then
  sync-delta) once from Actions to validate the path, flip
  `EVIDENCE_SYNC_ENABLED=true`, then review a 2–3 country `--grounded`
  run before the monthly cron uses it.

## Explicitly deferred

Source title enrichment (display path is wired; needs a batch job filling
`sources.title`); per-dimension source attribution; a flattened
sub-indicator SQL view; Kaggle as a second `EvidenceSource`; the
embeddable widget (PLANS/08); the keyboard/a11y bundle.
