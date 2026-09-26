// Bloc membership data + aggregate statistics.
// computeBlocStats and the evidence-share helpers are pure and unit-tested;
// loadBlocs mirrors loadHistory's contract (null on any failure, callers
// degrade).

import type { AttributeKey } from '../constants';
import type { ScoreData } from './loader';
import type { EvidenceRecord } from './evidence';

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

/** How many of a bloc's members were researched with verified initiatives. */
export interface BlocEvidenceShare {
  memberCount: number;
  /** Members with a run record (an `evidence` entry in subscores.json). */
  recorded: number;
  /** Recorded members whose research embedded verified initiatives. */
  grounded: number;
  /** grounded / recorded, 0..1. */
  share: number;
}

export async function loadBlocs(knownCountries: string[] | null = null): Promise<BlocsData | null> {
  try {
    const response = await fetch('/data/blocs.json');
    if (!response.ok) return null;
    const parsed = (await response.json()) as Record<string, unknown>;
    delete parsed._comment; // metadata key in blocs.json, not a bloc
    const data = parsed as unknown as BlocsData;

    // Dev-time guard: bloc member names must exactly match scores.csv -
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

/**
 * Share of a bloc's members whose latest research was grounded in verified
 * policy initiatives (PRD 14). The denominator is the members with a run
 * record, not the whole bloc: a member researched before the record existed
 * is unknown, not ungrounded. Returns null when no member has a record.
 */
export function computeBlocEvidenceShare(
  members: readonly string[],
  evidenceOf: (country: string) => EvidenceRecord | null | undefined
): BlocEvidenceShare | null {
  let recorded = 0;
  let grounded = 0;
  for (const name of members) {
    const record = evidenceOf(name);
    if (!record) continue;
    recorded++;
    if (record.grounded) grounded++;
  }
  if (recorded === 0) return null;
  return { memberCount: members.length, recorded, grounded, share: grounded / recorded };
}

/**
 * The bloc card's evidence line: grounded members out of those with a run
 * record, percentage rounded to an integer. The "with a run record"
 * qualifier appears only while some members have no record yet.
 */
export function blocEvidenceShareText(share: BlocEvidenceShare): string {
  const scope = share.recorded === share.memberCount ? 'members' : 'members with a run record';
  const pct = Math.round(share.share * 100);
  return `Grounded in verified initiatives: ${share.grounded} of ${share.recorded} ${scope} (${pct}%)`;
}
