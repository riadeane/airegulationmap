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
// - Frontier risk governance (PRD 15, the frontierRisk attribute): how
//   close a country's governance of catastrophic frontier-AI risk comes to
//   a standard stated in the methodology, scored by track and capped at the
//   weakest applicable element. Normative, but never part of the
//   implementation index (averageScore).
//
// Endpoints follow the v3 anchors in scripts/regulation_pipeline/prompt.py.
// Data field names (averageScore / avg_score, CSV headers) never change;
// only what readers see does.

/** The seven score attributes, in display order: implementation, then
 *  style, then frontier risk governance. */
export const ATTRIBUTE_KEYS = [
  'averageScore',
  'regulationStatus',
  'policyLever',
  'enforcementLevel',
  'governanceType',
  'actorInvolvement',
  'frontierRisk',
] as const;

/** One of the seven score attributes ('averageScore' | 'regulationStatus' | …). */
export type AttributeKey = typeof ATTRIBUTE_KEYS[number];

/** The five independently scored dimensions of the research rubric
 *  (averageScore is derived; frontierRisk is its own lens, PRD 15). */
export type DimensionKey = Exclude<AttributeKey, 'averageScore' | 'frontierRisk'>;

/** The three lenses a score is read through. */
export type AttributeGroup = 'implementation' | 'style' | 'frontier';

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
  frontierRisk: {
    label: 'Frontier Risk Governance',
    group: 'frontier',
    question: 'How close is governance of catastrophic frontier-AI risk to the standard stated in the methodology?',
    low: 'Nothing observable',
    high: 'Meets the stated standard',
    notClaim: 'Measured against a stated standard; not a measure of how safe a country is.',
    highMember: 'Closest to the standard',
    lowMember: 'Furthest from the standard',
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
  frontier: {
    label: 'Frontier risk governance',
    caption: 'distance to a stated standard, not how safe a country is',
    phrase: 'against a stated standard',
    plural: 'frontier risk governance',
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
 * shared ladder in scripts/regulation_pipeline/prompt.py (rubric v3.2), in
 * plain words.
 * Governance style sub-indicators are descriptive and carry their own
 * anchor phrases instead (STYLE_ANCHORS in data/subscores.ts).
 */
export const IMPLEMENTATION_LEVELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'No observable activity',
  2: 'Non-binding or preparatory only',
  3: 'Exists in part',
  4: 'In place, one element incomplete, deferred or not yet exercised',
  5: 'Fully in place, applicable and exercised',
};

// ---------------------------------------------------------------------------
// Frontier Risk Governance (PRD 15): tracks, sub-indicators and their anchors
// in plain words. The anchors paraphrase FRONTIER_ANCHORS in
// scripts/regulation_pipeline/prompt.py (national level only; a voluntary
// access agreement can support a 4 on evaluation_oversight). A
// frontier-specific text is the Bletchley Declaration, a Seoul text or the
// 2026 Call for Control of Frontier AI Models.

/** Where the methodology states the standard, the tracks and the cap. */
export const FRONTIER_METHODOLOGY_PATH = '/methodology.html#frontier-risk-governance';

/** The track a country is scored on: frontier host, compute or chokepoint, global. */
export type FrontierTrack = 'H' | 'C' | 'G';

export const FRONTIER_TRACKS: Record<FrontierTrack, { label: string; description: string }> = {
  H: {
    label: 'Frontier host',
    description: 'A developer of a frontier-scale model is based here, so all four sub-indicators apply.',
  },
  C: {
    label: 'Compute or chokepoint',
    description: 'Frontier-scale compute or a node of the advanced-chip supply chain is here, but no frontier developer; developer obligations do not apply.',
  },
  G: {
    label: 'Global',
    description: 'No frontier developer or frontier-scale compute is based here; incident preparedness and international coordination apply.',
  },
};

/** A track code from a file or the database ('H', ' c ', …), or null. */
export function parseFrontierTrack(raw: unknown): FrontierTrack | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  return t === 'H' || t === 'C' || t === 'G' ? t : null;
}

/** The four sub-indicators, in rubric order. */
export const FRONTIER_SUBINDICATOR_KEYS = [
  'developer_obligations',
  'evaluation_oversight',
  'incident_emergency_preparedness',
  'international_coordination',
] as const;

export type FrontierSubindicator = typeof FRONTIER_SUBINDICATOR_KEYS[number];

export interface FrontierSubindicatorMeaning {
  label: string;
  /** The tracks it applies to; on the others it is "Not applicable". */
  tracks: readonly FrontierTrack[];
  /** What each level means. */
  levels: Record<1 | 2 | 3 | 4 | 5, string>;
}

export const FRONTIER_SUBINDICATORS: Record<FrontierSubindicator, FrontierSubindicatorMeaning> = {
  developer_obligations: {
    label: 'Developer obligations',
    tracks: ['H'],
    levels: {
      1: 'No binding rule, voluntary framework or company commitment touches frontier developers',
      2: 'Voluntary frameworks, a promotion law without duties, or company commitments only',
      3: 'A binding legal hook or mandatory standards touching frontier-model risk, without the full set of duties',
      4: 'A statute with the full set of duties, enacted but not yet applicable, its enforcement deferred or its model-access powers not yet used',
      5: 'That statute in force, with an adjustable or capability-based threshold and a regulator that has used its model-access powers',
    },
  },
  evaluation_oversight: {
    label: 'Evaluation and oversight',
    tracks: ['H', 'C'],
    levels: {
      1: 'No state body evaluates frontier AI models',
      2: 'An evaluation body announced or recommended, or one without dedicated staff or budget',
      3: 'A body with an evaluation mandate that has tested some frontier models, with limited access or public record',
      4: 'A funded, staffed body with standing pre-deployment access (voluntary agreements count) to most of the developers it oversees and a public record, or a legal access mandate not yet used',
      5: 'Legally mandated access for state or accredited evaluators before deployment, with evaluations run and reported',
    },
  },
  incident_emergency_preparedness: {
    label: 'Incident and emergency preparedness',
    tracks: ['H', 'C', 'G'],
    levels: {
      1: 'No AI incident reporting, whistleblower protection or emergency planning exists or is planned',
      2: 'Planned or recommended only',
      3: 'One of incident reporting, whistleblower protection and an emergency plan in force, or several enacted but not yet applicable',
      4: 'Two of the three in force',
      5: 'All three in force, with incident reports due within 72 hours and legal power to halt a deployment',
    },
  },
  international_coordination: {
    label: 'International coordination',
    tracks: ['H', 'C', 'G'],
    levels: {
      1: 'No AI summit text, network membership or frontier-safety dialogue',
      2: 'Only broad AI declarations (Paris 2025, New Delhi 2026)',
      3: 'A signatory of a frontier-specific text, a measurement-network member without one, or a standing bilateral frontier-safety dialogue',
      4: 'A measurement-network member that signed a frontier-specific text',
      5: 'A network member that signed the Bletchley and Seoul texts and leads joint evaluation or verification work',
    },
  },
};

/** A frontier sub-indicator that does not apply to the country's track. */
export const NOT_APPLICABLE_LABEL = 'Not applicable';

/** The sub-indicator score the pipeline writes for "does not apply". */
export type NotApplicable = 'na';

export function isNotApplicable(value: unknown): value is NotApplicable {
  return value === 'na';
}

/** How the lens aggregates, in one line (legend, live region). */
export const FRONTIER_AGGREGATION_NOTE = 'Scored by track; capped at the weakest element.';

/** The same rule in full (panel, pages, exports). */
export const FRONTIER_CAP_SENTENCE =
  'The score is the mean of the sub-indicators that apply to the track, capped at one point above the weakest of them.';

/** developer_obligations rests on EU law (the AI Act's general-purpose AI
 *  regime), not a national one: the `eu_level` flag. */
export const EU_LEVEL_LABEL = 'EU-level';
export const EU_LEVEL_NOTE = 'Rests on the EU AI Act, not a national law.';

/** international_coordination is computed, never researched by the model. */
export const COMPUTED_NOTE = 'Computed from public lists of summit signatories and network members.';

/**
 * True when at least one country has been scored on the frontier lens
 * (has a track). The selector, the scatter axes and the explainer offer
 * the lens only then: the data ships after the first run on it.
 */
export function hasFrontierTrack(
  rows: Readonly<Record<string, { readonly frontierTrack?: string | null } | undefined>>
): boolean {
  return Object.values(rows).some(row => row?.frontierTrack != null);
}

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

export const PLACEHOLDER_RE = /^(na|n\/a|idem|unknown|none|\s*[-–—]\s*|\.\s*)$/i;

// Display-time cleanup of LLM-generated regulation descriptions.
// Set to false for A/B eyeballing against the raw CSV text.
export const NORMALIZE_COPY = true;
