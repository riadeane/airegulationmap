// Shareable URLs.
//
// Every meaningful view the user lands on encodes to a query string so
// a researcher can paste the URL into an email and the recipient sees
// the same country, score dimension, comparison set, timeline date,
// and theme.
//
// The store is the seam: state changes write to the URL via
// `history.replaceState`, and `popstate` writes back into the store.
// Defaults are omitted from the URL to keep links short.

import { getState, setState, on } from '../state/store';
import type { AppState } from '../state/store';
import {
  restoreComparison, selectCountry, openScatter,
  commitSearch, clearSearch, MAX_SEARCH_QUERY,
} from '../state/interactions';
import { SCORE_OPTIONS, MAX_COMPARISON } from '../constants';
import type { AttributeKey } from '../constants';

/** State parsed from the URL — only keys present in the query appear. */
export interface UrlState {
  country?: string;
  mode?: AttributeKey;
  compare?: string[];
  date?: string;
  theme?: 'light' | 'dark';
  bloc?: string;
  scatter?: { x: AttributeKey; y: AttributeKey };
  filterMin?: number;
  filterMax?: number;
  q?: string;
}

const VALID_MODES = new Set<string>(SCORE_OPTIONS.map(o => o.value));
const DEFAULT_MODE = 'averageScore';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Scatter axes exclude the derived average.
const VALID_SCATTER_DIMS = new Set<string>(
  SCORE_OPTIONS.map(o => o.value).filter(v => v !== DEFAULT_MODE)
);
const DEFAULT_SCATTER_X = 'enforcementLevel';
const DEFAULT_SCATTER_Y = 'regulationStatus';

// A score-range bound from the URL: a finite number in [1, 5], snapped to
// the filter sliders' quarter-point steps. Anything else is ignored.
function parseScoreBound(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 1 || v > 5) return undefined;
  return Math.round(v * 4) / 4;
}

function splitCompare(raw: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_COMPARISON) break;
  }
  return out;
}

// Parse the current window URL into a partial state object. Only keys
// actually present in the URL appear in the returned object — callers
// decide which defaults to apply.
export function parseUrl(search: string = window.location.search): UrlState {
  const params = new URLSearchParams(search);
  const out: UrlState = {};

  const country = params.get('country');
  if (country) out.country = decodeURIComponent(country);

  const mode = params.get('mode');
  if (mode && VALID_MODES.has(mode)) out.mode = mode as AttributeKey;

  const compare = params.get('compare');
  if (compare) {
    const list = splitCompare(decodeURIComponent(compare));
    if (list.length > 0) out.compare = list;
  }

  const date = params.get('date');
  if (date && ISO_DATE_RE.test(date)) out.date = date;

  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') out.theme = theme;

  // Validated against blocsData when applied — blocs.json may not have
  // loaded yet at parse time.
  const bloc = params.get('bloc');
  if (bloc && /^[A-Z0-9]{2,8}$/i.test(bloc)) out.bloc = bloc.toUpperCase();

  // Committed full-text search.
  const q = params.get('q');
  if (q && q.trim()) out.q = q.trim().slice(0, MAX_SEARCH_QUERY);

  // Score-range filter. An inverted pair (min > max) is dropped entirely
  // rather than guessing which bound the author meant.
  const min = parseScoreBound(params.get('min'));
  if (min !== undefined) out.filterMin = min;
  const max = parseScoreBound(params.get('max'));
  if (max !== undefined) out.filterMax = max;
  if (out.filterMin !== undefined && out.filterMax !== undefined && out.filterMin > out.filterMax) {
    delete out.filterMin;
    delete out.filterMax;
  }

  // scatter=1 → open with default axes; scatter=<x>,<y> → open with
  // those axes. Invalid axis names are ignored entirely.
  const scatter = params.get('scatter');
  if (scatter === '1') {
    out.scatter = { x: DEFAULT_SCATTER_X, y: DEFAULT_SCATTER_Y };
  } else if (scatter) {
    const [x, y] = scatter.split(',');
    if (VALID_SCATTER_DIMS.has(x) && VALID_SCATTER_DIMS.has(y)) {
      out.scatter = { x: x as AttributeKey, y: y as AttributeKey };
    }
  }

  return out;
}

// Build a query string from a state snapshot. Omits any key whose value
// matches the app default so the URL stays short. Pure (no window/document)
// so it is unit-testable; buildPermalink is the thin browser wrapper.
export function buildQueryString(s: Readonly<AppState>, theme: 'light' | 'dark' | null = null): string {
  const params = new URLSearchParams();

  // `compare` represents a COMMITTED comparison (the full view is
  // open). A staged-but-not-yet-viewed set is in-app ephemeral state,
  // so the URL keeps tracking the selected country until the user
  // actually opens the comparison.
  if (s.mainView === 'comparison' && s.comparisonCountries && s.comparisonCountries.length >= 2) {
    params.set('compare', s.comparisonCountries.join(','));
  } else if (s.selectedCountry) {
    params.set('country', s.selectedCountry);
  }

  if (s.currentAttribute && s.currentAttribute !== DEFAULT_MODE) {
    params.set('mode', s.currentAttribute);
  }

  if (s.timelineDate) {
    params.set('date', s.timelineDate);
  }

  if (s.selectedBloc) {
    params.set('bloc', s.selectedBloc);
  }

  if (s.filterMin !== 1) params.set('min', String(s.filterMin));
  if (s.filterMax !== 5) params.set('max', String(s.filterMax));

  if (s.searchQuery) params.set('q', s.searchQuery);

  if (s.mainView === 'scatter') {
    const isDefault = s.scatterX === DEFAULT_SCATTER_X && s.scatterY === DEFAULT_SCATTER_Y;
    params.set('scatter', isDefault ? '1' : `${s.scatterX},${s.scatterY}`);
  }

  if (theme) {
    params.set('theme', theme);
  }

  // URLSearchParams percent-encodes commas (%2C). We want readable
  // permalinks, so swap those back to literal commas in the final
  // string — browsers accept both on parse.
  return params.toString().replace(/%2C/g, ',');
}

// Absolute permalink for the current (or supplied) state.
//
// `omitTheme` drops the theme param: a citation permalink identifies the
// DATA VIEW, and light-vs-dark is a display preference that has no place
// in a scholarly footnote. Share links keep it (a recipient sees your
// theme); citations don't.
export function buildPermalink(
  stateSnapshot?: AppState,
  { omitTheme = false }: { omitTheme?: boolean } = {}
): string {
  const s = stateSnapshot || getState();
  const themeAttr = document.documentElement.getAttribute('data-theme');
  const theme = !omitTheme && (themeAttr === 'light' || themeAttr === 'dark') ? themeAttr : null;
  const qs = buildQueryString(s, theme);
  return window.location.origin + window.location.pathname + (qs ? '?' + qs : '');
}

function currentQueryString(): string {
  const link = buildPermalink();
  const i = link.indexOf('?');
  return i >= 0 ? link.slice(i) : '';
}

// Replace the URL without adding a history entry. Used for hovers and
// click-style navigation inside the app (Back should not undo a country
// selection or score-mode flip — too chatty).
function writeReplace(): void {
  const qs = currentQueryString();
  const next = window.location.pathname + qs;
  const current = window.location.pathname + window.location.search;
  if (next === current) return;
  window.history.replaceState(null, '', next);
}

function applyUrlState(urlState: UrlState, { initial = false }: { initial?: boolean } = {}): void {
  if (urlState.theme) {
    document.documentElement.setAttribute('data-theme', urlState.theme);
    try { localStorage.setItem('theme', urlState.theme); } catch (e) { /* storage blocked */ }
  }

  if (urlState.mode) setState({ currentAttribute: urlState.mode });
  else if (!initial) setState({ currentAttribute: DEFAULT_MODE });

  if (urlState.date !== undefined) setState({ timelineDate: urlState.date || null });
  else if (!initial) setState({ timelineDate: null });

  if (urlState.filterMin !== undefined || urlState.filterMax !== undefined) {
    setState({ filterMin: urlState.filterMin ?? 1, filterMax: urlState.filterMax ?? 5 });
  } else if (!initial) {
    setState({ filterMin: 1, filterMax: 5 });
  }

  // Committed search BEFORE country/compare: commitSearch deselects to show
  // the results list, so a country in the same URL wins by applying later.
  if (urlState.q) commitSearch(urlState.q);
  else if (!initial) clearSearch();

  const { blocsData } = getState();
  if (urlState.bloc && blocsData && blocsData[urlState.bloc]) {
    setState({ selectedBloc: urlState.bloc });
  } else if (!initial) {
    setState({ selectedBloc: null });
  }

  // Scatter axes are independent of which view is showing; apply them first.
  if (urlState.scatter) {
    setState({ scatterX: urlState.scatter.x, scatterY: urlState.scatter.y });
  }

  // The main view is a single slot, so precedence is explicit:
  // comparison (a shared compare link opens it directly) > scatter > map.
  const { scoreData } = getState();
  const validCountry = (name: string) => !!scoreData[name];
  const compareValid = (urlState.compare || []).filter(validCountry);

  if (compareValid.length >= 2) {
    restoreComparison(compareValid);
  } else {
    restoreComparison([]); // clears the set and returns to the map view
    if (urlState.country && validCountry(urlState.country)) {
      selectCountry(urlState.country);
    } else if (!initial) {
      selectCountry(null);
    }
    if (urlState.scatter) openScatter();
  }
}

// Subscribe to the relevant state slices and keep the URL in sync with
// the view the user is looking at.
export function initUrlSync(): void {
  on('selectedCountry', writeReplace);
  on('comparisonCountries', writeReplace);
  on('mainView', writeReplace);
  on('currentAttribute', writeReplace);
  on('timelineDate', writeReplace);
  on('selectedBloc', writeReplace);
  on('filterMin', writeReplace);
  on('filterMax', writeReplace);
  on('searchQuery', writeReplace);
  on('scatterX', writeReplace);
  on('scatterY', writeReplace);

  // Theme changes come from two sources: the toggle (sets data-theme
  // directly) and prefers-color-scheme. We watch the attribute.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === 'data-theme') {
        writeReplace();
        return;
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.addEventListener('popstate', () => {
    applyUrlState(parseUrl());
  });
}
