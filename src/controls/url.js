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

import { getState, setState, on } from '../state/store.js';
import { SCORE_OPTIONS } from '../constants.js';
import { MAX_COMPARISON } from '../comparison/index.js';

const VALID_MODES = new Set(SCORE_OPTIONS.map(o => o.value));
const DEFAULT_MODE = 'averageScore';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function splitCompare(raw) {
  if (!raw) return [];
  const seen = new Set();
  const out = [];
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
export function parseUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  const out = {};

  const country = params.get('country');
  if (country) out.country = decodeURIComponent(country);

  const mode = params.get('mode');
  if (mode && VALID_MODES.has(mode)) out.mode = mode;

  const compare = params.get('compare');
  if (compare) {
    const list = splitCompare(decodeURIComponent(compare));
    if (list.length > 0) out.compare = list;
  }

  const date = params.get('date');
  if (date && ISO_DATE_RE.test(date)) out.date = date;

  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') out.theme = theme;

  return out;
}

// Build a query string from the current (or supplied) state. Omits any
// key whose value matches the app default so the URL stays short.
export function buildPermalink(stateSnapshot) {
  const s = stateSnapshot || getState();
  const params = new URLSearchParams();

  if (s.comparisonCountries && s.comparisonCountries.length > 0) {
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

  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light' || theme === 'dark') {
    params.set('theme', theme);
  }

  // URLSearchParams percent-encodes commas (%2C). We want readable
  // permalinks, so swap those back to literal commas in the final
  // string — browsers accept both on parse.
  const qs = params.toString().replace(/%2C/g, ',');
  const url = window.location.pathname + (qs ? '?' + qs : '');
  // Absolute URL for citations / sharing.
  return window.location.origin + url;
}

function currentQueryString() {
  const link = buildPermalink();
  const i = link.indexOf('?');
  return i >= 0 ? link.slice(i) : '';
}

// Replace the URL without adding a history entry. Used for hovers and
// click-style navigation inside the app (Back should not undo a country
// selection or score-mode flip — too chatty).
function writeReplace() {
  const qs = currentQueryString();
  const next = window.location.pathname + qs;
  const current = window.location.pathname + window.location.search;
  if (next === current) return;
  window.history.replaceState(null, '', next);
}

function applyUrlState(urlState, { initial = false } = {}) {
  if (urlState.theme) {
    document.documentElement.setAttribute('data-theme', urlState.theme);
    try { localStorage.setItem('theme', urlState.theme); } catch (e) { /* storage blocked */ }
  }

  if (urlState.mode) setState({ currentAttribute: urlState.mode });
  else if (!initial) setState({ currentAttribute: DEFAULT_MODE });

  if (urlState.date !== undefined) setState({ timelineDate: urlState.date || null });
  else if (!initial) setState({ timelineDate: null });

  // Comparison wins over country — the comparison panel takes the
  // right-hand slot either way.
  const { scoreData } = getState();
  const validCountry = (name) => !!scoreData[name];

  if (urlState.compare && urlState.compare.length > 0) {
    const valid = urlState.compare.filter(validCountry);
    setState({ comparisonCountries: valid });
    if (valid.length === 1) setState({ selectedCountry: valid[0] });
  } else {
    setState({ comparisonCountries: [] });
    if (urlState.country && validCountry(urlState.country)) {
      setState({ selectedCountry: urlState.country });
    } else if (!initial) {
      setState({ selectedCountry: null });
    }
  }
}

// Subscribe to the relevant state slices and keep the URL in sync with
// the view the user is looking at.
export function initUrlSync() {
  on('selectedCountry', writeReplace);
  on('comparisonCountries', writeReplace);
  on('currentAttribute', writeReplace);
  on('timelineDate', writeReplace);

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
