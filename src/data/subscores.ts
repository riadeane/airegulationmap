// Per-country sub-indicator data (methodology v2 audit trail). Each
// dimension score is the mean of four named sub-indicators; this file
// lets the UI show *why* a dimension scored what it did.

import type { DimensionKey } from '../constants';

export type SnakeDimension =
  | 'regulation_status'
  | 'policy_lever'
  | 'governance_type'
  | 'actor_involvement'
  | 'enforcement_level';

export interface SubscoreEntry {
  date: string;
  regulation_status?: Record<string, number | null>;
  policy_lever?: Record<string, number | null>;
  governance_type?: Record<string, number | null>;
  actor_involvement?: Record<string, number | null>;
  enforcement_level?: Record<string, number | null>;
}

export interface SubscoresData {
  schema_version: number;
  countries: Record<string, SubscoreEntry>;
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
    return response.json() as Promise<SubscoresData>;
  } catch {
    console.warn('subscores.json not available, sub-indicator breakdown disabled');
    return null;
  }
}
