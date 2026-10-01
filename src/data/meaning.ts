// What a score means, as the strings each surface shows (PRD 16). Pure
// functions over the vocabulary in constants.ts, so the tooltip, legend,
// live region, bloc card and panel read the same words, and the copy audit
// (tests/copyAudit.test.js) can check every one of them without a DOM.

import {
  ATTRIBUTES, EU_LEVEL_LABEL, FRONTIER_AGGREGATION_NOTE, FRONTIER_SUBINDICATORS, FRONTIER_TRACKS, GROUPS,
  IMPLEMENTATION_LEVELS, INSUFFICIENT_EVIDENCE_LABEL, NOT_APPLICABLE_LABEL, isInsufficient, isNotApplicable,
  parseFrontierTrack,
} from '../constants';
import type { AttributeGroup, AttributeKey, FrontierSubindicator, NotApplicable } from '../constants';
import { STYLE_ANCHORS } from './subscores';

export function groupOf(attr: AttributeKey): AttributeGroup {
  return ATTRIBUTES[attr].group;
}

export function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * The tooltip's score line: "Implementation Index: 4.25 / 5, how much is in
 * force". A past timeline date rides in brackets after the score.
 */
export function scoreLine(attr: AttributeKey, score: number, vintage: string | null = null): string {
  const { label, group } = ATTRIBUTES[attr];
  const when = vintage ? ` (${vintage})` : '';
  return `${label}: ${score} / 5${when}, ${GROUPS[group].phrase}`;
}

/** The legend's line under the ramp: the question, then what it does not claim. */
export function legendCaption(attr: AttributeKey): { question: string; notClaim: string } {
  const { question, notClaim } = ATTRIBUTES[attr];
  return { question, notClaim };
}

/** The live region's sentence when the map changes lens. */
export function modeAnnouncement(attr: AttributeKey): string {
  const { label, group, question, low, high, notClaim } = ATTRIBUTES[attr];
  const note = group === 'frontier' ? ` ${FRONTIER_AGGREGATION_NOTE}` : '';
  return `Map now showing ${label}. ${question} Legend runs from ${low} (1) to ${high} (5). ${notClaim}${note}`;
}

/**
 * The frontier track in words for the tooltip, the live region and the
 * comparison: "Frontier host track", with ", EU-level developer
 * obligations" when developer_obligations rests on the EU AI Act. Null for
 * no track (no frontier data).
 */
export function frontierTrackLine(track: unknown, euLevel = false): string | null {
  const t = parseFrontierTrack(track);
  if (!t) return null;
  return `${FRONTIER_TRACKS[t].label} track${euLevel ? `, ${EU_LEVEL_LABEL} developer obligations` : ''}`;
}

/** A frontier sub-indicator's value for display: the number, "Not
 *  applicable" or "Insufficient evidence" - never a 1 for either. */
export function frontierCellValue(score: number | null | NotApplicable): string {
  if (isNotApplicable(score)) return NOT_APPLICABLE_LABEL;
  if (isInsufficient(score)) return INSUFFICIENT_EVIDENCE_LABEL;
  return formatScore(score);
}

/** The bloc card's labels for the members at each end of the scale. */
export function blocExtremes(attr: AttributeKey): { high: string; low: string } {
  const { highMember, lowMember } = ATTRIBUTES[attr];
  return { high: highMember, low: lowMember };
}

/** The panel caption for a lens: "Implementation: how much is in force, not how good it is". */
export function groupCaption(group: AttributeGroup): string {
  const { label, caption } = GROUPS[group];
  return `${label}: ${caption}`;
}

/**
 * What one sub-indicator level means. Implementation sub-indicators read
 * the shared ladder ("4: In place, one element incomplete, deferred or not
 * yet exercised"). Governance style sub-indicators are descriptive and show
 * their own anchors; an even score sits between two anchors. Frontier
 * sub-indicators have their own anchor per level (FRONTIER_SUBINDICATORS).
 */
export function levelMeaning(group: AttributeGroup, subindicator: string, score: number): string | null {
  const level = Math.round(score);
  if (level < 1 || level > 5) return null;
  if (group === 'implementation') return IMPLEMENTATION_LEVELS[level as 1 | 2 | 3 | 4 | 5];
  if (group === 'frontier') {
    const meaning = FRONTIER_SUBINDICATORS[subindicator as FrontierSubindicator];
    return meaning ? meaning.levels[level as 1 | 2 | 3 | 4 | 5] : null;
  }
  const anchors = STYLE_ANCHORS[subindicator];
  if (!anchors) return null;
  if (level % 2 === 1) return anchors[(level - 1) / 2];
  const lower = anchors[level / 2 - 1];
  const upper = anchors[level / 2];
  const quote = (text: string) => `"${text[0].toLowerCase()}${text.slice(1)}"`;
  return `Between ${quote(lower)} and ${quote(upper)}`;
}

/**
 * #96 (display only): governance type 1 means "a single national
 * authority", but a country with no AI governance at all also lands on 1.
 * Until the scale gets a value for "no structure yet", the panel shows the
 * absence instead of a governance type score when every implementation
 * dimension sits at 1.
 */
export const NO_ACTIVITY_TEXT = 'No AI governance activity observed';

export function noGovernanceActivity(
  scores: { regulationStatus: number | null; policyLever: number | null; enforcementLevel: number | null } | null | undefined,
): boolean {
  if (!scores) return false;
  return scores.regulationStatus === 1 && scores.policyLever === 1 && scores.enforcementLevel === 1;
}

/** API column (snake_case) -> attribute, for the API docs' display fixes. */
const API_COLUMNS: Record<string, AttributeKey> = {
  avg_score: 'averageScore',
  regulation_status: 'regulationStatus',
  policy_lever: 'policyLever',
  enforcement_level: 'enforcementLevel',
  governance_type: 'governanceType',
  actor_involvement: 'actorInvolvement',
  frontier_risk: 'frontierRisk',
};

/** The other Frontier Risk Governance columns (migration 0014, PRD 15). */
const FRONTIER_API_COLUMNS: Record<string, string> = {
  frontier_track: 'The track the frontier_risk score was made on: H (frontier host), C (compute or '
    + 'chokepoint) or G (global). The track decides which frontier sub-indicators apply. Null when '
    + 'the country has not been scored on the lens.',
  frontier_subscores: 'The Frontier Risk Governance sub-indicators (the subscores.json "frontier" '
    + 'block): date, track, rubric and developer_obligations, evaluation_oversight, '
    + 'incident_emergency_preparedness and international_coordination, each {score, rationale} with '
    + 'a score of 1 to 5, null (insufficient evidence) or "na" (does not apply on the track). '
    + 'eu_level marks developer obligations resting on the EU AI Act; computed marks '
    + 'international_coordination, which is computed from public lists.',
  frontier_risk_text: 'One to three sentences on how the country governs frontier AI risk.',
  frontier_sources_raw: 'Pipe-separated source URLs for frontier_risk_text.',
};

/**
 * The API docs' description of a score column in the shared vocabulary,
 * or null for any other column. api-docs.html applies it at load time over
 * the committed PostgREST snapshot, so a refresh of public/openapi.json
 * never brings the old wording back. Column names are a data contract and
 * do not change; `avg_score` is the implementation index.
 */
export function apiColumnDescription(column: string): string | null {
  if (FRONTIER_API_COLUMNS[column]) return FRONTIER_API_COLUMNS[column];
  const key = API_COLUMNS[column];
  if (!key) return null;
  const { label, group, question, low, high, notClaim } = ATTRIBUTES[key];
  const lens = GROUPS[group].label.toLowerCase();
  let extra = '';
  if (key === 'averageScore') {
    extra = ' The mean of regulation_status, policy_lever and enforcement_level.';
  } else if (group === 'style') {
    extra = ' Not part of avg_score.';
  } else if (group === 'frontier') {
    extra = ' Scored by track (frontier_track) and capped at one point above the weakest applicable sub-indicator. '
      + 'Null with a track is insufficient evidence; null without one means the country has not been '
      + 'scored on the lens. Not part of avg_score.';
  }
  return `${label} (${lens}), 1 to 5. ${question} 1 = ${low}, 5 = ${high}. ${notClaim}${extra}`;
}

/** Summary wording the API docs replace at load time. */
export function apiSummaryText(text: string): string {
  return text.replace(/\bmaturity composite\b/g, 'implementation index');
}
