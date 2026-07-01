import { getState } from '../state/store';
import { ATTRIBUTE_LABELS } from '../constants';
import type { DimensionKey } from '../constants';
import { matchCountryNames } from '../data/countryMatch';
import { cleanRegulationText } from '../panel/sections';
import { renderRadar } from './radar';
import { addToComparison, removeFromComparison, getColorFor, MAX_COMPARISON } from './index';

const DETAIL_DIMENSIONS: DimensionKey[] = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

// Build a search-as-you-type input for adding countries to the
// comparison. Much faster than hunting for a country on the map.
// Clicking a country on the map still works; that path hands the
// most recent click to the "quick add" button alongside the search.
// `listId` must be unique per instance — the full-view add-bar and the
// staging strip both mount one, and duplicate ids break aria-controls.
export function buildSearchInput(atCap: boolean, listId = 'comp-search-suggestions'): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'comp-search';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'comp-search-input';
  input.placeholder = atCap
    ? `Max ${MAX_COMPARISON} reached — remove one first`
    : 'Add a country to compare…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Search country to add to comparison');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.disabled = atCap;

  const list = document.createElement('ul');
  list.id = listId;
  list.className = 'comp-search-suggestions';
  list.setAttribute('role', 'listbox');

  function close() {
    list.replaceChildren();
    list.classList.remove('open');
  }

  function commit(name: string): void {
    addToComparison(name);
    input.value = '';
    close();
    input.focus();
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    list.replaceChildren();
    if (q.length < 1) { close(); return; }

    const { sortedCountryNames, comparisonCountries } = getState();
    const matches = matchCountryNames(sortedCountryNames, q, {
      limit: 6,
      exclude: new Set(comparisonCountries),
    });

    if (matches.length === 0) { close(); return; }

    for (const name of matches) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = name;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); commit(name); });
      list.appendChild(li);
    }
    list.classList.add('open');
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('li'));
    const active = list.querySelector<HTMLLIElement>('li.active');
    let idx = active ? items.indexOf(active) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!items.length) return;
      idx = Math.min(idx + 1, items.length - 1);
      items.forEach(li => li.classList.remove('active'));
      items[idx].classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      idx = Math.max(idx - 1, 0);
      items.forEach(li => li.classList.remove('active'));
      items[idx].classList.add('active');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = active || items[0];
      if (target) commit(target.textContent!);
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  wrap.append(input, list);
  return wrap;
}

export function renderAddBar(): void {
  const bar = document.getElementById('comparison-add-bar');
  if (!bar) return;
  bar.replaceChildren();

  const { selectedCountry, comparisonCountries } = getState();
  const atCap = comparisonCountries.length >= MAX_COMPARISON;

  // Primary affordance: a searchable input. Works regardless of map state.
  bar.appendChild(buildSearchInput(atCap));

  // Secondary affordance: if the user clicked a country on the map and
  // it's not already in the comparison, offer a one-click add tied to
  // that specific country. This preserves the old flow without burying
  // the faster search path.
  if (selectedCountry && !comparisonCountries.includes(selectedCountry) && !atCap) {
    const quick = document.createElement('button');
    quick.type = 'button';
    quick.className = 'comp-add-btn comp-add-quick';
    quick.textContent = `+ Add ${selectedCountry}`;
    quick.title = 'Quick add the country you just clicked';
    quick.addEventListener('click', () => addToComparison(selectedCountry));
    bar.appendChild(quick);
  }
}

function buildChip(name: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'comp-chip';
  chip.style.setProperty('--chip-color', getColorFor(name));

  const label = document.createElement('span');
  label.className = 'comp-chip-label';
  label.textContent = name;
  chip.appendChild(label);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'comp-chip-remove';
  btn.setAttribute('aria-label', `Remove ${name} from comparison`);
  btn.textContent = '×';
  btn.addEventListener('click', () => removeFromComparison(name));
  chip.appendChild(btn);
  return chip;
}

function renderChips(names: readonly string[]): void {
  const container = document.getElementById('comparison-chips')!;
  container.replaceChildren();
  names.forEach(name => container.appendChild(buildChip(name)));
}

// The comparison set — a pinned footer in the country panel listing the
// staged countries. The "View comparison" button (enabled at 2+) opens
// the full view.
export function renderTray(names: readonly string[]): void {
  const chips = document.getElementById('tray-chips')!;
  const btn = document.getElementById('tray-view-btn') as HTMLButtonElement;
  chips.replaceChildren();
  names.forEach(name => chips.appendChild(buildChip(name)));

  // Add-a-country search, mounted once in the staging strip so the set can
  // be built without hunting the map for the 2nd–4th country. Kept in
  // sync with the cap; recreating it would drop focus mid-type.
  const addSlot = document.getElementById('tray-add');
  if (addSlot) {
    const atCap = names.length >= MAX_COMPARISON;
    let input = addSlot.querySelector<HTMLInputElement>('.comp-search-input');
    if (!input) {
      addSlot.appendChild(buildSearchInput(atCap, 'strip-comp-search-suggestions'));
      input = addSlot.querySelector<HTMLInputElement>('.comp-search-input');
    }
    if (input) {
      input.disabled = atCap;
      input.placeholder = atCap
        ? `Max ${MAX_COMPARISON} reached — remove one first`
        : 'Add a country to compare…';
    }
  }

  btn.disabled = names.length < 2;
  btn.textContent = names.length < 2
    ? 'Add one more to compare'
    : `View comparison (${names.length})`;
}

// One unified comparison table: dimensions down the side, countries
// across the top, score + description together in each cell. Replaces
// the old radar data table (numbers) AND the separate text grid, so
// every label appears exactly once.
function renderComparisonTable(names: readonly string[]): void {
  const container = document.getElementById('comparison-table')!;
  container.replaceChildren();
  // The flex columns fill the view for 2-3 countries; 4 may exceed the
  // width and scroll. min-width on cells keeps prose legible either way.
  container.style.setProperty('--col-count', String(names.length));

  const { scoreData, regulationData } = getState();

  const table = document.createElement('table');
  table.className = 'comparison-table';
  table.setAttribute('aria-label', 'Country comparison across scoring dimensions');

  // Header: blank corner + colored country names.
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th')); // corner
  names.forEach(name => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.className = 'ct-country';
    th.style.color = getColorFor(name);
    th.textContent = name;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  const fmtScore = (v: number | null | undefined) =>
    v == null ? '—' : (Number.isInteger(v) ? String(v) : v.toFixed(2));

  // Maturity index — score only (it is derived; no description).
  const avgRow = document.createElement('tr');
  avgRow.className = 'ct-row ct-row-maturity';
  const avgLabel = document.createElement('th');
  avgLabel.scope = 'row';
  avgLabel.className = 'ct-label';
  avgLabel.textContent = 'Maturity index';
  avgRow.appendChild(avgLabel);
  names.forEach(name => {
    const td = document.createElement('td');
    const score = document.createElement('span');
    score.className = 'ct-score ct-score-lg';
    score.textContent = fmtScore(scoreData[name]?.averageScore);
    td.appendChild(score);
    avgRow.appendChild(td);
  });
  tbody.appendChild(avgRow);

  // The five scored dimensions — score badge + description per country.
  DETAIL_DIMENSIONS.forEach(dim => {
    const row = document.createElement('tr');
    row.className = 'ct-row';
    const label = document.createElement('th');
    label.scope = 'row';
    label.className = 'ct-label';
    label.textContent = ATTRIBUTE_LABELS[dim];
    row.appendChild(label);

    names.forEach(name => {
      const td = document.createElement('td');
      const score = document.createElement('span');
      score.className = 'ct-score';
      score.textContent = fmtScore(scoreData[name]?.[dim]);
      td.appendChild(score);

      const text = regulationData[name] ? cleanRegulationText(regulationData[name][dim]) : null;
      const p = document.createElement('p');
      p.className = 'ct-text';
      if (text) {
        p.textContent = text;
      } else {
        p.textContent = 'No data';
        p.classList.add('empty');
      }
      td.appendChild(p);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });

  // Key legislation — text only, useful side-by-side.
  const lawsRow = document.createElement('tr');
  lawsRow.className = 'ct-row';
  const lawsLabel = document.createElement('th');
  lawsLabel.scope = 'row';
  lawsLabel.className = 'ct-label';
  lawsLabel.textContent = 'Key Legislation';
  lawsRow.appendChild(lawsLabel);
  names.forEach(name => {
    const td = document.createElement('td');
    const text = regulationData[name] ? cleanRegulationText(regulationData[name].specificLaws) : null;
    const p = document.createElement('p');
    p.className = 'ct-text';
    if (text) {
      p.textContent = text;
    } else {
      p.textContent = '—';
      p.classList.add('empty');
    }
    td.appendChild(p);
    lawsRow.appendChild(td);
  });
  tbody.appendChild(lawsRow);

  table.appendChild(tbody);
  container.appendChild(table);
}

export function renderComparisonPanel(names: readonly string[]): void {
  renderAddBar();
  renderChips(names);

  const radarEl = document.getElementById('radar-chart')!;
  const tableEl = document.getElementById('comparison-table')!;

  // Radar + table need two or more countries to be meaningful. At
  // exactly one country, clear them and show a friendly prompt so the
  // user knows what to do next.
  if (names.length >= 2) {
    radarEl.classList.remove('is-empty');
    tableEl.classList.remove('is-empty');
    renderRadar(radarEl, names, getState().scoreData);
    renderComparisonTable(names);
  } else {
    radarEl.replaceChildren();
    radarEl.classList.add('is-empty');
    const prompt = document.createElement('p');
    prompt.className = 'comp-empty-prompt';
    prompt.textContent = names.length === 1
      ? `Add another country to compare with ${names[0]}.`
      : 'Add countries to compare.';
    radarEl.appendChild(prompt);

    tableEl.replaceChildren();
    tableEl.classList.add('is-empty');
  }
}

export function clearComparisonPanel(): void {
  const addBar = document.getElementById('comparison-add-bar');
  const chips = document.getElementById('comparison-chips');
  const radar = document.getElementById('radar-chart');
  const table = document.getElementById('comparison-table');
  if (addBar) addBar.replaceChildren();
  if (chips) chips.replaceChildren();
  if (radar) radar.replaceChildren();
  if (table) table.replaceChildren();
}
