export const ATTRIBUTE_LABELS = {
  averageScore: 'Maturity Index',
  regulationStatus: 'Regulation Status',
  policyLever: 'Policy Lever',
  governanceType: 'Governance Type',
  actorInvolvement: 'Actor Involvement',
  enforcementLevel: 'Enforcement Level',
} as const;

/** One of the six score attributes ('averageScore' | 'regulationStatus' | …). */
export type AttributeKey = keyof typeof ATTRIBUTE_LABELS;

/** The five independently scored dimensions (averageScore is derived). */
export type DimensionKey = Exclude<AttributeKey, 'averageScore'>;

/**
 * What owns the main area. Exactly one of these is active at a time - the map,
 * the scatter explorer, or the full comparison view. Modeling it as one value
 * (rather than two independent `scatterOpen`/`comparisonViewOpen` booleans)
 * makes "both overlays open at once" unrepresentable and lets every transition
 * flow through a single writer (see state/interactions.ts).
 */
export type MainView = 'map' | 'scatter' | 'comparison';

/** Maximum countries in a side-by-side comparison. */
export const MAX_COMPARISON = 4;

export const LEGEND_ENDPOINTS: Record<AttributeKey, [string, string]> = {
  averageScore:     ['Minimal', 'Comprehensive'],
  regulationStatus: ['Minimal', 'Comprehensive'],
  policyLever:      ['Narrow', 'Broad'],
  governanceType:   ['Centralized', 'Distributed'],
  actorInvolvement: ['Limited', 'Broad'],
  enforcementLevel: ['Weak', 'Strong'],
};

export const SCORE_OPTIONS: { value: AttributeKey; text: string }[] = [
  { value: 'averageScore',     text: 'Maturity Index' },
  { value: 'regulationStatus', text: 'Regulation Status' },
  { value: 'policyLever',      text: 'Policy Lever' },
  { value: 'governanceType',   text: 'Governance Type' },
  { value: 'actorInvolvement', text: 'Actor Involvement' },
  { value: 'enforcementLevel', text: 'Enforcement Level' },
];

/**
 * Rubric v3.1 (issue #162): a score the research could not verify either
 * way. The pipeline writes it as an empty scores.csv cell / JSON null; it is
 * not a 1, which is a verified absence.
 */
export const INSUFFICIENT_EVIDENCE_LABEL = 'Insufficient evidence';

/**
 * True when a country HAS a score row but this value is null: "insufficient
 * evidence". Distinct from "no data", where there is no row at all - read
 * values as `entry?.[key]` so a missing row stays `undefined` and never
 * counts. The one shared test every view uses.
 */
export function isInsufficient(value: number | null | undefined): value is null {
  return value === null;
}

export const PLACEHOLDER_RE =/^(na|n\/a|idem|unknown|none|\s*[-–—]\s*|\.\s*)$/i;

// Display-time cleanup of LLM-generated regulation descriptions.
// Set to false for A/B eyeballing against the raw CSV text.
export const NORMALIZE_COPY = true;
