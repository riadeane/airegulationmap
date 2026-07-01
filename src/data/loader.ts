import { csv } from 'd3-fetch';

/** A row of scores.csv, keyed by camelCase accessors. */
export interface ScoreEntry {
  country: string;
  regulationStatus: number | null;
  policyLever: number | null;
  governanceType: number | null;
  actorInvolvement: number | null;
  averageScore: number | null;
  enforcementLevel: number | null;
  lastUpdated: string | null;
  dataVersion: number;
}

/** A row of regulation_data.csv (free-text fields). */
export interface RegulationEntry {
  country: string;
  regulationStatus: string | null;
  policyLever: string | null;
  governanceType: string | null;
  actorInvolvement: string | null;
  enforcementLevel: string | null;
  specificLaws: string | null;
  sources: string | null;
  lastUpdated: string | null;
  confidence: string | null;
}

export type ScoreData = Record<string, ScoreEntry>;
export type RegulationData = Record<string, RegulationEntry>;

// Valid dimension scores live in [1, 5] (methodology v2 allows
// quarter-point decimals). Parse defensively: the old `+(x) || null`
// idiom let a non-numeric cell through as NaN — `NaN || null` is NaN,
// not null — and NaN then flows into the color scale and filter math.
// This returns a clean number-or-null so the boundary is trustworthy.
const SCORE_MIN = 1;
const SCORE_MAX = 5;

function parseScore(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= SCORE_MIN && v <= SCORE_MAX ? v : null;
}

export async function loadScores(): Promise<ScoreData> {
  const rows = await csv<ScoreEntry>('/scores.csv', d => {
    const version = Number(d['Data Version'] ?? '');
    return {
      country: d.Country ?? '',
      regulationStatus: parseScore(d['Regulation Status']),
      policyLever: parseScore(d['Policy Lever']),
      governanceType: parseScore(d['Governance Type']),
      actorInvolvement: parseScore(d['Actor Involvement']),
      averageScore: parseScore(d['Average Score']),
      enforcementLevel: parseScore(d['Enforcement Level']),
      lastUpdated: d['Last Updated'] || null,
      dataVersion: Number.isFinite(version) && version >= 1 ? version : 1,
    };
  });
  // Drop rows with no country key — a blank/garbled line must not create
  // an empty-string entry that later renders as a ghost country.
  return Object.fromEntries(
    rows.filter(d => d.country).map(d => [d.country, d])
  );
}

export async function loadRegulation(): Promise<RegulationData> {
  const rows = await csv<RegulationEntry>('/regulation_data.csv', d => ({
    country: d.Country ?? '',
    regulationStatus: d['Regulation Status'] ?? null,
    policyLever: d['Policy Lever'] ?? null,
    governanceType: d['Governance Type'] ?? null,
    actorInvolvement: d['Actor Involvement'] ?? null,
    enforcementLevel: d['Enforcement Level'] || null,
    specificLaws: d['Specific Laws'] || null,
    sources: d['Sources'] || null,
    lastUpdated: d['Last Updated'] || null,
    confidence: d['Confidence'] || null,
  }));
  return Object.fromEntries(rows.map(d => [d.country, d]));
}
