# PRD 06: Peer comparison shortcuts

Status: Proposed. Owner: unassigned. Depends on: none.

## Problem

Comparison is the natural path for this audience, but starting one takes
several steps: open a country, open the comparison, search for a second
country, then a third. Users do not know which peers are relevant.

## Users and job

A researcher benchmarking one jurisdiction against its bloc or against
countries at a similar maturity.

## Goal

From any selected country, one click starts a comparison with a relevant set
of peers.

## Non-goals

- Changing the comparison panel or radar chart.
- Recommending countries by any signal other than bloc membership and score
  distance.

## Requirements

1. **Peer sets.** For the selected country offer up to three sets:
   - Bloc peers: the country's blocs from `public/data/blocs.json`, one entry
     per bloc, top four members by maturity index.
   - Nearest by maturity: the four countries with the closest `avg_score`.
   - Nearest by profile: the four countries with the smallest Euclidean
     distance across the five dimensions.
2. **Placement.** A "Compare with" row in the panel header area, after the
   scores. Each set is a chip with a count. Click opens the comparison view
   with the selected country plus the set.
3. **State.** Use the existing comparison intents in
   `src/state/interactions.ts` and the URL sync in `src/controls/url.ts`
   (`compare` parameter) so the result is shareable.
4. **Selectors.** Put the peer computation in `src/state/selectors.ts` or a
   new `src/data/peers.ts` with pure functions over the score rows.
5. **Limits.** The comparison view has a maximum country count. Respect it and
   truncate the set, most similar first.

## Design notes

- Chips use the existing bloc chip style from `src/controls/blocSelector.ts`.
- Ties in distance resolve alphabetically so results are deterministic.
- Exclude countries with no scores.

## Acceptance criteria

- Vitest covers the three peer functions with fixed fixtures and asserts
  ordering and exclusion of the selected country.
- Clicking a chip produces a URL that reopens the same comparison.
- No layout shift in the panel when the row appears.

## Open questions

- Should "nearest by profile" weight the three normative dimensions higher?
  Proposed: no, equal weights, documented in the methodology page.
