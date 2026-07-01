// Interaction orchestrator — the single home for state transitions that carry
// an invariant. This is the frontend analogue of the backend's PipelineService:
// modules dispatch named intents instead of poking `setState` with rules baked
// in at the call site, so cross-cutting behaviour ("opening scatter closes
// comparison", "a comparison needs ≥2 countries", "Esc backs out one layer")
// lives in exactly one place.
//
// It depends only on the store, the constants, and the colour-slot leaf — never
// on a feature module — so it introduces no import cycles. Feature modules
// subscribe to the resulting store changes as usual.

import { getState, setState } from './store';
import { MAX_COMPARISON } from '../constants';
import type { MainView } from '../constants';
import { syncColorSlots } from '../comparison/colorSlots';

// -- selection ---------------------------------------------------------------

export function selectCountry(name: string | null): void {
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
 * country so the list is actually visible — the selection is one Esc away.
 */
export function commitSearch(query: string): void {
  const q = query.trim().slice(0, MAX_SEARCH_QUERY);
  if (!q) return;
  setState({ searchQuery: q, selectedCountry: null });
}

export function clearSearch(): void {
  setState({ searchQuery: '' });
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
  if (!name) return;
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

// -- main-area view (the FSM's single writer) --------------------------------

/**
 * The only place `mainView` is written. Because it's a single field, setting
 * one view implicitly leaves the others — no explicit "close the other overlay"
 * dance. Guards the one real invariant: the comparison view needs ≥2 countries.
 */
export function setMainView(view: MainView): void {
  if (view === 'comparison' && getState().comparisonCountries.length < 2) return;
  setState({ mainView: view });
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
