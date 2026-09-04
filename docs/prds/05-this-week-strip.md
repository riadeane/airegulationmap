# PRD 05: "This week" strip on the map

Status: Proposed. Owner: unassigned. Depends on: 01 (stability gate).

## Problem

A returning visitor sees the same map every week and has no way to tell what
changed without opening countries one by one.

## Users and job

Returning researchers who want to know what moved since their last visit
before they do anything else.

## Goal

The map view shows a compact band of the countries whose gated scores changed
in the last seven days. One click selects the country.

## Non-goals

- A full changelog view. That is PRD 02.
- Any layout change to the map or panel.

## Requirements

1. **Data.** Compute changed countries from `history.json` using
   `src/data/changelog.ts` and `src/data/history.ts`: any snapshot dated in the
   last seven days whose scores differ from the previous snapshot.
2. **Strip.** A single-row band below the header. Each item: country name,
   the dimension with the largest move, and the delta with a sign. Sort by
   absolute delta. Cap at eight items with a "+N more" link to `changes.html`
   when PRD 02 exists, or to the comparison view otherwise.
3. **Interaction.** Click selects the country through the existing intent in
   `src/state/interactions.ts`. Hover highlights the country on the map using
   the existing highlight path.
4. **Empty state.** Hide the strip when nothing changed. Never show an empty
   band.
5. **Dismiss.** A close control hides the strip for the session
   (`sessionStorage`). The menu offers "Show this week's changes" to bring it
   back.
6. **URL.** No new URL state.

## Design notes

- The strip must not push the map down more than one line of text. Use the
  header's neutral tint; no accent fill.
- Keyboard: items are buttons, tabbable in order.
- Add styles in a new partial `src/styles/_thisweek.css` and import it with
  the others.

## Acceptance criteria

- Vitest covers the "changed in last seven days" selector with fixtures.
- The strip renders in both themes and at 375 px width (wraps to a horizontal
  scroll, never a second row).
- The strip is absent when `history.json` has no change in the window.

## Open questions

- Should the strip also show new low-confidence flags? Proposed: no.
