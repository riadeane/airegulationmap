// Peer sets for the panel's "Compare with" shortcuts: which countries are
// worth benchmarking a selected country against. Pure functions over the
// score rows (plus bloc membership), so they are unit-tested with fixtures.
// The panel calls them on selection; the interactions orchestrator opens
// the result.
//
// Every set lists peers most similar first, so cutting a set to the
// comparison cap keeps the closest ones. Ties resolve alphabetically (plain
// code-unit order, the same order as sortedCountryNames) so a set is
// deterministic. A country without the scores a set needs is excluded.

import type { DimensionKey } from '../constants';
import type { ScoreData, ScoreEntry } from './loader';
import type { BlocsData } from './blocs';

// The five independently scored dimensions. They carry equal weight in the
// profile distance (see public/methodology.html, "Peer sets").
const PROFILE_DIMENSIONS: readonly DimensionKey[] = [
  'regulationStatus', 'policyLever', 'governanceType', 'actorInvolvement', 'enforcementLevel',
];

export type PeerSetKind = 'bloc' | 'maturity' | 'profile';

export interface PeerSet {
  kind: PeerSetKind;
  /** Short chip label: the bloc code, or the similarity criterion. */
  label: string;
  /** One-line description of the criterion for the tooltip and aria-label. */
  criterion: string;
  /** Peers, most similar first. Never includes the selected country. */
  members: readonly string[];
}

interface Ranked {
  name: string;
  /** Lower ranks first. */
  key: number;
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ascending by key, alphabetical on ties, first `limit` names. */
function takeLowest(ranked: Ranked[], limit: number): string[] {
  return ranked
    .sort((a, b) => a.key - b.key || byName(a.name, b.name))
    .slice(0, limit)
    .map(r => r.name);
}

/**
 * The `limit` countries whose maturity index is closest to the selected
 * country's. Empty when the selected country has no maturity index.
 */
export function nearestByMaturity(country: string, scoreData: ScoreData, limit: number): string[] {
  const own = scoreData[country]?.averageScore;
  if (own == null) return [];
  const ranked: Ranked[] = [];
  for (const [name, entry] of Object.entries(scoreData)) {
    if (name === country || entry.averageScore == null) continue;
    ranked.push({ name, key: Math.abs(entry.averageScore - own) });
  }
  return takeLowest(ranked, limit);
}

// The five dimension values, or null when any is missing: a partial
// profile has no distance.
function profileOf(entry: ScoreEntry | undefined): number[] | null {
  if (!entry) return null;
  const values: number[] = [];
  for (const key of PROFILE_DIMENSIONS) {
    const v = entry[key];
    if (v == null) return null;
    values.push(v);
  }
  return values;
}

/**
 * The `limit` countries with the smallest Euclidean distance to the
 * selected country across the five dimensions, all weighted equally.
 * Ranks by the squared distance: the order is the same and the sum of
 * quarter-point squares is exact in floating point, so ties are real ties.
 */
export function nearestByProfile(country: string, scoreData: ScoreData, limit: number): string[] {
  const own = profileOf(scoreData[country]);
  if (!own) return [];
  const ranked: Ranked[] = [];
  for (const [name, entry] of Object.entries(scoreData)) {
    if (name === country) continue;
    const profile = profileOf(entry);
    if (!profile) continue;
    const key = profile.reduce((sum, v, i) => sum + (v - own[i]) ** 2, 0);
    ranked.push({ name, key });
  }
  return takeLowest(ranked, limit);
}

/**
 * One set per bloc the country belongs to: the top `limit` other members
 * by maturity index. Members without a maturity index are excluded; a bloc
 * with no other scored member yields no set. Sets follow blocs.json order.
 */
export function blocPeers(
  country: string,
  blocsData: BlocsData | null,
  scoreData: ScoreData,
  limit: number,
): PeerSet[] {
  if (!blocsData) return [];
  const sets: PeerSet[] = [];
  for (const [code, bloc] of Object.entries(blocsData)) {
    if (!bloc.members.includes(country)) continue;
    const ranked: Ranked[] = [];
    for (const name of bloc.members) {
      const score = scoreData[name]?.averageScore;
      if (name === country || score == null) continue;
      // Negated so the highest maturity index ranks first.
      ranked.push({ name, key: -score });
    }
    const members = takeLowest(ranked, limit);
    if (members.length === 0) continue;
    sets.push({
      kind: 'bloc',
      label: code,
      criterion: `${bloc.name} members with the highest maturity index`,
      members,
    });
  }
  return sets;
}

/**
 * Every peer set for the country, in display order: bloc sets, then
 * nearest by maturity, then nearest by profile. Empty sets are omitted.
 */
export function peerSets(
  country: string,
  scoreData: ScoreData,
  blocsData: BlocsData | null,
  limit: number,
): PeerSet[] {
  const sets = blocPeers(country, blocsData, scoreData, limit);
  const maturity = nearestByMaturity(country, scoreData, limit);
  if (maturity.length > 0) {
    sets.push({
      kind: 'maturity',
      label: 'Similar maturity',
      criterion: 'Closest maturity index',
      members: maturity,
    });
  }
  const profile = nearestByProfile(country, scoreData, limit);
  if (profile.length > 0) {
    sets.push({
      kind: 'profile',
      label: 'Similar profile',
      criterion: 'Smallest distance across all five dimensions',
      members: profile,
    });
  }
  return sets;
}
