# PRD 07: Printable country brief

Status: Implemented (September 2026, #51). Owner: unassigned. Depends on: 03 (optional, for rationales).

## Problem

Researchers paste country findings into memos and briefs. Today they copy
text from the panel piece by piece, or export CSV and reformat it.

## Users and job

A desk researcher who needs a one-page reference entry for a country, with
sources and date, to attach to a document or print.

## Goal

One action produces a clean, one-to-two page brief for the selected country
using the browser's print path. Save as PDF works without extra code.

## Non-goals

- Server-side PDF generation.
- Multi-country briefs. Use the export for that.

## Requirements

1. **Action.** "Print brief" in the panel actions next to Cite and Share.
   It calls `window.print()` with a body class that switches the print layout.
2. **Print layout.** A print stylesheet `src/styles/_print.css`:
   - Hide the map, header controls, timeline, and comparison.
   - Show the panel content at full page width, single column.
   - Sections in this order: title and ISO codes, scores table with the
     maturity index, sub-indicators (with rationales if present), the five text
     sections, specific laws, sources as full URLs, confidence and last updated,
     citation line, and the permanent link.
   - Page margins 20 mm, serif body at 11 pt, no colour fills. Score bars
     become numbers.
3. **Sources.** Print the full URL after each source title so a paper copy
   stays traceable.
4. **Header and footer.** Site name and the ISO date on every page through
   `@page` margins where the browser supports it.
5. **Keyboard.** `Ctrl/Cmd+P` while a country is selected uses the same
   layout.

## Design notes

- The panel already renders everything needed; the work is the stylesheet
  and the ordering. Avoid duplicating markup for print.
- Use `@media print` only. Do not add print-only DOM except the citation
  line if the popover markup is not printable.
- Test in Chrome and Safari print preview; Firefox is best effort.

## Acceptance criteria

- Print preview for Germany fits two pages at A4 and Letter.
- No element from the map or controls appears in the print output.
- A screenshot of the preview is attached to the PR.

## Open questions

- Should the brief include the radar chart as a static image? Proposed:
  defer; numbers are enough for a memo.
