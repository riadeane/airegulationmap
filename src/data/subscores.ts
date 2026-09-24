// Per-country sub-indicator data (methodology v2 audit trail). Each
// dimension score is the mean of four named sub-indicators; this file
// lets the UI show *why* a dimension scored what it did.
//
// Two file shapes coexist: v2 entries store a bare integer per
// sub-indicator; v2.1 entries (since September 2026) store
// `{ score, rationale }`, where the rationale is the one sentence the
// model gave for the score. Both normalize to `SubscoreCell` on load so
// the rest of the app sees a single shape.

import type { DimensionKey } from '../constants';
import { normalizeEvidence } from './evidence';
import type { EvidenceRecord } from './evidence';

export type SnakeDimension =
  | 'regulation_status'
  | 'policy_lever'
  | 'governance_type'
  | 'actor_involvement'
  | 'enforcement_level';

/** One sub-indicator after normalization. `rationale` is null for v2 entries. */
export interface SubscoreCell {
  score: number;
  rationale: string | null;
}

export type SubscoreBlock = Record<string, SubscoreCell | null>;

export interface SubscoreEntry {
  date: string;
  regulation_status?: SubscoreBlock;
  policy_lever?: SubscoreBlock;
  governance_type?: SubscoreBlock;
  actor_involvement?: SubscoreBlock;
  enforcement_level?: SubscoreBlock;
  /** How the latest research pass was grounded (PRD 14). Absent when the
   *  country has no run record yet. */
  evidence?: EvidenceRecord;
}

export interface SubscoresData {
  schema_version: number;
  /** "v2.1" once the pipeline has written rationales; absent on older files. */
  methodology?: string;
  countries: Record<string, SubscoreEntry>;
}

/** A sub-indicator value as it appears in the file: v2 integer or v2.1 object. */
type RawCell = number | { score?: unknown; rationale?: unknown } | null | undefined;

interface RawEntry {
  date?: unknown;
  [dimension: string]: unknown;
}

function normalizeCell(raw: RawCell): SubscoreCell | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { score: raw, rationale: null } : null;
  if (!raw || typeof raw !== 'object') return null;
  const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null;
  if (score == null) return null;
  const rationale = typeof raw.rationale === 'string' && raw.rationale.trim() ? raw.rationale.trim() : null;
  return { score, rationale };
}

function normalizeEntry(raw: RawEntry): SubscoreEntry {
  const entry: SubscoreEntry = { date: typeof raw.date === 'string' ? raw.date : '' };
  for (const snake of Object.values(DIMENSION_TO_SNAKE)) {
    const block = raw[snake];
    if (!block || typeof block !== 'object') continue;
    const cells: SubscoreBlock = {};
    for (const [key, value] of Object.entries(block as Record<string, RawCell>)) {
      cells[key] = normalizeCell(value);
    }
    entry[snake] = cells;
  }
  const evidence = normalizeEvidence(raw.evidence);
  if (evidence) entry.evidence = evidence;
  return entry;
}

/**
 * Coerce a parsed subscores.json (v2 or v2.1) into the normalized shape.
 * Unknown or malformed cells become null, which the panel skips.
 */
export function normalizeSubscores(raw: unknown): SubscoresData | null {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as { schema_version?: unknown; methodology?: unknown; countries?: unknown };
  if (!file.countries || typeof file.countries !== 'object') return null;
  const countries: Record<string, SubscoreEntry> = {};
  for (const [name, entry] of Object.entries(file.countries as Record<string, RawEntry>)) {
    if (entry && typeof entry === 'object') countries[name] = normalizeEntry(entry);
  }
  return {
    schema_version: typeof file.schema_version === 'number' ? file.schema_version : 1,
    ...(typeof file.methodology === 'string' ? { methodology: file.methodology } : {}),
    countries,
  };
}

/** camelCase frontend dimension keys -> snake_case pipeline keys. */
export const DIMENSION_TO_SNAKE: Record<Exclude<DimensionKey, never>, SnakeDimension> = {
  regulationStatus: 'regulation_status',
  policyLever: 'policy_lever',
  governanceType: 'governance_type',
  actorInvolvement: 'actor_involvement',
  enforcementLevel: 'enforcement_level',
};

/** Display labels for the 20 sub-indicators, in rubric order. */
export const SUBSCORE_LABELS: Record<SnakeDimension, [string, string][]> = {
  regulation_status: [
    ['binding_force', 'Binding force'],
    ['scope', 'Scope'],
    ['implementation', 'Implementation'],
    ['ai_specificity', 'AI specificity'],
  ],
  policy_lever: [
    ['binding_instruments', 'Binding instruments'],
    ['soft_law', 'Soft law & standards'],
    ['economic_tools', 'Economic tools'],
    ['institutional_capacity', 'Institutional capacity'],
  ],
  governance_type: [
    ['regulator_plurality', 'Regulator plurality'],
    ['formal_coordination', 'Formal coordination'],
    ['subnational_role', 'Sub-national role'],
    ['nongovernmental_checks', 'Non-governmental checks'],
  ],
  actor_involvement: [
    ['industry', 'Industry'],
    ['civil_society', 'Civil society'],
    ['academia', 'Academia'],
    ['international', 'International'],
  ],
  enforcement_level: [
    ['sanctions_framework', 'Sanctions framework'],
    ['actions_taken', 'Actions taken'],
    ['dedicated_authority', 'Dedicated authority'],
    ['monitoring_practice', 'Monitoring practice'],
  ],
};

export async function loadSubscores(): Promise<SubscoresData | null> {
  try {
    const response = await fetch('/data/subscores.json');
    if (!response.ok) return null;
    return normalizeSubscores(await response.json());
  } catch {
    console.warn('subscores.json not available, sub-indicator breakdown disabled');
    return null;
  }
}
