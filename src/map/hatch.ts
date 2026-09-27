import type { BaseType, Selection } from 'd3-selection';

// The low-confidence hatch (PRD 13): one diagonal-line <pattern> that the
// map's second fill layer paints over a country's score colour. The marks
// take the map stroke colour at low opacity (`.hatch-mark` in _map.css,
// `--hatch-opacity` in _tokens.css), so the texture reads in both themes
// without adding a colour channel, and the score colour stays legible
// between the lines.

/** Pattern id the map's hatch layer references. */
export const HATCH_ID = 'hatch-low';

/** Screen pixels between hatch lines. */
const SPACING = 4;
/** Width of one hatch line, in screen pixels. */
const LINE_WIDTH = 1;

/**
 * patternTransform for zoom scale `k`. The map group carries the zoom
 * transform and the pattern tiles in that group's user space, so an
 * uncompensated tile would widen with every zoom step (and would collapse
 * into a flat tint in any view smaller than the default). Scaling the tile
 * by 1/k keeps the lines about SPACING px apart on screen at every zoom
 * level.
 *
 * k is snapped to quarter-octave steps first: every change of the
 * transform re-records the pattern for the next paint, and following k
 * exactly re-recorded it on every frame of a zoom animation. Snapped, a
 * zoom step changes it two or three times, and the on-screen spacing stays
 * within about 9% of SPACING (exact at the default zoom and at 2x, 4x, 8x).
 */
export function hatchTransform(k: number): string {
  if (!Number.isFinite(k) || k <= 0) return 'rotate(45)';
  const snapped = 2 ** (Math.round(Math.log2(k) * 4) / 4);
  return snapped === 1 ? 'rotate(45)' : `rotate(45) scale(${1 / snapped})`;
}

/**
 * The countries the hatch layer draws, in `names` order: those low
 * confidence at the shown date that carry a score colour. "No data"
 * countries keep their plain fill, and nothing is hatched while "Show
 * uncertainty" is off.
 */
export function hatchedCountries(
  names: Iterable<string>,
  { show, hasScore, isLow }: {
    show: boolean;
    hasScore: (name: string) => boolean;
    isLow: (name: string) => boolean;
  }
): Set<string> {
  const hatched = new Set<string>();
  if (!show) return hatched;
  for (const name of names) if (hasScore(name) && isLow(name)) hatched.add(name);
  return hatched;
}

/** Append the hatch pattern to `defs` under `id`, at the default zoom. */
export function appendHatchPattern<P extends BaseType, PD>(
  defs: Selection<SVGDefsElement, unknown, P, PD>,
  id: string
): Selection<SVGPatternElement, unknown, P, PD> {
  const pattern = defs.append<SVGPatternElement>('pattern')
    .attr('id', id)
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('width', SPACING)
    .attr('height', SPACING)
    .attr('patternTransform', hatchTransform(1));
  pattern.append('rect')
    .attr('class', 'hatch-mark')
    .attr('width', LINE_WIDTH)
    .attr('height', SPACING);
  return pattern;
}
