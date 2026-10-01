// How a country's map fill is chosen, as pure functions (no DOM, no CSS
// reads) so the rule is unit-testable: a score gets the ramp colour, a row
// whose value is null gets the "insufficient evidence" neutral, and a
// country with no row gets the "no data" fill. The colour scale clamps
// its domain, so a null fed to it would paint as the colour for 1; this is
// the one guard that keeps that from happening.
//
// The frontier lens (PRD 15) has the same three states: a row with no
// frontier track leaves `frontierRisk` absent (no data), a track with an
// empty score is null (insufficient evidence). "Not applicable" exists only
// for a frontier sub-indicator, never for a country, so it never reaches
// the map.

import { isInsufficient } from '../constants';
import type { AttributeKey } from '../constants';

/** The score fields a map entry carries (a live row or a history snapshot). */
type ScoredEntry = Partial<Record<AttributeKey, number | null>>;

export type FillState = 'score' | 'insufficient' | 'no-data';

/** Which of the three fills a country takes on `attr`. */
export function fillState(entry: ScoredEntry | undefined, attr: AttributeKey): FillState {
  if (!entry) return 'no-data';
  const value = entry[attr];
  if (isInsufficient(value)) return 'insufficient';
  return value != null && Number.isFinite(value) ? 'score' : 'no-data';
}

/** The fill colour for a country: `colorScale(score)` only for a real score. */
export function fillColor(
  entry: ScoredEntry | undefined,
  attr: AttributeKey,
  colorScale: (value: number) => string,
  colors: { noData: string; insufficient: string }
): string {
  switch (fillState(entry, attr)) {
    case 'score': return colorScale(entry![attr] as number);
    case 'insufficient': return colors.insufficient;
    default: return colors.noData;
  }
}

/** True when at least one entry is "insufficient evidence" on `attr`: the
 * legend shows its key only then. */
export function anyInsufficient(
  data: Record<string, ScoredEntry | undefined>,
  attr: AttributeKey
): boolean {
  return Object.values(data).some(entry => fillState(entry, attr) === 'insufficient');
}
