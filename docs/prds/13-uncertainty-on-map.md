# PRD 13: Uncertainty on the map

Status: Proposed; implementation in PR #58, not merged. Owner: unassigned. Depends on: none.

## Problem

The choropleth paints a low-confidence score with the same certainty as a
high-confidence one. A reader sees Chad and Germany in equally solid colour
and infers equal reliability.

## Users and job

Researchers who need to know which readings they can rely on before they
compare or cite.

## Goal

Low-confidence countries are visibly distinct on the map without adding a
second colour channel.

## Non-goals

- Replacing the confidence filter. The filter stays.
- Showing confidence for medium. Only low gets a texture.

## Requirements

1. **Texture.** Countries with confidence `low` render with a diagonal hatch
   over their fill colour. The hatch uses the map's stroke colour at low
   opacity so the underlying score remains readable.
2. **Legend.** The legend gains a swatch: "Hatched: low confidence".
3. **Toggle.** A menu item "Show uncertainty" (default on), persisted in
   `localStorage`. The URL does not carry it.
4. **Tooltip.** The tooltip already shows confidence; keep it, and add the
   word "low confidence" in the tooltip title line for hatched countries.
5. **Timeline.** Hatching follows the confidence of the snapshot shown at the
   selected date when history carries confidence; otherwise use the current
   confidence and say so in the legend.
6. **Themes.** The hatch must be visible in both themes and must not reduce
   contrast of country borders below the current level.

## Design notes

- Implement with one `<pattern>` in the SVG `<defs>` and a second fill layer
  in `src/map/renderer.ts`: draw the country path once with the score fill,
  then again with `fill: url(#hatch-low)` when confidence is low. Avoid
  per-country pattern definitions.
- Keep the hatch spacing at about 4 px at the default zoom and scale it with
  the zoom transform so it does not turn into a solid tint when zoomed out.
- The colourblind-safe requirement is met by texture, which does not depend
  on hue.

## Acceptance criteria

- Screenshot at default zoom and at max zoom in both themes shows the hatch
  clearly and the borders unchanged.
- Vitest covers the "is low confidence at date" selector.
- Performance: no measurable change in map render time (measure with the
  Performance panel on a full render, before and after).

## Open questions

- Should countries with no data get the same hatch? Proposed: no, they keep
  the existing "no data" fill.
