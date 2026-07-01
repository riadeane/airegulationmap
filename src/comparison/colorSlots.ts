// Stable colour-slot assignment for the comparison set.
//
// A country keeps its colour for the lifetime of its presence in the
// comparison — removing a middle country must not reshuffle the others'
// colours (which happens if callers key off the array index). This lives in
// its own leaf module (imports nothing but the palette) so both the map
// renderer and the comparison panel can read slot colours without either
// feature importing the other — that circular import was the old coupling.
//
// `syncColorSlots` is the single writer and is called by the interactions
// orchestrator immediately before it commits a new comparison set, so every
// subscriber that later reads a slot sees a fully-assigned map.

import { MAX_COMPARISON } from '../constants';
import { comparisonColor } from './colors';

const colorSlots = new Map<string, number>(); // countryName -> 0..MAX_COMPARISON-1

export function syncColorSlots(names: readonly string[]): void {
  // Release slots for countries that left the list.
  for (const name of [...colorSlots.keys()]) {
    if (!names.includes(name)) colorSlots.delete(name);
  }
  // Assign slots to new countries, reusing the lowest free index.
  const used = new Set(colorSlots.values());
  for (const name of names) {
    if (colorSlots.has(name)) continue;
    for (let i = 0; i < MAX_COMPARISON; i++) {
      if (!used.has(i)) {
        colorSlots.set(name, i);
        used.add(i);
        break;
      }
    }
  }
}

export function getColorIndex(name: string): number {
  return colorSlots.get(name) ?? 0;
}

export function getColorFor(name: string): string {
  return comparisonColor(getColorIndex(name));
}
