// Per-country score change history derived from history.json snapshots.
// Pure - no DOM, unit-tested.

import { ATTRIBUTE_LABELS, INSUFFICIENT_EVIDENCE_LABEL } from '../constants';
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

/** A score whose moves the changelog lists: a dimension, or the frontier
 *  lens (PRD 15), labelled from the vocabulary like the others. */
export type ChangeKey = DimensionKey | 'frontierRisk';

const CHANGE_KEYS: ChangeKey[] = [...DIMENSION_KEYS, 'frontierRisk'];

/** True for a move on one of the five dimensions (not the frontier lens). */
export function isDimensionChange(change: { dimension: ChangeKey }): change is { dimension: DimensionKey } & ChangelogChange {
  return change.dimension !== 'frontierRisk';
}

// A snapshot carries the frontier keys only once the country has been
// scored on the lens.
function hasFrontier(snapshot: HistorySnapshot): boolean {
  return snapshot.frontierTrack != null || 'frontierRisk' in snapshot;
}

/** One dimension's move. A null `from` or `to` is "insufficient evidence"
 * (rubric v3.1): such a move has no size and no direction. */
export interface ChangelogChange {
  dimension: ChangeKey;
  label: string;
  from: number | null;
  to: number | null;
}

/** A changelog value for display: the number, or "insufficient evidence". */
export function formatChangeValue(value: number | null): string {
  return value == null ? INSUFFICIENT_EVIDENCE_LABEL.toLowerCase() : String(value);
}

/** 'up' or 'down' for a move between two scores; null for a move to or
 * from insufficient evidence, which has no direction. */
export function changeDirection(change: { from: number | null; to: number | null }): 'up' | 'down' | null {
  if (change.from == null || change.to == null) return null;
  return change.to > change.from ? 'up' : 'down';
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

    for (const key of CHANGE_KEYS) {
      // The frontier lens's first score is an assessment, not a move: it
      // has no earlier value to differ from (PRD 15). Only a change between
      // two frontier snapshots is listed.
      if (key === 'frontierRisk' && !(hasFrontier(prev) && hasFrontier(curr))) continue;
      // `?? null`: a key absent from an old snapshot reads like a null
      // value, so null against missing is no change.
      const from = prev[key] ?? null;
      const to = curr[key] ?? null;
      if (from !== to) {
        changes.push({ dimension: key, label: ATTRIBUTE_LABELS[key] || key, from, to });
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
  /** The dimension (or the frontier lens) with the largest net move inside the window. */
  dimension: ChangeKey;
  label: string;
  /** Signed net move on that dimension, rounded to two decimals; null for
   * a move to or from insufficient evidence (no size, no direction). */
  delta: number | null;
  /** Only on a null `delta`: the values before and after the window. One
   * of the two is null (insufficient evidence). */
  from?: number | null;
  to?: number | null;
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
 * and moved back nets to zero and is ignored.
 *
 * The net move compares the value before the window's first change with
 * the value after its last. When exactly one of the two is null
 * (insufficient evidence) the move has no size: `delta` is null and the
 * entry carries `from` and `to`. A country is listed under such a move
 * only when no dimension moved by a number, and these entries sort after
 * every sized move.
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

    // Per dimension: the value before the window (the oldest change's
    // `from`) and after it (the newest change's `to`). computeChangelog
    // returns entries newest-first.
    const span: Partial<Record<ChangeKey, { from: number | null; to: number | null }>> = {};
    for (const entry of [...entries].reverse()) {
      for (const c of entry.changes) {
        const known = span[c.dimension];
        span[c.dimension] = { from: known ? known.from : c.from, to: c.to };
      }
    }

    let best: { dimension: ChangeKey; delta: number } | null = null;
    let unsized: { dimension: ChangeKey; from: number | null; to: number | null } | null = null;
    for (const key of CHANGE_KEYS) {
      const move = span[key];
      if (!move || move.from === move.to) continue;
      if (move.from == null || move.to == null) {
        unsized ??= { dimension: key, from: move.from, to: move.to };
        continue;
      }
      const delta = Math.round((move.to - move.from) * 100) / 100;
      if (delta === 0) continue;
      if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { dimension: key, delta };
    }

    // computeChangelog returns entries newest-first.
    const date = entries[0].date;
    if (best) {
      result.push({
        country, dimension: best.dimension, label: ATTRIBUTE_LABELS[best.dimension], delta: best.delta, date,
      });
    } else if (unsized) {
      result.push({
        country, dimension: unsized.dimension, label: ATTRIBUTE_LABELS[unsized.dimension],
        delta: null, from: unsized.from, to: unsized.to, date,
      });
    }
  }

  // Sized moves first, largest first; unsized (insufficient evidence) moves
  // after them; ties by name.
  const size = (c: RecentChange) => (c.delta == null ? -1 : Math.abs(c.delta));
  return result.sort((a, b) => size(b) - size(a) || a.country.localeCompare(b.country));
}

/**
 * The "This week" move for display: a signed delta ('+0.25'), or for a
 * move to or from insufficient evidence 'insufficient evidence' (now
 * unscored) or 'insufficient evidence → 3' (scored again). No direction.
 */
export function formatRecentMove(change: RecentChange): string {
  if (change.delta != null) return formatSignedDelta(change.delta);
  const label = INSUFFICIENT_EVIDENCE_LABEL.toLowerCase();
  return change.to == null ? label : `${label} → ${change.to}`;
}

/** A delta for display, always signed: '+0.25', '−0.5' (a true minus sign). */
export function formatSignedDelta(delta: number): string {
  const rounded = Math.round(delta * 100) / 100;
  return rounded < 0 ? `−${Math.abs(rounded)}` : `+${rounded}`;
}
