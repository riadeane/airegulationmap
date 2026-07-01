// The committed-search results list — what makes full-text search a real
// research surface instead of a transient dropdown. Lives in the panel
// aside (where the reading happens): a persistent match list with count,
// jump-to-matched-field on click, an exportable match set, and map dimming
// that survives browsing into countries and back.
//
// State contract: `searchQuery` (committed via the commitSearch intent) is
// the input; the match list itself is DERIVED and memoized module-locally —
// it never enters the store.

import { getState, on } from '../state/store';
import { selectCountry, clearSearch } from '../state/interactions';
import { updateSearchHighlight } from '../map/index';
import { buildSearchIndex, searchAllMatches, FIELD_LABELS } from '../data/searchIndex';
import type { IndexEntry, SearchMatch } from '../data/searchIndex';
import type { RegulationData } from '../data/loader';
import { snippetNode } from '../controls/snippet';
import { highlightPanelField } from './sections';
import { exportCountries } from '../controls/export';
import { matchCountryNames } from '../data/countryMatch';

interface ResultSet {
  nameMatches: string[];
  textMatches: SearchMatch[];
  /** Union of both, for map dimming and export. */
  countries: string[];
}

let indexCache: { regulationData: RegulationData; index: IndexEntry[] } | null = null;
let resultCache: { regulationData: RegulationData; query: string; results: ResultSet } | null = null;

function resultsFor(query: string): ResultSet {
  const { regulationData, sortedCountryNames } = getState();
  if (resultCache && resultCache.regulationData === regulationData && resultCache.query === query) {
    return resultCache.results;
  }
  if (!indexCache || indexCache.regulationData !== regulationData) {
    indexCache = { regulationData, index: buildSearchIndex(regulationData) };
  }
  const q = query.toLowerCase();
  const nameMatches = matchCountryNames(sortedCountryNames, q, { limit: sortedCountryNames.length });
  const textMatches = q.length >= 3
    ? searchAllMatches(indexCache.index, q).filter(m => !nameMatches.includes(m.country))
    : [];
  const countries = [...new Set([...nameMatches, ...textMatches.map(m => m.country)])];
  const results = { nameMatches, textMatches, countries };
  resultCache = { regulationData, query, results };
  return results;
}

/**
 * Re-assert the committed query's map dimming (used by the search box when
 * it releases its transient typing highlight). Returns false when there is
 * no committed search, so the caller can clear the highlight instead.
 */
export function applyCommittedDimming(): boolean {
  const { searchQuery } = getState();
  if (!searchQuery) return false;
  updateSearchHighlight(new Set(resultsFor(searchQuery).countries));
  return true;
}

function sectionLabel(text: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'results-section-label';
  div.textContent = text;
  return div;
}

function renderList(container: HTMLElement, query: string, results: ResultSet): void {
  container.replaceChildren();

  const header = document.createElement('div');
  header.className = 'results-header';

  const count = document.createElement('p');
  count.className = 'results-count';
  count.setAttribute('role', 'status');
  const n = results.countries.length;
  count.textContent = n === 0
    ? `No matches for “${query}”`
    : `${n} ${n === 1 ? 'country matches' : 'countries match'} “${query}”`;
  header.appendChild(count);

  const actions = document.createElement('div');
  actions.className = 'results-actions';
  if (n > 0) {
    for (const fmt of ['csv', 'json'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'results-action';
      btn.textContent = `Export ${fmt.toUpperCase()}`;
      btn.addEventListener('click', () => exportCountries(results.countries, fmt, 'search', `search “${query}”`));
      actions.appendChild(btn);
    }
  }
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'results-action results-clear';
  clearBtn.textContent = 'Clear search';
  clearBtn.addEventListener('click', clearSearch);
  actions.appendChild(clearBtn);
  header.appendChild(actions);
  container.appendChild(header);

  if (results.nameMatches.length > 0 && results.textMatches.length > 0) {
    container.appendChild(sectionLabel('Countries'));
  }
  for (const name of results.nameMatches) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'result-row result-row-country';
    row.textContent = name;
    row.addEventListener('click', () => selectCountry(name));
    container.appendChild(row);
  }

  if (results.textMatches.length > 0) {
    container.appendChild(sectionLabel('Mentions'));
  }
  for (const match of results.textMatches) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'result-row';

    const head = document.createElement('span');
    head.className = 'result-head';
    const country = document.createElement('span');
    country.className = 'result-country';
    country.textContent = match.country;
    const field = document.createElement('span');
    field.className = 'result-field';
    field.textContent = FIELD_LABELS[match.field] || match.field;
    head.append(country, field);

    row.append(head, snippetNode(match));
    row.addEventListener('click', () => {
      // selectCountry emits synchronously, so the panel DOM is fully
      // rendered when the call returns — the highlight lands on real nodes.
      selectCountry(match.country);
      highlightPanelField(match.field, getState().searchQuery);
    });
    container.appendChild(row);
  }
}

function renderBackBar(bar: HTMLElement, query: string, resultCount: number): void {
  bar.replaceChildren();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'search-back-btn';
  btn.textContent = `‹ Back to ${resultCount} ${resultCount === 1 ? 'result' : 'results'} for “${query}”`;
  btn.addEventListener('click', () => selectCountry(null));
  bar.appendChild(btn);
}

export function initSearchResults(): void {
  const container = document.getElementById('search-results');
  const backBar = document.getElementById('search-back-bar');
  if (!container || !backBar) return;

  const render = () => {
    const { searchQuery, selectedCountry } = getState();

    if (!searchQuery) {
      container.hidden = true;
      backBar.hidden = true;
      container.replaceChildren();
      backBar.replaceChildren();
      updateSearchHighlight(null);
      // Hand the empty slot back: the intro (if not yet consumed) or the
      // usual no-selection fallback — same rule clearPanel applies.
      if (!selectedCountry) {
        const intro = document.getElementById('panel-intro');
        if (intro) intro.hidden = false;
        const fallback = document.getElementById('no-selection-message');
        if (fallback) fallback.hidden = intro !== null;
      }
      return;
    }

    const results = resultsFor(searchQuery);
    // The committed query owns map dimming — it persists while a result is
    // open, so "which other countries mention this" never evaporates.
    updateSearchHighlight(new Set(results.countries));

    if (selectedCountry) {
      // Reading one result: list yields to the country panel, the back bar
      // keeps the result set one click away.
      container.hidden = true;
      renderBackBar(backBar, searchQuery, results.countries.length);
      backBar.hidden = false;
    } else {
      backBar.hidden = true;
      backBar.replaceChildren();
      renderList(container, searchQuery, results);
      container.hidden = false;
      // The intro / empty-state would stack under the results list.
      const intro = document.getElementById('panel-intro');
      if (intro) intro.hidden = true;
      const fallback = document.getElementById('no-selection-message');
      if (fallback) fallback.hidden = true;
    }
  };

  on('searchQuery', render);
  on('selectedCountry', render);
  // A fresh dataset (rare — e.g. hydration) invalidates the derived list.
  on('regulationData', () => { if (getState().searchQuery) render(); });
}
