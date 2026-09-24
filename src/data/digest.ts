// Digest files (public/digest/): the weekly digests and monthly trend
// pieces the pipeline's digest.py writes, parsed defensively, plus the
// small pure helpers the changes page renders with. No DOM here so it is
// unit-testable.

import { ATTRIBUTE_LABELS } from '../constants';

export interface DigestItem {
  country: string;
  headline: string;
  summary: string;
  sources: string[];
}

export interface ScoreDelta {
  old: number | null;
  new: number | null;
}

export interface DigestChange {
  country: string;
  /** Only the dimensions that moved, keyed by snake_case dimension key. */
  scores: Record<string, ScoreDelta>;
  laws: { old: string | null; new: string } | null;
  confidence: { old: string | null; new: string };
  sources: string[];
  newSources: string[];
}

export interface CalibrationBreak {
  date: string;
  model: string;
  reason: string;
}

export interface Digest {
  week: string;
  date: string;
  generatedAt: string;
  runId: string;
  model: string;
  /** Set when the run recalibrated the scale (PRD 01, addendum A). */
  calibrationBreak: CalibrationBreak | null;
  lead: string;
  items: DigestItem[];
  changes: DigestChange[];
}

export interface DigestWeek {
  week: string;
  date: string;
  runId: string;
  model: string;
  itemCount: number;
  changeCount: number;
  file: string;
}

export const WEEK_RE = /^(\d{4})-W(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function scoreValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseItem(raw: unknown): DigestItem | null {
  if (!isRecord(raw)) return null;
  const country = str(raw.country);
  const headline = str(raw.headline);
  const summary = str(raw.summary);
  if (!country || !headline || !summary) return null;
  return { country, headline, summary, sources: strings(raw.sources) };
}

function parseChange(raw: unknown): DigestChange | null {
  if (!isRecord(raw)) return null;
  const country = str(raw.country);
  if (!country) return null;

  const scores: Record<string, ScoreDelta> = {};
  if (isRecord(raw.scores)) {
    for (const [key, delta] of Object.entries(raw.scores)) {
      if (!isRecord(delta)) continue;
      scores[key] = { old: scoreValue(delta.old), new: scoreValue(delta.new) };
    }
  }

  let laws: DigestChange['laws'] = null;
  if (isRecord(raw.laws) && typeof raw.laws.new === 'string') {
    laws = { old: str(raw.laws.old), new: raw.laws.new };
  }

  const confidence = isRecord(raw.confidence)
    ? { old: str(raw.confidence.old), new: str(raw.confidence.new) ?? '' }
    : { old: null, new: '' };

  return {
    country,
    scores,
    laws,
    confidence,
    sources: strings(raw.sources),
    newSources: strings(raw.new_sources),
  };
}

function parseBreak(raw: unknown): CalibrationBreak | null {
  if (!isRecord(raw)) return null;
  const reason = str(raw.reason);
  if (!reason) return null;
  return { date: str(raw.date) ?? '', model: str(raw.model) ?? '', reason };
}

/** Parse one week file. Throws on a document that is not a digest at all;
 * malformed items or changes inside an otherwise valid file are skipped. */
export function parseDigest(raw: unknown): Digest {
  if (!isRecord(raw)) throw new Error('digest: not an object');
  const week = str(raw.week);
  const date = str(raw.date);
  const lead = str(raw.lead);
  if (!week || !WEEK_RE.test(week) || !date || lead === null) {
    throw new Error('digest: missing week, date or lead');
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  const changes = Array.isArray(raw.changes) ? raw.changes : [];
  return {
    week,
    date,
    generatedAt: str(raw.generated_at) ?? '',
    runId: str(raw.run_id) ?? '',
    model: str(raw.model) ?? '',
    calibrationBreak: parseBreak(raw.calibration_break),
    lead,
    items: items.map(parseItem).filter((i): i is DigestItem => i !== null),
    changes: changes.map(parseChange).filter((c): c is DigestChange => c !== null),
  };
}

/** Parse index.json into weeks, newest first (re-sorted, so a hand-edited
 * index still renders in order). Unknown entries are skipped. */
export function parseDigestIndex(raw: unknown): DigestWeek[] {
  if (!isRecord(raw) || !Array.isArray(raw.weeks)) return [];
  const weeks: DigestWeek[] = [];
  for (const entry of raw.weeks) {
    if (!isRecord(entry)) continue;
    const week = str(entry.week);
    const file = str(entry.file);
    if (!week || !WEEK_RE.test(week) || !file) continue;
    weeks.push({
      week,
      date: str(entry.date) ?? '',
      runId: str(entry.run_id) ?? '',
      model: str(entry.model) ?? '',
      itemCount: typeof entry.item_count === 'number' ? entry.item_count : 0,
      changeCount: typeof entry.change_count === 'number' ? entry.change_count : 0,
      file,
    });
  }
  return weeks.sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
}

/** The week to show: the `?week=` request when it is in the index, else
 * the newest week; null when the index is empty. */
export function pickWeek(weeks: DigestWeek[], requested: string | null): DigestWeek | null {
  if (requested) {
    const match = weeks.find((w) => w.week === requested);
    if (match) return match;
  }
  return weeks[0] ?? null;
}

/** '2026-W37' -> 'Week 37, 2026'. Falls back to the raw id. */
export function weekLabel(week: string): string {
  const m = WEEK_RE.exec(week);
  if (!m) return week;
  return `Week ${Number(m[2])}, ${m[1]}`;
}

/** Deep link to a country in the app. */
export function countryHref(country: string): string {
  return `/?country=${encodeURIComponent(country)}`;
}

/** 'regulation_status' -> 'Regulation Status' (the app's attribute label). */
export function dimensionLabel(key: string): string {
  const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const label = (ATTRIBUTE_LABELS as Record<string, string>)[camel];
  return label ?? key;
}

/** Score movement for display: 'new at 3.75', '3 → 3.75', or 'removed'. */
export function formatDelta(delta: ScoreDelta): string {
  if (delta.new === null) return 'removed';
  if (delta.old === null) return `new at ${delta.new}`;
  return `${delta.old} → ${delta.new}`;
}

/** The host of a source URL, without www., for compact link text. */
export function sourceHost(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return url;
  }
}

/** Structured change data by country, so items can show the numbers the
 * prose was written from. */
export function changesByCountry(digest: Digest): Map<string, DigestChange> {
  return new Map(digest.changes.map((c) => [c.country, c]));
}

/** Countries that changed but got no prose item (the model skipped them
 * or their item was rejected for citing a URL the run did not find). */
export function changesWithoutItems(digest: Digest): DigestChange[] {
  const covered = new Set(digest.items.map((i) => i.country));
  return digest.changes.filter((c) => !covered.has(c.country));
}

// ---------------------------------------------------------------------------
// Monthly trend pieces (PRD 12): public/digest/YYYY-MM.json, listed under
// `months` in index.json. Each piece carries its charts as SVG strings the
// page sanitizes (./svg) plus a preformatted table of the same numbers.

export interface MonthlySection {
  heading: string;
  text: string;
  sources: string[];
}

/** Preformatted strings, rendered as they are; the raw numbers live in the
 * chart's `data` field for machine readers and are not parsed here. */
export interface MonthlyTable {
  columns: string[];
  rows: string[][];
}

export interface MonthlyChart {
  id: string;
  title: string;
  caption: string;
  /** SVG markup, untrusted until sanitized; '' when only the table came. */
  svg: string;
  table: MonthlyTable;
}

export interface MonthlyDrift {
  text: string;
  /** Root-relative or http(s); '' when the file carried anything else. */
  href: string;
  label: string;
}

export interface TrendWindow {
  start: string;
  end: string;
  weeks: number | null;
}

export interface MonthlyPiece {
  month: string;
  date: string;
  generatedAt: string;
  runId: string;
  model: string;
  promptVersion: string;
  period: { start: string; end: string } | null;
  /** The trailing window the charts cover (13 weeks by default). */
  window: TrendWindow | null;
  /** The weekly digests the narrative was written from. */
  weeks: string[];
  calibrationBreaks: CalibrationBreak[];
  lead: string;
  sections: MonthlySection[];
  drift: MonthlyDrift | null;
  charts: MonthlyChart[];
}

export interface DigestMonth {
  month: string;
  date: string;
  runId: string;
  model: string;
  sectionCount: number;
  chartCount: number;
  file: string;
}

export const MONTH_RE = /^(\d{4})-(\d{2})$/;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

// Links the page builds from file contents: absolute http(s), or a path on
// this site (never protocol-relative, which would leave the origin).
function safeHref(value: unknown): string {
  const href = str(value) ?? '';
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return isHttpUrl(href) ? href : '';
}

function tableCell(value: unknown): string {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function parseTable(raw: unknown): MonthlyTable | null {
  if (!isRecord(raw)) return null;
  const columns = strings(raw.columns);
  if (!columns.length) return null;
  const rows = Array.isArray(raw.rows) ? raw.rows.filter(Array.isArray) : [];
  return { columns, rows: rows.map((row: unknown[]) => row.map(tableCell)) };
}

function parseChart(raw: unknown): MonthlyChart | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title);
  const svg = str(raw.svg) ?? '';
  const table = parseTable(raw.table);
  if (!title || (!svg && !table)) return null;
  return {
    id: str(raw.id) ?? '',
    title,
    caption: str(raw.caption) ?? '',
    svg,
    table: table ?? { columns: [], rows: [] },
  };
}

function parseSection(raw: unknown): MonthlySection | null {
  if (!isRecord(raw)) return null;
  const heading = str(raw.heading);
  const text = str(raw.text);
  if (!heading || !text) return null;
  return { heading, text, sources: strings(raw.sources).filter(isHttpUrl) };
}

function parseDrift(raw: unknown): MonthlyDrift | null {
  if (!isRecord(raw)) return null;
  const text = str(raw.text);
  if (!text) return null;
  return { text, href: safeHref(raw.href), label: str(raw.label) || 'Drift record' };
}

function parseWindow(raw: unknown): TrendWindow | null {
  if (!isRecord(raw)) return null;
  const end = str(raw.end);
  if (!end) return null;
  const weeks = typeof raw.weeks === 'number' && Number.isInteger(raw.weeks) && raw.weeks > 0
    ? raw.weeks
    : null;
  return { start: str(raw.start) ?? '', end, weeks };
}

function parsePeriod(raw: unknown): MonthlyPiece['period'] {
  if (!isRecord(raw)) return null;
  const start = str(raw.start);
  const end = str(raw.end);
  return start && end ? { start, end } : null;
}

/** Parse one monthly file. Throws on a document that is not a monthly
 * piece (a week file included); malformed sections or charts inside an
 * otherwise valid piece are skipped. */
export function parseMonthly(raw: unknown): MonthlyPiece {
  if (!isRecord(raw)) throw new Error('monthly: not an object');
  if (raw.kind !== 'monthly') throw new Error('monthly: not a monthly piece');
  const month = str(raw.month);
  const date = str(raw.date);
  const lead = str(raw.lead);
  if (!month || !MONTH_RE.test(month) || !date || lead === null) {
    throw new Error('monthly: missing month, date or lead');
  }
  const breaks = Array.isArray(raw.calibration_breaks) ? raw.calibration_breaks : [];
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const charts = Array.isArray(raw.charts) ? raw.charts : [];
  return {
    month,
    date,
    generatedAt: str(raw.generated_at) ?? '',
    runId: str(raw.run_id) ?? '',
    model: str(raw.model) ?? '',
    promptVersion: str(raw.prompt_version) ?? '',
    period: parsePeriod(raw.period),
    window: parseWindow(raw.window),
    weeks: strings(raw.weeks).filter((w) => WEEK_RE.test(w)),
    calibrationBreaks: breaks.map(parseBreak).filter((b): b is CalibrationBreak => b !== null),
    lead,
    sections: sections.map(parseSection).filter((s): s is MonthlySection => s !== null),
    drift: parseDrift(raw.drift),
    charts: charts.map(parseChart).filter((c): c is MonthlyChart => c !== null),
  };
}

/** Parse index.json's `months` into entries, newest first (re-sorted like
 * the weeks). An index written before monthly pieces has none: []. */
export function parseMonthIndex(raw: unknown): DigestMonth[] {
  if (!isRecord(raw) || !Array.isArray(raw.months)) return [];
  const months: DigestMonth[] = [];
  for (const entry of raw.months) {
    if (!isRecord(entry)) continue;
    const month = str(entry.month);
    const file = str(entry.file);
    if (!month || !MONTH_RE.test(month) || !file) continue;
    months.push({
      month,
      date: str(entry.date) ?? '',
      runId: str(entry.run_id) ?? '',
      model: str(entry.model) ?? '',
      sectionCount: typeof entry.section_count === 'number' ? entry.section_count : 0,
      chartCount: typeof entry.chart_count === 'number' ? entry.chart_count : 0,
      file,
    });
  }
  return months.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
}

/** The `?month=` request when it is in the index; null otherwise (there is
 * no implicit latest month: the weekly digest is the page's default). */
export function pickMonth(months: DigestMonth[], requested: string | null): DigestMonth | null {
  if (!requested) return null;
  return months.find((m) => m.month === requested) ?? null;
}

export type DigestView =
  | { kind: 'weekly'; week: DigestWeek }
  | { kind: 'monthly'; month: DigestMonth };

/** What the changes page shows: a requested month that is in the index,
 * else the weekly choice (`?week=` or the newest week), else the newest
 * month when no week has been published. Null when both lists are empty. */
export function pickView(
  weeks: DigestWeek[],
  months: DigestMonth[],
  requestedWeek: string | null,
  requestedMonth: string | null,
): DigestView | null {
  const month = pickMonth(months, requestedMonth);
  if (month) return { kind: 'monthly', month };
  const week = pickWeek(weeks, requestedWeek);
  if (week) return { kind: 'weekly', week };
  return months[0] ? { kind: 'monthly', month: months[0] } : null;
}

/** '2026-09' -> 'September 2026'. Falls back to the raw id. */
export function monthLabel(month: string): string {
  const m = MONTH_RE.exec(month);
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : month;
}

/** '2026-09-30' -> '30 September 2026'. Falls back to the raw string. */
export function dayLabel(date: string): string {
  const m = DAY_RE.exec(date);
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  return m && name ? `${Number(m[3])} ${name} ${m[1]}` : date;
}

/** The page subtitle, from the chart window: 'Movement by bloc and
 * dimension over the 13 weeks to 30 September 2026, with ...'. */
export function trendSubtitle(piece: MonthlyPiece): string {
  const weeks = piece.window?.weeks;
  const span = weeks === 1 ? 'the week' : weeks ? `the ${weeks} weeks` : 'the trailing quarter';
  const end = piece.window?.end ?? piece.period?.end;
  const to = end ? ` to ${dayLabel(end)}` : '';
  return `Movement by bloc and dimension over ${span}${to}, with the month's sourced changes.`;
}

/** Calibration breaks as prose: '14 September 2026 (Model switch)', with
 * several joined as 'a, b and c'. */
export function breakPhrase(breaks: CalibrationBreak[]): string {
  const parts = breaks.map((b) => (b.date ? `${dayLabel(b.date)} (${b.reason})` : b.reason));
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// A number as the tables print it: '3.38', '+0.05', '-0.25' (hyphen or
// minus sign), '12', '86%'.
const NUMERIC_CELL_RE = /^[+\-\u2212]?\d+(?:\.\d+)?%?$/;
const BLANK_CELLS = new Set(['', '-', '\u2013', '\u2014', 'n/a']);

/** Per column: true when every non-blank body cell is a number, so the
 * column (header included) is right-aligned. */
export function numericColumns(table: MonthlyTable): boolean[] {
  return table.columns.map((_, i) => {
    const cells = table.rows
      .map((row) => (row[i] ?? '').trim())
      .filter((cell) => !BLANK_CELLS.has(cell));
    return cells.length > 0 && cells.every((cell) => NUMERIC_CELL_RE.test(cell));
  });
}
