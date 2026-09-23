// "Report an issue": a pre-filled GitHub issue for the selected country.
//
// A reader who knows a country's law better than the model is the
// cheapest data-quality signal the project has, so this removes every
// step between "that score is wrong" and a filed issue. One click opens
// the data-error issue form on GitHub with the entry as the panel shows
// it already filled in: the six scores, confidence, last updated, data
// version, the citation string a reader would quote, the app URL, the
// source list and, once the audit trail carries rationales (methodology
// v2.1), the sub-indicator rows in a collapsed block. The reader adds
// what is wrong and, ideally, a primary source.
//
// Privacy: the URL carries nothing but data already on screen. No
// analytics, no identifiers. GitHub handles sign-in itself, and a report
// never triggers re-research on its own - a maintainer decides.
//
// GitHub prefills an issue FORM (.github/ISSUE_TEMPLATE/data-error.yml)
// from query parameters named after the form's field ids; the free-text
// `body` parameter belongs to Markdown templates and a form ignores it.
// So the generated Markdown travels in the form's `entry` field and the
// country in its `country` field, beside GitHub's own `template`,
// `title` and `labels`. The builders are pure so Vitest covers them.

import { getState } from '../state/store';
import { maybeEl } from '../dom';
import { ATTRIBUTE_LABELS, SCORE_OPTIONS } from '../constants';
import type { DimensionKey } from '../constants';
import { citationsFor } from './citation';
import { buildPermalink } from './url';
import { classifySources } from '../data/sources';
import { DIMENSION_TO_SNAKE, SUBSCORE_LABELS } from '../data/subscores';
import type { SubscoreEntry } from '../data/subscores';
import type { ScoreEntry, RegulationEntry } from '../data/loader';
import type { ReleaseInfo } from '../data/release';

export const ISSUE_NEW_URL = 'https://github.com/riadeane/airegulationmap/issues/new';
export const ISSUE_TEMPLATE = 'data-error.yml';
export const ISSUE_LABEL = 'data';

/**
 * The entry block sheds detail until it fits under this many characters.
 * GitHub answers a request line of more than about 8 KB with "414 URI
 * Too Long", and the entry is the URL's bulk, so its percent-encoded
 * form is capped too: Markdown punctuation and non-ASCII text encode to
 * three characters each, so a body under the first cap can still exceed
 * the second.
 */
export const MAX_BODY_LENGTH = 6000;
export const MAX_ENCODED_ENTRY_LENGTH = 7000;

/** Sources still listed before the sub-indicator block gives way. */
const MIN_SOURCES_LISTED = 3;

export interface ReportEntry {
  country: string;
  score: ScoreEntry | null;
  regulation: RegulationEntry | null;
  /** The country's normalized subscores.json entry, when loaded. */
  subscores: SubscoreEntry | null;
  /** The app URL of the current view (the permalink, theme dropped). */
  url: string;
  timelineDate?: string | null;
  /** The archived dataset version (release.json), when loaded. */
  release?: ReleaseInfo | null;
  /** Injected for tests; callers leave it to today. */
  accessed?: string;
}

export function reportTitle(country: string): string {
  return `Data: ${country}`;
}

// The panel's number format: integers bare, quarter points to two places.
function formatScore(value: number | null | undefined): string {
  if (value == null) return 'N/A';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatConfidence(raw: string | null | undefined): string {
  const level = (raw ?? '').trim().toLowerCase();
  if (level === 'high' || level === 'medium' || level === 'low') {
    return level[0].toUpperCase() + level.slice(1);
  }
  return 'Not stated';
}

// One line, pipes escaped, so free text cannot break a Markdown table.
function tableCell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

// The entry's length once URLSearchParams has encoded it.
function encodedLength(body: string): number {
  return new URLSearchParams({ entry: body }).toString().length - 'entry='.length;
}

function fits(body: string): boolean {
  return body.length <= MAX_BODY_LENGTH && encodedLength(body) <= MAX_ENCODED_ENTRY_LENGTH;
}

function headerBlock(entry: ReportEntry): string[] {
  const { country, score, regulation, url, timelineDate, release, accessed } = entry;
  const lastUpdated = score?.lastUpdated || regulation?.lastUpdated || 'unknown';
  // The same string the Cite popover offers, so the issue and a footnote
  // that quotes the entry name the same version.
  const citation = citationsFor({
    country,
    timelineDate: timelineDate ?? null,
    url,
    release: release ?? null,
    ...(accessed ? { accessed } : {}),
  }).apa;
  const lines = [
    `**Country:** ${country}`,
    `**Confidence:** ${formatConfidence(regulation?.confidence)}`,
    `**Last updated:** ${lastUpdated}`,
    `**Data version:** ${score ? score.dataVersion : 'unknown'}`,
    `**Cite as:** ${citation}`,
    `**App URL:** ${url}`,
    '',
    '| Dimension | Score |',
    '| --- | --- |',
  ];
  for (const { value, text } of SCORE_OPTIONS) {
    lines.push(`| ${text} | ${formatScore(score?.[value])} |`);
  }
  return lines;
}

function sourcesBlock(urls: string[], listed: number): string[] {
  if (urls.length === 0) return ['**Sources:** none on the entry'];
  const lines = [`**Sources (${urls.length}):**`, ''];
  urls.slice(0, listed).forEach((url, i) => lines.push(`${i + 1}. ${url}`));
  const hidden = urls.length - listed;
  if (hidden > 0) {
    lines.push('', `_${hidden} more not listed here to keep this issue short; the panel shows all ${urls.length}._`);
  }
  return lines;
}

interface SubRow {
  dimension: string;
  label: string;
  score: number;
  rationale: string | null;
}

function subIndicatorRows(entry: SubscoreEntry | null): SubRow[] {
  if (!entry) return [];
  const rows: SubRow[] = [];
  for (const dimension of Object.keys(DIMENSION_TO_SNAKE) as DimensionKey[]) {
    const snake = DIMENSION_TO_SNAKE[dimension];
    const block = entry[snake];
    if (!block) continue;
    for (const [key, label] of SUBSCORE_LABELS[snake]) {
      const cell = block[key];
      if (cell == null) continue;
      rows.push({ dimension: ATTRIBUTE_LABELS[dimension], label, score: cell.score, rationale: cell.rationale });
    }
  }
  return rows;
}

/** How much of the sub-indicator audit trail the block carries. */
type DetailLevel = 'rationales' | 'scores' | 'none';

function detailsBlock(rows: SubRow[], date: string, level: DetailLevel): string[] {
  if (level === 'none' || rows.length === 0) return [];
  const withRationales = level === 'rationales';
  const lines = [
    '<details>',
    `<summary>Sub-indicators${date ? ` (assessed ${date})` : ''}</summary>`,
    '',
    withRationales ? '| Dimension | Sub-indicator | Score | Rationale |' : '| Dimension | Sub-indicator | Score |',
    withRationales ? '| --- | --- | --- | --- |' : '| --- | --- | --- |',
  ];
  for (const row of rows) {
    const cells = `| ${row.dimension} | ${row.label} | ${formatScore(row.score)} |`;
    lines.push(withRationales ? `${cells} ${tableCell(row.rationale ?? '')} |` : cells);
  }
  if (!withRationales) {
    lines.push('', '_Rationales left out to keep this issue short; the panel shows them._');
  }
  lines.push('', '</details>');
  return lines;
}

/**
 * The Markdown that lands in the form's "Entry as shown in the app"
 * field. Everything in it is on screen in the panel. The sub-indicator
 * block joins only once the audit trail carries rationales.
 *
 * Over either length cap, the body sheds detail in a fixed order:
 * unlisted sources (down to a floor, with a count), then the rationales,
 * then the whole sub-indicator block, then the remaining sources.
 */
export function buildReportBody(entry: ReportEntry): string {
  const header = headerBlock(entry);
  const urls = classifySources(entry.regulation?.sources).map(s => s.url);
  const rows = subIndicatorRows(entry.subscores);
  const date = entry.subscores?.date ?? '';
  const levels: DetailLevel[] = rows.some(r => r.rationale) ? ['rationales', 'scores', 'none'] : ['none'];

  const assemble = (listed: number, level: DetailLevel): string => {
    const details = detailsBlock(rows, date, level);
    return [
      ...header,
      '',
      ...sourcesBlock(urls, listed),
      ...(details.length > 0 ? ['', ...details] : []),
    ].join('\n');
  };

  const floor = Math.min(urls.length, MIN_SOURCES_LISTED);
  for (const level of levels) {
    for (let listed = urls.length; listed >= floor; listed--) {
      const body = assemble(listed, level);
      if (fits(body)) return body;
    }
  }
  for (let listed = floor - 1; listed >= 0; listed--) {
    const body = assemble(listed, 'none');
    if (fits(body)) return body;
  }
  // Only an absurd app URL or citation gets here; keep the head.
  let body = assemble(0, 'none').slice(0, MAX_BODY_LENGTH);
  while (!fits(body)) body = body.slice(0, Math.floor(body.length * 0.9));
  return body;
}

/** The issue-form URL: GitHub's own parameters plus the form's field ids. */
export function buildReportUrl(entry: ReportEntry): string {
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    labels: ISSUE_LABEL,
    title: reportTitle(entry.country),
    country: entry.country,
    entry: buildReportBody(entry),
  });
  return `${ISSUE_NEW_URL}?${params.toString()}`;
}

export function initReport(): void {
  maybeEl<HTMLButtonElement>('report-btn')?.addEventListener('click', () => {
    const state = getState();
    const country = state.selectedCountry;
    if (!country) return;
    const url = buildReportUrl({
      country,
      score: state.scoreData[country] ?? null,
      regulation: state.regulationData[country] ?? null,
      subscores: state.subscores?.countries[country] ?? null,
      timelineDate: state.timelineDate,
      release: state.release,
      url: buildPermalink(state, { omitTheme: true }),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}
