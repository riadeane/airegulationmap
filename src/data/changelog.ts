// Per-country score change history derived from history.json snapshots.
// Pure - no DOM, unit-tested.

import { ATTRIBUTE_LABELS } from '../constants';
import type { DimensionKey } from '../constants';
import type { HistoryBreak, HistorySnapshot } from './history';

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
