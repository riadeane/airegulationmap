export const ATTRIBUTE_LABELS = {
  averageScore: 'Average Score',
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

export const LEGEND_ENDPOINTS: Record<AttributeKey, [string, string]> = {
  averageScore:     ['Minimal', 'Comprehensive'],
  regulationStatus: ['Minimal', 'Comprehensive'],
  policyLever:      ['Narrow', 'Broad'],
  governanceType:   ['Centralized', 'Distributed'],
  actorInvolvement: ['Limited', 'Broad'],
  enforcementLevel: ['Weak', 'Strong'],
};

export const SCORE_OPTIONS: { value: AttributeKey; text: string }[] = [
  { value: 'averageScore',     text: 'Average Score' },
  { value: 'regulationStatus', text: 'Regulation Status' },
  { value: 'policyLever',      text: 'Policy Lever' },
  { value: 'governanceType',   text: 'Governance Type' },
  { value: 'actorInvolvement', text: 'Actor Involvement' },
  { value: 'enforcementLevel', text: 'Enforcement Level' },
];

export const PLACEHOLDER_RE = /^(na|n\/a|idem|unknown|none|\s*[-–—]\s*|\.\s*)$/i;

// Display-time cleanup of LLM-generated regulation descriptions.
// Set to false for A/B eyeballing against the raw CSV text.
export const NORMALIZE_COPY = true;
