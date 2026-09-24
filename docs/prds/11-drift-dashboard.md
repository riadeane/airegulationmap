# PRD 11: Drift dashboard

Status: Implemented (September 2026). Owner: unassigned. Depends on: 08 (optional, for gold metrics). The confidence figure is a cross-section by research vintage until the pipeline records confidence per run (see the implementation note at the end).

## Problem

Weekly re-scoring means the dataset moves. Readers cannot see how much it
moves, and the maintainer cannot see whether a run behaved normally without
reading diffs.

## Users and job

Readers judging how stable the data is before they cite it. The maintainer
checking a run at a glance.

## Goal

A static page that shows, week by week, how much the data changed and how
confident it is.

## Non-goals

- Interactivity beyond hover. This is a report, not an explorer.
- Real-time data. It reads the committed files.

## Requirements

1. **Page.** `drift.html` in the style of `methodology.html`, linked from the
   app menu and from `data.html`.
2. **Charts** (D3, small multiples, both themes, colourblind-safe):
   - Countries changed per week, stacked by which dimension moved.
   - Distribution of score deltas per week (a strip or histogram).
   - Share of countries at each confidence level over time.
   - Gold-set agreement per run when `public/data/drift.json` exists (PRD 08).
3. **Table.** Latest run: date, model, countries attempted and succeeded,
   applied, held, and unchanged counts from the gate (PRD 01), and the ten
   largest moves with links to the country.
4. **Sources.** `history.json` for score movement, `regulation_data.csv` for
   confidence, `drift.json` for gold metrics, and `research_runs` via the
   Supabase reader when configured (fallback: omit the run table).
5. **Copy.** One paragraph at the top that states what the page measures and
   what it does not (it measures the pipeline, not the world).

## Design notes

- Build with the same D3 and TopoJSON-free setup as the scatter view. Put
  the page logic in `src/drift.ts` with its own Vite entry.
- Reuse the selectors from `src/data/changelog.ts` and `src/data/history.ts`.
- Charts use the OKLCH scale from the legend and the neutral tints from the
  tokens. No new colours.

## Acceptance criteria

- The page renders with the committed data and with `drift.json` absent.
- Vitest covers the weekly aggregation functions.
- Every chart has a text alternative (a caption with the key numbers).

## Open questions

- Should the page expose per-bloc drift? Proposed: yes if it fits in one
  small multiple, otherwise defer.

## Implementation note

- `drift.html` + `src/drift.ts` (page entry), `src/charts/drift.ts` (the
  D3 small multiples), `src/data/drift.ts` (pure aggregations, covered by
  `tests/drift.test.js`). Linked from the app header (`src/controls/menu.ts`),
  `data.html`, and `changes.html`; listed in the sitemap.
- Colours: ordered series use a single-hue lightness ramp off the legend's
  high pole mixed toward the page's light neutral (5 steps for the
  dimensions, 3 for confidence); magnitudes use a neutral-to-pole sequential
  fill; first assessments use `--no-data`. Both ramps were checked with the
  dataviz palette validator in both themes.
- Confidence: `regulation_data.csv` keeps only each entry's current label
  and `history.json` carries no confidence, so "over time" is served as a
  cross-section by the run that last updated each entry. It becomes a true
  series once the pipeline records confidence per run.
- Per-bloc drift ships as one small multiple (a bloc-by-run heat grid).
- Every figure has a caption with the key numbers and a "Show as a table"
  twin; hover tooltips are the only interactivity.
