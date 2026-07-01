// Derived state — computed views over the store, memoized so a derivation
// isn't rebuilt on every render. This is the read-side counterpart to the
// interactions orchestrator (the write side): modules ask a selector for a
// derived value instead of recomputing it inline (which the panel used to do
// for the maturity ranking on every single country selection).
//
// Memoization keys on the source object's reference. The score data is
// replaced wholesale on load and never mutated in place (the store enforces
// this), so reference identity is a sound cache key.

import { getState } from './store';
import type { ScoreData } from '../data/loader';

export interface RankResult {
  rank: number;
  total: number;
}

let rankCache: { data: ScoreData; ranks: Map<string, number>; total: number } | null = null;

function rankTable(data: ScoreData) {
  if (rankCache && rankCache.data === data) return rankCache;

  const values = Object.values(data)
    .map(d => d.averageScore)
    .filter((v): v is number => v != null);
  // Descending sort; a value's rank is the position of its first occurrence,
  // so ties share a rank (equivalent to "strictly-greater count + 1").
  const sortedDesc = [...values].sort((a, b) => b - a);
  const rankByValue = new Map<number, number>();
  sortedDesc.forEach((v, i) => { if (!rankByValue.has(v)) rankByValue.set(v, i + 1); });

  const ranks = new Map<string, number>();
  for (const [name, entry] of Object.entries(data)) {
    if (entry.averageScore != null) ranks.set(name, rankByValue.get(entry.averageScore)!);
  }

  rankCache = { data, ranks, total: values.length };
  return rankCache;
}

/** Maturity-index rank of a country among those with a composite score (ties
 *  share a rank), or null when the country has no score. */
export function maturityRank(country: string): RankResult | null {
  const table = rankTable(getState().scoreData);
  const rank = table.ranks.get(country);
  return rank == null ? null : { rank, total: table.total };
}
