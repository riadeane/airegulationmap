// Drift dashboard aggregations (drift.html). Everything here is pure and
// unit-tested: the page entry (src/drift.ts) loads the files, calls these,
// and hands the results to the charts (src/charts/drift.ts).
//
// "Week" throughout means one research run's snapshot date. history.json
// only records change-points, so the dates it carries are exactly the runs
// that moved at least one score.

import { ATTRIBUTE_LABELS } from '../constants';
import type { DimensionKey } from '../constants';
import type { BlocsData } from './blocs';
import { computeChangelog } from './changelog';
import type { ChangelogDiffEntry } from './changelog';
import { historyBreaks } from './history';
import type { HistoryData } from './history';
import type { RegulationData } from './loader';

/** The five scored dimensions in rubric order (the maturity index is derived). */
export const DIMENSIONS: DimensionKey[] = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

/** One dimension of one country moving on one run. */
export interface ScoreMove {
  country: string;
  dimension: DimensionKey;
  from: number;
  to: number;
  /** to - from, rounded to two decimals. */
  delta: number;
}

/** Everything that moved on one run date. */
export interface WeekChanges {
  date: string;
  /** Countries with at least one dimension moved. */
  changed: number;
  /** Countries counted once each, under the dimension that moved most. */
  byDimension: Record<DimensionKey, number>;
  /** Countries whose first snapshot is dated on this run. */
  firstScored: number;
  /** Set when the date is a calibration break: the recorded reason. */
  recalibration: string | null;
  /** Names of the countries that changed, sorted. */
  countries: string[];
  /** Every dimension move with both an old and a new score. */
  moves: ScoreMove[];
}

function emptyByDimension(): Record<DimensionKey, number> {
  return {
    regulationStatus: 0,
    policyLever: 0,
    governanceType: 0,
    actorInvolvement: 0,
    enforcementLevel: 0,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The dimension a changed country is counted under: the one with the
 * largest absolute move, ties broken by rubric order. A change whose
 * old or new value is missing has no size, so it only wins when nothing
 * else moved.
 */
export function dominantDimension(entry: ChangelogDiffEntry): DimensionKey {
  let best: { dimension: DimensionKey; size: number } | null = null;
  for (const dimension of DIMENSIONS) {
    const change = entry.changes.find(c => c.dimension === dimension);
    if (!change) continue;
    const size = change.from == null || change.to == null ? 0 : Math.abs(change.to - change.from);
    if (!best || size > best.size) best = { dimension, size };
  }
  return best ? best.dimension : entry.changes[0].dimension;
}

/**
 * Score movement per run date, oldest first. Reuses the per-country
 * changelog so the page counts exactly what the panel shows: a country
 * changes on a date when any of the five dimensions differs from its
 * previous snapshot; its first snapshot is an assessment, not a change.
 */
export function computeWeeklyChanges(history: HistoryData | null | undefined): WeekChanges[] {
  if (!history) return [];
  const breaks = historyBreaks(history);
  const reasonByDate = new Map(breaks.map(b => [b.date, b.reason]));
  const weeks = new Map<string, WeekChanges>();

  const week = (date: string): WeekChanges => {
    let w = weeks.get(date);
    if (!w) {
      w = {
        date,
        changed: 0,
        byDimension: emptyByDimension(),
        firstScored: 0,
        recalibration: reasonByDate.get(date) ?? null,
        countries: [],
        moves: [],
      };
      weeks.set(date, w);
    }
    return w;
  };

  for (const [country, snapshots] of Object.entries(history.countries)) {
    for (const entry of computeChangelog(snapshots, breaks)) {
      if (entry.initial) {
        week(entry.date).firstScored += 1;
        continue;
      }
      const w = week(entry.date);
      w.changed += 1;
      w.countries.push(country);
      w.byDimension[dominantDimension(entry)] += 1;
      for (const change of entry.changes) {
        if (change.from == null || change.to == null) continue;
        w.moves.push({
          country,
          dimension: change.dimension,
          from: change.from,
          to: change.to,
          delta: round2(change.to - change.from),
        });
      }
    }
  }

  const result = [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const w of result) {
    w.countries.sort((a, b) => a.localeCompare(b));
    w.moves.sort(
      (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
        || a.country.localeCompare(b.country)
        || DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension)
    );
  }
  return result;
}

/** Score step: sub-indicator means land on quarter points. */
export const DELTA_STEP = 0.25;

export interface DeltaBin {
  /** The bin's centre, a multiple of DELTA_STEP. */
  delta: number;
  count: number;
}

/** Moves binned to the nearest quarter point, ascending; empty bins omitted. */
export function binDeltas(moves: ScoreMove[]): DeltaBin[] {
  const counts = new Map<number, number>();
  for (const move of moves) {
    const bin = Math.round(move.delta / DELTA_STEP) * DELTA_STEP;
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([delta, count]) => ({ delta, count }))
    .sort((a, b) => a.delta - b.delta);
}

export interface DeltaSummary {
  count: number;
  up: number;
  down: number;
  /** Median absolute move; 0 when there are no moves. */
  medianAbs: number;
  /** Largest absolute move; 0 when there are no moves. */
  largestAbs: number;
}

export function summarizeDeltas(moves: ScoreMove[]): DeltaSummary {
  if (moves.length === 0) return { count: 0, up: 0, down: 0, medianAbs: 0, largestAbs: 0 };
  const abs = moves.map(m => Math.abs(m.delta)).sort((a, b) => a - b);
  const mid = Math.floor(abs.length / 2);
  const medianAbs = abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2;
  return {
    count: moves.length,
    up: moves.filter(m => m.delta > 0).length,
    down: moves.filter(m => m.delta < 0).length,
    medianAbs: round2(medianAbs),
    largestAbs: abs[abs.length - 1],
  };
}

/** The latest run that moved a score, or null when nothing has ever moved. */
export function latestWeek(weeks: WeekChanges[]): WeekChanges | null {
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].changed > 0) return weeks[i];
  }
  return null;
}

/** The `n` largest moves of one run (weeks sort their moves largest first). */
export function largestMoves(week: WeekChanges | null, n = 10): ScoreMove[] {
  return week ? week.moves.slice(0, n) : [];
}

// ---------------------------------------------------------------------------
// Confidence.

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export interface ConfidenceCohort {
  /** The `Last Updated` date shared by the entries in this cohort. */
  date: string;
  counts: Record<ConfidenceLevel, number>;
  total: number;
}

function isLevel(value: string): value is ConfidenceLevel {
  return (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

/**
 * Confidence labels grouped by the run that last updated each entry,
 * oldest first. The files keep only each entry's current label, so this
 * is a cross-section by research vintage: each cohort is the set of
 * countries a run researched last, with the confidence that run gave
 * them. Entries with no date or an unknown label are skipped.
 */
export function confidenceByVintage(regulation: RegulationData | null | undefined): ConfidenceCohort[] {
  if (!regulation) return [];
  const cohorts = new Map<string, ConfidenceCohort>();
  for (const entry of Object.values(regulation)) {
    const level = (entry.confidence ?? '').trim().toLowerCase();
    if (!entry.lastUpdated || !isLevel(level)) continue;
    let cohort = cohorts.get(entry.lastUpdated);
    if (!cohort) {
      cohort = { date: entry.lastUpdated, counts: { high: 0, medium: 0, low: 0 }, total: 0 };
      cohorts.set(entry.lastUpdated, cohort);
    }
    cohort.counts[level] += 1;
    cohort.total += 1;
  }
  return [...cohorts.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Overall counts across every cohort. */
export function confidenceTotals(cohorts: ConfidenceCohort[]): ConfidenceCohort {
  const totals: ConfidenceCohort = { date: '', counts: { high: 0, medium: 0, low: 0 }, total: 0 };
  for (const cohort of cohorts) {
    for (const level of CONFIDENCE_LEVELS) totals.counts[level] += cohort.counts[level];
    totals.total += cohort.total;
    if (cohort.date > totals.date) totals.date = cohort.date;
  }
  return totals;
}

/** 0-100, rounded to a whole percent; 0 for an empty cohort. */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Gold-set drift (public/data/drift.json, PRD 08).

export interface DriftCheck {
  runId: string;
  date: string;
  model: string;
  promptVersion: string;
  countriesCompared: number;
  countriesMissing: string[];
  /** Keyed by snake_case dimension (`regulation_status`, …). */
  maeByDimension: Record<string, number>;
  withinOne: number;
  maxDev: number | null;
  maxDevAt: { country: string; dimension: string; subindicator: string; gold: number; run: number } | null;
}

/** The within-one share below which a run carries a calibration warning. */
export const WARN_WITHIN_ONE = 0.8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Parse drift.json. Returns [] for a missing or malformed document and
 * skips rows without a date or a within-one share. Rows are sorted by
 * date, ties in file order.
 */
export function parseDriftChecks(raw: unknown): DriftCheck[] {
  if (!isRecord(raw) || !Array.isArray(raw.checks)) return [];
  const checks: DriftCheck[] = [];
  for (const row of raw.checks) {
    if (!isRecord(row)) continue;
    const date = str(row.date);
    const withinOne = num(row.within_one);
    if (!date || withinOne == null) continue;

    const maeByDimension: Record<string, number> = {};
    if (isRecord(row.mae_by_dimension)) {
      for (const [key, value] of Object.entries(row.mae_by_dimension)) {
        const v = num(value);
        if (v != null) maeByDimension[key] = v;
      }
    }

    let maxDevAt: DriftCheck['maxDevAt'] = null;
    if (isRecord(row.max_dev_at)) {
      const gold = num(row.max_dev_at.gold);
      const run = num(row.max_dev_at.run);
      if (gold != null && run != null) {
        maxDevAt = {
          country: str(row.max_dev_at.country),
          dimension: str(row.max_dev_at.dimension),
          subindicator: str(row.max_dev_at.subindicator),
          gold,
          run,
        };
      }
    }

    checks.push({
      runId: str(row.run_id),
      date,
      model: str(row.model),
      promptVersion: str(row.prompt_version),
      countriesCompared: num(row.countries_compared) ?? 0,
      countriesMissing: Array.isArray(row.countries_missing)
        ? row.countries_missing.filter((v): v is string => typeof v === 'string')
        : [],
      maeByDimension,
      withinOne,
      maxDev: num(row.max_dev),
      maxDevAt,
    });
  }
  return checks.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Research runs (Supabase `research_runs`, when configured).

export interface GateCounts {
  appliedEvidence: number;
  appliedPersisted: number;
  held: number;
  unchanged: number;
}

/**
 * The gate tally the mirror writes into `research_runs.notes`, e.g.
 * `gate: applied:evidence=12 applied:persisted=3 held=7 unchanged=170`.
 * Null when the notes carry no gate block (a run before PRD 01, or one
 * that aborted before the tally).
 */
export function parseGateCounts(notes: string | null | undefined): GateCounts | null {
  if (!notes) return null;
  const block = /gate:\s*([^;]*)/.exec(notes);
  if (!block) return null;
  const counts: GateCounts = { appliedEvidence: 0, appliedPersisted: 0, held: 0, unchanged: 0 };
  let found = false;
  for (const pair of block[1].trim().split(/\s+/)) {
    const m = /^([a-z:]+)=(\d+)$/.exec(pair);
    if (!m) continue;
    const value = Number(m[2]);
    switch (m[1]) {
      case 'applied:evidence': counts.appliedEvidence = value; found = true; break;
      case 'applied:persisted': counts.appliedPersisted = value; found = true; break;
      case 'held': counts.held = value; found = true; break;
      case 'unchanged': counts.unchanged = value; found = true; break;
    }
  }
  return found ? counts : null;
}

export interface ResearchRun {
  id: string;
  /** ISO date (YYYY-MM-DD) the run started, in UTC. */
  date: string;
  finished: boolean;
  trigger: string;
  model: string;
  promptVersion: string;
  grounded: boolean;
  countriesAttempted: number | null;
  countriesSucceeded: number | null;
  gate: GateCounts | null;
  notes: string;
}

/** Parse one `research_runs` row; null when it has no id or start time. */
export function parseResearchRun(raw: unknown): ResearchRun | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const startedAt = str(raw.started_at);
  if (!id || !startedAt) return null;
  const notes = str(raw.notes);
  return {
    id,
    date: startedAt.slice(0, 10),
    finished: typeof raw.finished_at === 'string' && raw.finished_at.length > 0,
    trigger: str(raw.trigger),
    model: str(raw.model),
    promptVersion: str(raw.prompt_version),
    grounded: raw.grounded === true,
    countriesAttempted: num(raw.countries_attempted),
    countriesSucceeded: num(raw.countries_succeeded),
    gate: parseGateCounts(notes),
    notes,
  };
}

/**
 * The most recent research run (not a seed or backfill) from a PostgREST
 * result, or null when the list holds none.
 */
export function latestResearchRun(rows: unknown): ResearchRun | null {
  if (!Array.isArray(rows)) return null;
  const runs = rows
    .map(parseResearchRun)
    .filter((r): r is ResearchRun => r !== null && r.trigger !== 'seed' && r.trigger !== 'backfill');
  if (runs.length === 0) return null;
  return runs.reduce((latest, run) => (run.date > latest.date ? run : latest));
}

// ---------------------------------------------------------------------------
// Per-bloc drift.

export interface BlocWeekShare {
  date: string;
  changed: number;
  /** changed / members, 0-1. */
  share: number;
}

export interface BlocDrift {
  code: string;
  name: string;
  members: number;
  weeks: BlocWeekShare[];
}

/**
 * For each bloc, the share of its members that changed on each run date,
 * in the blocs file's order. Weeks come from computeWeeklyChanges so the
 * grid's columns match the other charts exactly.
 */
export function computeBlocDrift(
  weeks: WeekChanges[],
  blocs: BlocsData | null | undefined
): BlocDrift[] {
  if (!blocs) return [];
  const changedByDate = new Map(weeks.map(w => [w.date, new Set(w.countries)]));
  const result: BlocDrift[] = [];
  for (const [code, bloc] of Object.entries(blocs)) {
    if (!bloc || !Array.isArray(bloc.members) || bloc.members.length === 0) continue;
    const members = bloc.members.length;
    result.push({
      code,
      name: bloc.name || code,
      members,
      weeks: weeks.map(w => {
        const changedSet = changedByDate.get(w.date)!;
        const changed = bloc.members.filter(m => changedSet.has(m)).length;
        return { date: w.date, changed, share: changed / members };
      }),
    });
  }
  return result;
}

/** 'regulationStatus' -> 'Regulation Status'. */
export function dimensionLabel(key: DimensionKey): string {
  return ATTRIBUTE_LABELS[key];
}

/** 'regulation_status' (drift.json key) -> 'Regulation Status'; unknown keys pass through. */
export function snakeDimensionLabel(key: string): string {
  const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return (ATTRIBUTE_LABELS as Record<string, string>)[camel] ?? key;
}
