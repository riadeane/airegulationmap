// Derived state — computed views over the store, memoized so a derivation
// isn't rebuilt on every render. This is the read-side counterpart to the
// interactions orchestrator (the write side): modules ask a selector for a
// derived value instead of recomputing it inline (which the panel used to do
// for the maturity ranking on every single country selection).
//
// Memoization keys on the source object's reference. The score data is
// replaced wholesale on load and never mutated in place (the store enforces
// this), so reference identity is a sound cache key.

import { getState } from './store';
import type { ConfidenceLevel } from './store';
import type { ScoreData, RegulationData } from '../data/loader';
import type { BlocsData } from '../data/blocs';
import type { HistoryData, HistorySnapshot } from '../data/history';
import { buildScoresAtDate } from '../data/history';
import { classifySources } from '../data/sources';
import type { AttributeKey } from '../constants';

export interface RankResult {
  rank: number;
  total: number;
}

let rankCache: { data: ScoreData; ranks: Map<string, number>; total: number } | null = null;

function rankTable(data: ScoreData) {
  if (rankCache && rankCache.data === data) return rankCache;

  const values = Object.values(data)
    .map(d => d.averageScore)
    .filter((v): v is number => v != null);
  // Descending sort; a value's rank is the position of its first occurrence,
  // so ties share a rank (equivalent to "strictly-greater count + 1").
  const sortedDesc = [...values].sort((a, b) => b - a);
  const rankByValue = new Map<number, number>();
  sortedDesc.forEach((v, i) => { if (!rankByValue.has(v)) rankByValue.set(v, i + 1); });

  const ranks = new Map<string, number>();
  for (const [name, entry] of Object.entries(data)) {
    if (entry.averageScore != null) ranks.set(name, rankByValue.get(entry.averageScore)!);
  }

  rankCache = { data, ranks, total: values.length };
  return rankCache;
}

/** Maturity-index rank of a country among those with a composite score (ties
 *  share a rank), or null when the country has no score. */
export function maturityRank(country: string): RankResult | null {
  const table = rankTable(getState().scoreData);
  const rank = table.ranks.get(country);
  return rank == null ? null : { rank, total: table.total };
}

// ---------------------------------------------------------------------------
// Visibility — the single definition of "which countries pass the active
// filters". Three surfaces used to duplicate this predicate (map opacity,
// scatter dimming, export scope) and drifted: the export forgot the bloc
// filter entirely. They all read it from here now.

let blocSetCache: {
  blocsData: BlocsData | null;
  selectedBloc: string | null;
  set: ReadonlySet<string> | null;
} | null = null;

function blocMemberSet(): ReadonlySet<string> | null {
  const { blocsData, selectedBloc } = getState();
  if (blocSetCache && blocSetCache.blocsData === blocsData && blocSetCache.selectedBloc === selectedBloc) {
    return blocSetCache.set;
  }
  const set = selectedBloc && blocsData?.[selectedBloc]
    ? new Set(blocsData[selectedBloc].members)
    : null;
  blocSetCache = { blocsData, selectedBloc, set };
  return set;
}

// Countries citing at least one official source — derived once per data
// load (classifySources over ~196 rows), reused by the official-only filter.
let officialCache: { regulationData: RegulationData; set: ReadonlySet<string> } | null = null;

export function officialSourceCountries(): ReadonlySet<string> {
  const { regulationData } = getState();
  if (officialCache && officialCache.regulationData === regulationData) return officialCache.set;
  const set = new Set<string>();
  for (const [name, entry] of Object.entries(regulationData)) {
    if (classifySources(entry.sources).some(s => s.kind === 'official')) set.add(name);
  }
  officialCache = { regulationData, set };
  return set;
}

function confidenceOf(country: string): ConfidenceLevel | null {
  const raw = getState().regulationData[country]?.confidence;
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return v === 'high' || v === 'medium' || v === 'low' ? v : null;
}

/**
 * Score-INDEPENDENT country filters: bloc membership, confidence level,
 * official-sources-only. Split from visibleCountrySet() because the map
 * filters historical snapshots during timeline playback — its score-range
 * check runs against the snapshot, not live data, so only this half is
 * shareable there.
 */
export function passesCountryFilters(country: string): boolean {
  const blocSet = blocMemberSet();
  if (blocSet && !blocSet.has(country)) return false;

  const { filterConfidence, filterOfficialOnly } = getState();
  if (filterConfidence) {
    const level = confidenceOf(country);
    // Unknown confidence can't satisfy a confidence filter.
    if (!level || !filterConfidence.includes(level)) return false;
  }
  if (filterOfficialOnly && !officialSourceCountries().has(country)) return false;
  return true;
}

let visibleCache: {
  scoreData: ScoreData;
  regulationData: RegulationData;
  attr: AttributeKey;
  min: number;
  max: number;
  blocSet: ReadonlySet<string> | null;
  confidence: readonly ConfidenceLevel[] | null;
  officialOnly: boolean;
  set: ReadonlySet<string>;
} | null = null;

/**
 * Countries visible under ALL active filters, evaluated on the LATEST data:
 * a score for the current attribute exists and is inside [filterMin,
 * filterMax], and every country-level filter passes. This is the export and
 * scatter scope; the map composes passesCountryFilters() with its own
 * per-datum range check instead (see above).
 */
export function visibleCountrySet(): ReadonlySet<string> {
  const {
    scoreData, regulationData, currentAttribute, filterMin, filterMax,
    filterConfidence, filterOfficialOnly,
  } = getState();
  const blocSet = blocMemberSet();
  if (
    visibleCache
    && visibleCache.scoreData === scoreData
    && visibleCache.regulationData === regulationData
    && visibleCache.attr === currentAttribute
    && visibleCache.min === filterMin
    && visibleCache.max === filterMax
    && visibleCache.blocSet === blocSet
    && visibleCache.confidence === filterConfidence
    && visibleCache.officialOnly === filterOfficialOnly
  ) {
    return visibleCache.set;
  }

  const set = new Set<string>();
  for (const [name, entry] of Object.entries(scoreData)) {
    const score = entry[currentAttribute];
    if (score == null || score < filterMin || score > filterMax) continue;
    if (!passesCountryFilters(name)) continue;
    set.add(name);
  }
  visibleCache = {
    scoreData, regulationData, attr: currentAttribute, min: filterMin, max: filterMax,
    blocSet, confidence: filterConfidence, officialOnly: filterOfficialOnly, set,
  };
  return set;
}

// ---------------------------------------------------------------------------
// Timeline — historical scores for the scrubbed date.

let atDateCache: {
  history: HistoryData;
  date: string;
  result: Record<string, HistorySnapshot>;
} | null = null;

/**
 * Score snapshots as of the scrubbed timeline date, or null when the
 * timeline is at "Latest" (or history hasn't loaded). Lets the panel render
 * the same vintage the map is showing instead of silently disagreeing.
 */
export function scoresAtDate(): Record<string, HistorySnapshot> | null {
  const { history, timelineDate } = getState();
  if (!history || !timelineDate) return null;
  if (atDateCache && atDateCache.history === history && atDateCache.date === timelineDate) {
    return atDateCache.result;
  }
  const result = buildScoresAtDate(history, timelineDate);
  atDateCache = { history, date: timelineDate, result };
  return result;
}
