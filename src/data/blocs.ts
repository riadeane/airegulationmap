// Bloc membership data + aggregate statistics.
// computeBlocStats is pure and unit-tested; loadBlocs mirrors
// loadHistory's contract (null on any failure, callers degrade).

import type { AttributeKey } from '../constants';
import type { ScoreData } from './loader';

export interface Bloc {
  name: string;
  members: string[];
}

export type BlocsData = Record<string, Bloc>;

export interface BlocMemberScore {
  name: string;
  score: number;
}

export interface BlocStats {
  average: number;
  min: number;
  max: number;
  stdDev: number;
  memberCount: number;
  scoredCount: number;
  highest: BlocMemberScore;
  lowest: BlocMemberScore;
}

export async function loadBlocs(knownCountries: string[] | null = null): Promise<BlocsData | null> {
  try {
    const response = await fetch('/data/blocs.json');
    if (!response.ok) return null;
    const parsed = (await response.json()) as Record<string, unknown>;
    delete parsed._comment; // metadata key in blocs.json, not a bloc
    const data = parsed as unknown as BlocsData;

    // Dev-time guard: bloc member names must exactly match scores.csv —
    // catches silent drift if the dataset ever renames a country.
    if (import.meta.env.DEV && knownCountries) {
      const known = new Set(knownCountries);
      for (const [key, bloc] of Object.entries(data)) {
        const missing = bloc.members.filter(m => !known.has(m));
        if (missing.length > 0) {
          console.warn(`[blocs] ${key} members not in score data: ${missing.join(', ')}`);
        }
      }
    }
    return data;
  } catch {
    console.warn('blocs.json not available, bloc filter disabled');
    return null;
  }
}

/**
 * Aggregate stats for a bloc on one attribute. Members without a score
 * for that attribute are excluded from the math but counted in
 * memberCount. Returns null when no member has a score.
 */
export function computeBlocStats(
  members: string[],
  scoreData: ScoreData,
  attribute: AttributeKey
): BlocStats | null {
  const scored: BlocMemberScore[] = [];
  for (const name of members) {
    const score = scoreData[name]?.[attribute];
    if (score != null) scored.push({ name, score });
  }

  if (scored.length === 0) return null;

  const scores = scored.map(d => d.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length;

  let highest = scored[0];
  let lowest = scored[0];
  for (const d of scored) {
    if (d.score > highest.score) highest = d;
    if (d.score < lowest.score) lowest = d;
  }

  return {
    average: +avg.toFixed(2),
    min: Math.min(...scores),
    max: Math.max(...scores),
    stdDev: +Math.sqrt(variance).toFixed(2),
    memberCount: members.length,
    scoredCount: scored.length,
    highest,
    lowest,
  };
}
