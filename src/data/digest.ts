// Weekly digest files (public/digest/): the shape the pipeline's
// digest.py writes, parsed defensively, plus the small pure helpers the
// changes page renders with. No DOM here so it is unit-testable.

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

/** The run moved the country's confidence level. */
export function confidenceChanged(change: DigestChange): boolean {
  return !!change.confidence.new && change.confidence.old !== change.confidence.new;
}

/** Confidence movement for display: 'medium → high', or 'high' when new. */
export function formatConfidenceChange(confidence: DigestChange['confidence']): string {
  return confidence.old ? `${confidence.old} → ${confidence.new}` : confidence.new;
}

/**
 * The facts listed for a country that changed but has no written item
 * ("Also changed"): its score movements, law and confidence changes, or
 * "first scored in this run". A run whose only change was confidence
 * used to list the country with nothing after the colon.
 */
export function uncoveredFacts(change: DigestChange): string[] {
  const deltas = Object.values(change.scores);
  const firstScored = deltas.length > 0 && deltas.every((d) => d.old === null);
  if (firstScored) return ['first scored in this run'];
  const facts = Object.entries(change.scores).map(([key, delta]) => `${dimensionLabel(key)} ${formatDelta(delta)}`);
  if (change.laws) facts.push('specific laws updated');
  if (confidenceChanged(change)) facts.push(`confidence ${formatConfidenceChange(change.confidence)}`);
  return facts;
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
