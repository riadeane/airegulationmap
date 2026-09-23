# PRD 12: Monthly trend piece

Status: Proposed. Owner: unassigned. Depends on: 02 (weekly digest).

## Problem

Weekly digests report events. They do not show direction. A reader who wants
to know whether a region is tightening or loosening over a quarter has to
assemble it from the timeline.

## Users and job

Researchers and journalists writing about trends, who want one sourced,
chart-backed summary per month.

## Goal

On the first run of each month, the pipeline produces a trend piece: charts of
movement by bloc and dimension over the trailing quarter, with a short sourced
narrative built from that month's digests.

## Non-goals

- Forecasts or opinion.
- A separate publishing system. It lives with the digests.

## Requirements

1. **Trigger.** In the digest step, when the run date is the first scheduled
   run of a calendar month, also generate the monthly piece.
2. **Charts.** Rendered as static SVG at generation time (Python, no browser):
   - Maturity index by bloc, trailing 13 weeks, one line per bloc.
   - Net dimension movement across all countries for the month.
   - The ten largest month-over-month movers.
   Use the same colours as the app; embed the SVGs in the digest JSON.
3. **Narrative.** One Claude request with structured output: `{lead, sections:
   [{heading, text, sources}]}`. Input: the month's digest items and the chart
   data. Same source rule as the digest: every URL must come from the input.
4. **Storage and page.** `public/digest/YYYY-MM.json`, listed in
   `index.json` with `kind: "monthly"`. `changes.html` renders monthly pieces
   with the charts inline. The Atom feed includes them.
5. **Backfill.** `python -m regulation_pipeline.digest --monthly YYYY-MM`
   regenerates from stored digests and `history.json`.

## Design notes

- SVG generation: write a small module with no dependency beyond the standard
  library, or use `matplotlib` if already acceptable in `requirements.txt`.
  Prefer hand-built SVG for control over typography and theme.
- Charts must read in both themes: use `currentColor` for text and a neutral
  stroke; encode bloc identity with the OKLCH ramp.

## Acceptance criteria

- A fake three-month history produces a monthly piece with three charts and
  a narrative whose sources all come from the digests.
- The page renders the piece in both themes.

## Open questions

- Should the monthly piece include the gold-set drift for the month?
  Proposed: one sentence with a link to the drift dashboard.
