// Interaction orchestrator - the single home for state transitions that carry
// an invariant. This is the frontend analogue of the backend's PipelineService:
// modules dispatch named intents instead of poking `setState` with rules baked
// in at the call site, so cross-cutting behaviour ("opening scatter closes
// comparison", "a comparison needs ≥2 countries", "Esc backs out one layer")
// lives in exactly one place.
//
// It depends only on the store, the constants, and the colour-slot leaf - never
// on a feature module - so it introduces no import cycles. Feature modules
// subscribe to the resulting store changes as usual.
//
// It is also the only module outside src/state/ that calls `setState`, even
// for writes that carry no rule today (tests/singleWriter.test.js enforces
// it): a rule added later then has one home, and no control can skip it.

import { getState, setState } from './store';
import type { AppState } from './store';
import { MAX_COMPARISON } from '../constants';
import type { MainView } from '../constants';
import { syncColorSlots } from '../comparison/colorSlots';

// -- selection ---------------------------------------------------------------

// Only dataset countries can be selected or compared. The map also draws
// territories the dataset has no row for (Greenland, W. Sahara, …); their
// tooltip says "No data", and selecting one produced an empty panel and
// ?compare= links that did not survive a reload.
function inDataset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(getState().scoreData, name);
}

export function selectCountry(name: string | null): void {
  if (name !== null && !inDataset(name)) return;
  setState({ selectedCountry: name });
}

/** Arrow-key navigation through the sorted country list, wrapping at the ends. */
export function stepCountry(delta: 1 | -1): void {
  const { sortedCountryNames, selectedCountry } = getState();
  if (sortedCountryNames.length === 0) return;
  const current = selectedCountry ? sortedCountryNames.indexOf(selectedCountry) : -1;
  const n = sortedCountryNames.length;
  // From no selection, ArrowRight starts at the first country, ArrowLeft at the last.
  const next = current === -1
    ? (delta === 1 ? 0 : n - 1)
    : (current + delta + n) % n;
  selectCountry(sortedCountryNames[next]);
}

// -- committed search ----------------------------------------------------------

/** Longest query the URL / results header will carry. */
export const MAX_SEARCH_QUERY = 100;

/**
 * Commit a full-text search: the results list replaces the empty panel and
 * the map stays dimmed to matches until the search is cleared. Deselects the
 * country so the list is actually visible - the selection is one Esc away.
 */
export function commitSearch(query: string): void {
  const q = query.trim().slice(0, MAX_SEARCH_QUERY);
  if (!q) return;
  setState({ searchQuery: q, selectedCountry: null });
}

export function clearSearch(): void {
  setState({ searchQuery: '' });
}

// -- dataset -------------------------------------------------------------------

/** What the loaders write: parsed data files, never view or selection state. */
export type DataPatch = Partial<Pick<AppState,
  'scoreData' | 'regulationData' | 'sortedCountryNames' | 'history' | 'blocsData'
  | 'subscores' | 'sourceMeta' | 'countryIso' | 'countryAliases'>>;

/**
 * The loaders' one write path: the boot files, the async ones as they land,
 * and Supabase hydration. A patch commits atomically, so hydrated scores,
 * text and names reach subscribers together.
 */
export function receiveData(patch: DataPatch): void {
  setState(patch);
}

// -- score dimension and timeline -------------------------------------------------

/** The attribute the map, legend and panel read (the score selector, a dimension row, a URL). */
export function selectAttribute(attr: AppState['currentAttribute']): void {
  setState({ currentAttribute: attr });
}

/** A history snapshot date (YYYY-MM-DD), or null for the latest data. */
export function setTimelineDate(date: string | null): void {
  setState({ timelineDate: date });
}

// -- filters ---------------------------------------------------------------------

/** Select a bloc by its blocs.json key, or clear it with null. Unknown keys are ignored. */
export function selectBloc(key: string | null): void {
  if (key !== null && !getState().blocsData?.[key]) return;
  setState({ selectedBloc: key });
}

export function setScoreRange(min: number, max: number): void {
  setState({ filterMin: min, filterMax: max });
}

/** null = every confidence level (no filter). */
export function setConfidenceFilter(levels: AppState['filterConfidence']): void {
  setState({ filterConfidence: levels });
}

export function setOfficialOnly(officialOnly: boolean): void {
  setState({ filterOfficialOnly: officialOnly });
}

export function setEvidenceFilter(facet: AppState['filterEvidence']): void {
  setState({ filterEvidence: facet });
}

/**
 * "Reset filters": the score range, bloc, confidence, official-source and
 * evidence filters back to their defaults in one write. The uncertainty hatch
 * is a display preference, not a filter, and stays as it is.
 */
export function resetFilters(): void {
  setState({
    filterMin: 1, filterMax: 5, selectedBloc: null,
    filterConfidence: null, filterOfficialOnly: false, filterEvidence: 'any',
  });
}

/** The low-confidence hatch on the map (a per-browser display preference). */
export function setShowUncertainty(show: boolean): void {
  setState({ showUncertainty: show });
}

// -- scatter axes ------------------------------------------------------------------

/** The explorer's axes; they persist across open and close. */
export function setScatterAxes(x: AppState['scatterX'], y: AppState['scatterY']): void {
  setState({ scatterX: x, scatterY: y });
}

// -- comparison membership ---------------------------------------------------

// The single writer for the comparison set. Assigns colour slots *before*
// committing so every subscriber that reads a slot on this change sees a
// fully-assigned map (removing the old cross-module ordering dependency).
function commitComparison(names: readonly string[]): void {
  syncColorSlots(names);
  setState({ comparisonCountries: names });
}

export function addToComparison(name: string | null): void {
  if (!name || !inDataset(name)) return;
  const { comparisonCountries } = getState();
  if (comparisonCountries.includes(name)) return;
  if (comparisonCountries.length >= MAX_COMPARISON) return;
  commitComparison([...comparisonCountries, name]);
}

export function removeFromComparison(name: string): void {
  const { comparisonCountries } = getState();
  if (!comparisonCountries.includes(name)) return;
  commitComparison(comparisonCountries.filter(c => c !== name));
}

export function toggleComparison(name: string): void {
  const { comparisonCountries } = getState();
  if (comparisonCountries.includes(name)) removeFromComparison(name);
  else addToComparison(name);
}

export function clearComparison(): void {
  commitComparison([]);
  if (getState().mainView === 'comparison') showMap();
}

/**
 * Restore a comparison from a shared link: commit the set and open the full
 * view iff it's large enough. Used by URL / deep-link application.
 */
export function restoreComparison(names: readonly string[]): void {
  commitComparison(names);
  setMainView(names.length >= 2 ? 'comparison' : 'map');
}

/**
 * Start a fresh comparison from a ranked list - the selected country plus
 * a peer set, most similar first. Drops duplicates, keeps the first
 * MAX_COMPARISON (so the cap cuts the least similar), commits, and opens
 * the full view. The panel's "Compare with" chips dispatch this.
 */
export function startComparison(names: readonly string[]): void {
  restoreComparison([...new Set(names)].slice(0, MAX_COMPARISON));
}

// -- main-area view (the FSM's single writer) --------------------------------

/**
 * The only place `mainView` is written. Because it's a single field, setting
 * one view implicitly leaves the others - no explicit "close the other overlay"
 * dance. Guards the one real invariant: the comparison view needs ≥2 countries.
 *
 * The scatter plots the latest scores and hides the timeline, so entering it
 * returns the timeline to "Latest" (#142): the panel beside it would
 * otherwise keep showing a past date's scores next to latest-data dots.
 */
export function setMainView(view: MainView): void {
  if (view === 'comparison' && getState().comparisonCountries.length < 2) return;
  if (view === 'scatter') setState({ timelineDate: null, mainView: view });
  else setState({ mainView: view });
}

export function showMap(): void {
  setMainView('map');
}

export function openScatter(): void {
  setMainView('scatter');
}

export function toggleScatter(): void {
  setMainView(getState().mainView === 'scatter' ? 'map' : 'scatter');
}

export function openComparison(): void {
  setMainView('comparison');
}

/**
 * Escape's outermost layer: if an overlay owns the main area, back out to the
 * map and report that we consumed the key. Returns false when already on the
 * map, so the caller can handle the inner layers (dropdowns, deselect).
 */
export function escapeMainView(): boolean {
  if (getState().mainView !== 'map') {
    showMap();
    return true;
  }
  return false;
}
