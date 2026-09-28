// ---------------------------------------------------------------------------
// Score vocabulary: the one source of truth for what every score means
// (PRD 16). The map, legend, tooltip, panel, bloc card, comparison, scatter,
// exports and the static page generator (scripts/build_pages.ts) all read
// these records, so a label or endpoint changes in exactly one place.
//
// Two lenses:
// - Implementation (the composite plus regulation status, policy lever and
//   enforcement level): how much AI governance is in force and operating.
//   Higher means more in force, not better. "Normative" in code and in the
//   methodology's technical section.
// - Governance style (governance type, actor involvement): how a country
//   governs. Neither end is better. "Descriptive" in code.
//
// Endpoints follow the v3 anchors in scripts/regulation_pipeline/prompt.py.
// Data field names (averageScore / avg_score, CSV headers) never change;
// only what readers see does.

/** The six score attributes, in display order: implementation, then style. */
export const ATTRIBUTE_KEYS = [
  'averageScore',
  'regulationStatus',
  'policyLever',
  'enforcementLevel',
  'governanceType',
  'actorInvolvement',
] as const;

/** One of the six score attributes ('averageScore' | 'regulationStatus' | …). */
export type AttributeKey = typeof ATTRIBUTE_KEYS[number];

/** The five independently scored dimensions (averageScore is derived). */
export type DimensionKey = Exclude<AttributeKey, 'averageScore'>;

/** The two lenses a score is read through. */
export type AttributeGroup = 'implementation' | 'style';

export interface AttributeMeaning {
  /** Display label ("Implementation Index"). */
  label: string;
  group: AttributeGroup;
  /** The one-line question the score answers. */
  question: string;
  /** What a 1 means, short enough for the legend at 360 px. */
  low: string;
  /** What a 5 means. */
  high: string;
  /** The one line on what the score does not say. */
  notClaim: string;
  /** Bloc card: the member at the top of the scale ("Most in force"). */
  highMember: string;
  /** Bloc card: the member at the bottom of the scale ("Least in force"). */
  lowMember: string;
}

const IMPLEMENTATION_NOT_CLAIM = 'Higher means more in force, not better regulation.';
const STYLE_NOT_CLAIM = 'Neither end is better: this describes how, not how well.';

export const ATTRIBUTES: Record<AttributeKey, AttributeMeaning> = {
  averageScore: {
    label: 'Implementation Index',
    group: 'implementation',
    question: 'How much AI governance is in force and operating?',
    low: 'Little in force',
    high: 'Extensively in force',
    notClaim: IMPLEMENTATION_NOT_CLAIM,
    highMember: 'Most in force',
    lowMember: 'Least in force',
  },
  regulationStatus: {
    label: 'Regulation Status',
    group: 'implementation',
    question: 'How much binding, AI-specific regulation is in force?',
    low: 'No binding AI rules',
    high: 'Binding cross-sector rules in force',
    notClaim: 'Not a judgement of whether the rules are good.',
    highMember: 'Most in force',
    lowMember: 'Least in force',
  },
  policyLever: {
    label: 'Policy Lever',
    group: 'implementation',
    question: 'How many policy instruments are in use: law, guidance, funding, institutions?',
    low: 'Few instruments',
    high: 'Many instruments in use',
    notClaim: 'Counts instruments in use, not whether they work.',
    highMember: 'Most in use',
    lowMember: 'Fewest in use',
  },
  enforcementLevel: {
    label: 'Enforcement Level',
    group: 'implementation',
    question: 'How much enforcement of AI rules is observed?',
    low: 'None observed',
    high: 'Routine, published enforcement',
    notClaim: 'Measures enforcement activity, not whether it is fair or effective.',
    highMember: 'Most enforcement',
    lowMember: 'Least enforcement',
  },
  governanceType: {
    label: 'Governance Type',
    group: 'style',
    question: 'Is authority over AI held by one body or spread across many?',
    low: 'Centralised',
    high: 'Distributed',
    notClaim: STYLE_NOT_CLAIM,
    highMember: 'Most distributed',
    lowMember: 'Most centralised',
  },
  actorInvolvement: {
    label: 'Actor Involvement',
    group: 'style',
    question: 'How widely do industry, civil society, academia and partners take part?',
    low: 'Narrow',
    high: 'Broad',
    notClaim: STYLE_NOT_CLAIM,
    highMember: 'Broadest',
    lowMember: 'Narrowest',
  },
};

export interface GroupMeaning {
  /** Heading ("Implementation", "Governance style"). */
  label: string;
  /** What the lens reads, for panel captions: "how much is in force, not how good it is". */
  caption: string;
  /** The short phrase the tooltip appends: "how much is in force". */
  phrase: string;
  /** "implementation dimensions" / "governance style dimensions". */
  plural: string;
}

export const GROUPS: Record<AttributeGroup, GroupMeaning> = {
  implementation: {
    label: 'Implementation',
    caption: 'how much is in force, not how good it is',
    phrase: 'how much is in force',
    plural: 'implementation dimensions',
  },
  style: {
    label: 'Governance style',
    caption: 'how, not how well',
    phrase: 'how, not how well',
    plural: 'governance style dimensions',
  },
};

/** Attributes of one lens, in display order. */
export function attributesIn(group: AttributeGroup): AttributeKey[] {
  return ATTRIBUTE_KEYS.filter(key => ATTRIBUTES[key].group === group);
}

/** Display labels, derived from the vocabulary. */
export const ATTRIBUTE_LABELS = Object.fromEntries(
  ATTRIBUTE_KEYS.map(key => [key, ATTRIBUTES[key].label])
) as Record<AttributeKey, string>;

/** [what a 1 means, what a 5 means] per attribute. */
export const LEGEND_ENDPOINTS = Object.fromEntries(
  ATTRIBUTE_KEYS.map(key => [key, [ATTRIBUTES[key].low, ATTRIBUTES[key].high]])
) as Record<AttributeKey, [string, string]>;

export const SCORE_OPTIONS: { value: AttributeKey; text: string }[] =
  ATTRIBUTE_KEYS.map(value => ({ value, text: ATTRIBUTES[value].label }));

/**
 * What a sub-indicator level means on the implementation dimensions: the
 * v3 anchors in scripts/regulation_pipeline/prompt.py, in plain words.
 * Governance style sub-indicators are descriptive and carry their own
 * anchor phrases instead (SUBSCORE_ANCHORS in data/subscores.ts).
 */
export const IMPLEMENTATION_LEVELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'No observable activity',
  2: 'Non-binding or preparatory only',
  3: 'Exists in part',
  4: 'In place, one element incomplete or not yet exercised',
  5: 'In place and operating',
};

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

export const PLACEHOLDER_RE = /^(na|n\/a|idem|unknown|none|\s*[-–—]\s*|\.\s*)$/i;

// Display-time cleanup of LLM-generated regulation descriptions.
// Set to false for A/B eyeballing against the raw CSV text.
export const NORMALIZE_COPY = true;
