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

export async function loadScores(): Promise<ScoreData> {
  const rows = await csv<ScoreEntry>('/scores.csv', d => ({
    country: d.Country ?? '',
    regulationStatus: +(d['Regulation Status'] ?? '') || null,
    policyLever: +(d['Policy Lever'] ?? '') || null,
    governanceType: +(d['Governance Type'] ?? '') || null,
    actorInvolvement: +(d['Actor Involvement'] ?? '') || null,
    averageScore: +(d['Average Score'] ?? '') || null,
    enforcementLevel: d['Enforcement Level'] ? +d['Enforcement Level'] : null,
    lastUpdated: d['Last Updated'] || null,
    dataVersion: +(d['Data Version'] ?? '') || 1,
  }));
  return Object.fromEntries(rows.map(d => [d.country, d]));
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
