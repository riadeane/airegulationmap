// What a score means, as the strings each surface shows (PRD 16). Pure
// functions over the vocabulary in constants.ts, so the tooltip, legend,
// live region, bloc card and panel read the same words, and the copy audit
// (tests/copyAudit.test.js) can check every one of them without a DOM.

import { ATTRIBUTES, GROUPS, IMPLEMENTATION_LEVELS } from '../constants';
import type { AttributeGroup, AttributeKey } from '../constants';
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
  const { label, question, low, high, notClaim } = ATTRIBUTES[attr];
  return `Map now showing ${label}. ${question} Legend runs from ${low} (1) to ${high} (5). ${notClaim}`;
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
 * their own anchors; an even score sits between two anchors.
 */
export function levelMeaning(group: AttributeGroup, subindicator: string, score: number): string | null {
  const level = Math.round(score);
  if (level < 1 || level > 5) return null;
  if (group === 'implementation') return IMPLEMENTATION_LEVELS[level as 1 | 2 | 3 | 4 | 5];
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
};

/**
 * The API docs' description of a score column in the shared vocabulary,
 * or null for any other column. api-docs.html applies it at load time over
 * the committed PostgREST snapshot, so a refresh of public/openapi.json
 * never brings the old wording back. Column names are a data contract and
 * do not change; `avg_score` is the implementation index.
 */
export function apiColumnDescription(column: string): string | null {
  const key = API_COLUMNS[column];
  if (!key) return null;
  const { label, group, question, low, high, notClaim } = ATTRIBUTES[key];
  const lens = GROUPS[group].label.toLowerCase();
  let extra = '';
  if (key === 'averageScore') {
    extra = ' The mean of regulation_status, policy_lever and enforcement_level.';
  } else if (group === 'style') {
    extra = ' Not part of avg_score.';
  }
  return `${label} (${lens}), 1 to 5. ${question} 1 = ${low}, 5 = ${high}. ${notClaim}${extra}`;
}

/** Summary wording the API docs replace at load time. */
export function apiSummaryText(text: string): string {
  return text.replace(/\bmaturity composite\b/g, 'implementation index');
}
