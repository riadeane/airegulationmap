// Per-country score change history derived from history.json snapshots.
// Pure - no DOM, unit-tested.

import { ATTRIBUTE_LABELS } from '../constants';
import type { DimensionKey } from '../constants';
import { historyBreaks } from './history';
import type { HistoryBreak, HistoryData, HistorySnapshot } from './history';

// The five independently scored dimensions. averageScore is derived,
// so it never appears as its own changelog line.
const DIMENSION_KEYS: DimensionKey[] = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

export interface ChangelogChange {
  dimension: DimensionKey;
  label: string;
  from: number | null;
  to: number | null;
}

export interface ChangelogDiffEntry {
  date: string;
  initial?: undefined;
  changes: ChangelogChange[];
  /** Set when the change is dated on a calibration break: the reason. */
  recalibration?: string;
}

export interface ChangelogInitialEntry {
  date: string;
  initial: true;
  scores: Partial<Record<DimensionKey, number>>;
}

export type ChangelogEntry = ChangelogDiffEntry | ChangelogInitialEntry;

/**
 * Compute a changelog from a country's history snapshots.
 *
 * Returns entries sorted newest-first: diff entries listing which
 * dimensions changed, with the initial assessment as the oldest entry.
 * A diff entry dated on one of `breaks` carries that break's reason as
 * `recalibration`. Returns [] when there are no snapshots.
 */
export function computeChangelog(
  countryHistory: HistorySnapshot[] | null | undefined,
  breaks: HistoryBreak[] = []
): ChangelogEntry[] {
  if (!countryHistory || countryHistory.length === 0) return [];

  const sorted = [...countryHistory].sort((a, b) => a.date.localeCompare(b.date));
  const reasonByDate = new Map(breaks.map(b => [b.date, b.reason]));
  const changelog: ChangelogEntry[] = [];

  const initialScores: Partial<Record<DimensionKey, number>> = {};
  for (const key of DIMENSION_KEYS) {
    const value = sorted[0][key];
    if (value != null) initialScores[key] = value;
  }
  changelog.push({ date: sorted[0].date, initial: true, scores: initialScores });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const changes: ChangelogChange[] = [];

    for (const key of DIMENSION_KEYS) {
      if (prev[key] !== curr[key]) {
        changes.push({
          dimension: key,
          label: ATTRIBUTE_LABELS[key] || key,
          from: prev[key],
          to: curr[key],
        });
      }
    }

    if (changes.length > 0) {
      const recalibration = reasonByDate.get(curr.date);
      changelog.push(
        recalibration === undefined
          ? { date: curr.date, changes }
          : { date: curr.date, changes, recalibration }
      );
    }
  }

  return changelog.reverse();
}

/**
 * True for a diff entry that records a policy event: not the initial
 * assessment and not a recalibration.
 */
export function isPolicyChange(entry: ChangelogEntry): boolean {
  return !entry.initial && entry.recalibration === undefined;
}

// ---------------------------------------------------------------------------
// "This week": the countries whose scores moved inside a trailing window.

export interface RecentChange {
  country: string;
  /** The dimension with the largest net move inside the window. */
  dimension: DimensionKey;
  label: string;
  /** Signed net move on that dimension, rounded to two decimals. */
  delta: number;
  /** Date of the country's most recent change inside the window. */
  date: string;
}

/** The ISO date `days` days after `date` (negative `days` goes back). */
function shiftDate(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * Countries whose scores changed in the `windowDays` days that end on
 * `today` (both bounds inclusive, so a change dated exactly seven days
 * ago still counts). One entry per country: the dimension with the
 * largest net move across every change in the window and its signed
 * delta. Sorted by the size of the move, largest first; ties by name.
 *
 * Only policy changes count: the initial assessment has no previous
 * snapshot to differ from, and a change dated on a calibration break is
 * a re-measurement of every country, not news. A dimension that moved
 * and moved back nets to zero and is ignored, as is a dimension whose
 * old or new value is missing (there is no delta to show).
 */
export function computeRecentChanges(
  history: HistoryData | null | undefined,
  today: string,
  windowDays = 7
): RecentChange[] {
  if (!history) return [];
  const since = shiftDate(today, -windowDays);
  const breaks = historyBreaks(history);
  const result: RecentChange[] = [];

  for (const [country, snapshots] of Object.entries(history.countries)) {
    const entries = computeChangelog(snapshots, breaks).filter(
      (e): e is ChangelogDiffEntry => isPolicyChange(e) && e.date >= since && e.date <= today
    );
    if (entries.length === 0) continue;

    const net: Partial<Record<DimensionKey, number>> = {};
    for (const entry of entries) {
      for (const c of entry.changes) {
        if (c.from == null || c.to == null) continue;
        net[c.dimension] = (net[c.dimension] ?? 0) + (c.to - c.from);
      }
    }

    let best: { dimension: DimensionKey; delta: number } | null = null;
    for (const key of DIMENSION_KEYS) {
      const delta = Math.round((net[key] ?? 0) * 100) / 100;
      if (delta === 0) continue;
      if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { dimension: key, delta };
    }
    if (!best) continue;

    result.push({
      country,
      dimension: best.dimension,
      label: ATTRIBUTE_LABELS[best.dimension],
      delta: best.delta,
      // computeChangelog returns entries newest-first.
      date: entries[0].date,
    });
  }

  return result.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.country.localeCompare(b.country)
  );
}

/** A delta for display, always signed: '+0.25', '−0.5' (a true minus sign). */
export function formatSignedDelta(delta: number): string {
  const rounded = Math.round(delta * 100) / 100;
  return rounded < 0 ? `−${Math.abs(rounded)}` : `+${rounded}`;
}
