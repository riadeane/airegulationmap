// Per-country sub-indicator data (methodology v2 audit trail). Each
// dimension score is the mean of four named sub-indicators; this file
// lets the UI show *why* a dimension scored what it did.
//
// Two file shapes coexist: v2 entries store a bare integer per
// sub-indicator; v2.1 entries (since September 2026) store
// `{ score, rationale }`, where the rationale is the one sentence the
// model gave for the score. Both normalize to `SubscoreCell` on load so
// the rest of the app sees a single shape. Since rubric v3.1 a v2.1
// `score` may be `null`: insufficient evidence, with the rationale saying
// what was searched (see isInsufficient in constants.ts).
//
// An entry may also carry a `frontier` block (Frontier Risk Governance,
// PRD 15) beside the five dimension blocks: the track, the rubric
// generation, and four sub-indicators whose score may also be "na" (does
// not apply on the track). It is normalized on its own; the walk over the
// dimension blocks never reads it, as it never reads `evidence`.

import { FRONTIER_SUBINDICATOR_KEYS, parseFrontierTrack } from '../constants';
import type { DimensionKey, FrontierSubindicator, FrontierTrack, NotApplicable } from '../constants';
import { normalizeEvidence } from './evidence';
import type { EvidenceRecord } from './evidence';

export type SnakeDimension =
  | 'regulation_status'
  | 'policy_lever'
  | 'governance_type'
  | 'actor_involvement'
  | 'enforcement_level';

/** One sub-indicator after normalization. `rationale` is null for v2
 * entries; `score` is null for "insufficient evidence" (rubric v3.1). */
export interface SubscoreCell {
  score: number | null;
  rationale: string | null;
}

export type SubscoreBlock = Record<string, SubscoreCell | null>;

/**
 * One frontier sub-indicator. `score` is an integer 1-5, null (insufficient
 * evidence) or "na" (does not apply on the country's track). `eu_level`
 * marks developer_obligations resting on the EU AI Act; `computed` marks
 * international_coordination, which is computed from public lists. Field
 * names follow subscores.json, so the JSON export writes the block back as
 * the file has it.
 */
export interface FrontierCell {
  score: number | null | NotApplicable;
  rationale: string | null;
  eu_level?: true;
  computed?: true;
}

/** The subscores.json `frontier` block (PRD 15), normalized. */
export type FrontierBlock = {
  /** The run that produced these frontier scores. */
  date: string;
  track: FrontierTrack | null;
  /** The frontier rubric generation ("f1"). */
  rubric: string | null;
} & Partial<Record<FrontierSubindicator, FrontierCell>>;

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
  /** Frontier Risk Governance sub-indicators (PRD 15). Absent when the
   *  country has never been scored on the lens. */
  frontier?: FrontierBlock;
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

function cleanRationale(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function normalizeCell(raw: RawCell): SubscoreCell | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { score: raw, rationale: null } : null;
  if (!raw || typeof raw !== 'object') return null;
  const rationale = cleanRationale(raw.rationale);
  // An explicit null is insufficient evidence; a missing or garbled score
  // is a malformed cell and is skipped.
  if (raw.score === null) return { score: null, rationale };
  const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null;
  if (score == null) return null;
  return { score, rationale };
}

/** One frontier cell, or undefined for a malformed one (skipped). */
function normalizeFrontierCell(raw: unknown): FrontierCell | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const cell = raw as { score?: unknown; rationale?: unknown; eu_level?: unknown; computed?: unknown };
  let score: FrontierCell['score'];
  if (cell.score === null) score = null;
  else if (typeof cell.score === 'string' && cell.score.trim().toLowerCase() === 'na') score = 'na';
  else if (typeof cell.score === 'number' && Number.isFinite(cell.score) && cell.score >= 1 && cell.score <= 5) {
    score = cell.score;
  } else return undefined;
  return {
    score,
    rationale: cleanRationale(cell.rationale),
    ...(cell.eu_level === true ? { eu_level: true as const } : {}),
    ...(cell.computed === true ? { computed: true as const } : {}),
  };
}

/**
 * Coerce a subscores.json `frontier` block. Null when it is not an object
 * or holds no usable sub-indicator; a malformed cell is left out.
 */
export function normalizeFrontierBlock(raw: unknown): FrontierBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as Record<string, unknown>;
  const block: FrontierBlock = {
    date: typeof file.date === 'string' ? file.date : '',
    track: parseFrontierTrack(file.track),
    rubric: typeof file.rubric === 'string' && file.rubric.trim() ? file.rubric.trim() : null,
  };
  let cells = 0;
  for (const key of FRONTIER_SUBINDICATOR_KEYS) {
    const cell = normalizeFrontierCell(file[key]);
    if (!cell) continue;
    block[key] = cell;
    cells++;
  }
  return cells > 0 ? block : null;
}

function normalizeEntry(raw: RawEntry): SubscoreEntry {
  const entry: SubscoreEntry = { date: typeof raw.date === 'string' ? raw.date : '' };
  // The five dimension blocks only: `evidence` and `frontier` are read
  // below, each by its own rules.
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
  const frontier = normalizeFrontierBlock(raw.frontier);
  if (frontier) entry.frontier = frontier;
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

/**
 * The governance style sub-indicators are descriptive: each level is a
 * position, not an achievement. Their 1 / 3 / 5 anchors, from the v3 rubric
 * in scripts/regulation_pipeline/prompt.py, in plain words.
 */
export const STYLE_ANCHORS: Record<string, [string, string, string]> = {
  regulator_plurality: [
    'A single authority sets and enforces policy',
    'A lead body plus sectoral regulators',
    'Many independent regulators with their own remits',
  ],
  formal_coordination: [
    'A single actor, nothing to coordinate',
    'Ad hoc coordination',
    'Formal coordination across many bodies',
  ],
  subnational_role: [
    'No sub-national role',
    'Sub-national bodies implement national rules',
    'States or provinces regulate AI independently',
  ],
  nongovernmental_checks: [
    'No court, ombudsman or independent review role',
    'Occasional judicial or independent review',
    'Courts and independent bodies actively shape AI rules',
  ],
  industry: [
    'No structured industry input',
    'Published consultations and working groups',
    'Standing formal roles in policy-making',
  ],
  civil_society: [
    'Civil society excluded from the domestic process',
    'Consulted occasionally',
    'Standing formal roles for NGOs and unions',
  ],
  academia: [
    'No academic involvement',
    'Some advisory input',
    'Formal standing advisory roles',
  ],
  international: [
    'No part in international AI governance',
    'Signatory to declarations',
    'Active in treaties and standards bodies',
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
