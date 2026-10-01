import { text } from 'd3-fetch';
import { csvParse } from 'd3-dsv';
import type { DSVRowString } from 'd3-dsv';

import { parseFrontierTrack } from '../constants';
import type { FrontierTrack } from '../constants';

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
  /**
   * Frontier Risk Governance (PRD 15): a number, null for insufficient
   * evidence on the country's track, or absent (undefined) when the
   * country has never been scored on the lens ("no data" there). Never
   * part of averageScore.
   */
  frontierRisk?: number | null;
  /** The track the frontier score was made on; absent with no frontier data. */
  frontierTrack?: FrontierTrack | null;
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
  /** 1-3 sentences on how the country governs frontier AI risk (PRD 15). */
  frontierRisk: string | null;
  /** Pipe-separated URLs behind the frontier text, like `sources`. */
  frontierSources: string | null;
}

export type ScoreData = Record<string, ScoreEntry>;
export type RegulationData = Record<string, RegulationEntry>;

// Valid dimension scores live in [1, 5] (methodology v2 allows
// quarter-point decimals). Parse defensively: the old `+(x) || null`
// idiom let a non-numeric cell through as NaN - `NaN || null` is NaN,
// not null - and NaN then flows into the color scale and filter math.
// This returns a clean number-or-null so the boundary is trustworthy.
const SCORE_MIN = 1;
const SCORE_MAX = 5;

// Exported so the Supabase hydration path (data/hydrate.ts) runs numeric
// values through the exact same validation boundary as the CSV path.
export function parseScore(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= SCORE_MIN && v <= SCORE_MAX ? v : null;
}

/**
 * The frontier fields of a row (PRD 15). An empty track means the country
 * has never been scored on the lens, so both keys stay absent ("no data"),
 * whatever the score cell says; with a track, an empty or invalid score is
 * null (insufficient evidence). Shared with the Supabase hydration path.
 */
export function parseFrontier(
  rawScore: string | number | null | undefined,
  rawTrack: unknown
): Pick<ScoreEntry, 'frontierRisk' | 'frontierTrack'> {
  const frontierTrack = parseFrontierTrack(rawTrack);
  if (!frontierTrack) return {};
  return { frontierRisk: parseScore(rawScore), frontierTrack };
}

/** Parse the body of scores.csv. Shared by the app loader and the static page build. */
export function parseScoresCsv(body: string): ScoreData {
  const rows = csvParse(body, (d: DSVRowString): ScoreEntry => {
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
      ...parseFrontier(d['Frontier Risk'], d['Frontier Track']),
    };
  });
  // Drop rows with no country key - a blank/garbled line must not create
  // an empty-string entry that later renders as a ghost country.
  return Object.fromEntries(
    rows.filter(d => d.country).map(d => [d.country, d])
  );
}

export async function loadScores(): Promise<ScoreData> {
  return parseScoresCsv(await text('/scores.csv'));
}

/** Parse the body of regulation_data.csv. Shared by the app loader and the static page build. */
export function parseRegulationCsv(body: string): RegulationData {
  const rows = csvParse(body, (d: DSVRowString): RegulationEntry => ({
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
    // Empty until the country is researched with the frontier lens.
    frontierRisk: d['Frontier Risk'] || null,
    frontierSources: d['Frontier Sources'] || null,
  }));
  return Object.fromEntries(rows.map(d => [d.country, d]));
}

export async function loadRegulation(): Promise<RegulationData> {
  return parseRegulationCsv(await text('/regulation_data.csv'));
}
