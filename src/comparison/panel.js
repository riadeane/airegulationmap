import { getState } from '../state/store.js';
import { ATTRIBUTE_LABELS } from '../constants.js';
import { cleanRegulationText } from '../panel/sections.js';
import { renderRadar } from './radar.js';
import { addToComparison, removeFromComparison, getColorFor, MAX_COMPARISON } from './index.js';

const DETAIL_DIMENSIONS = [
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
function buildSearchInput(atCap) {
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
  input.setAttribute('aria-controls', 'comp-search-suggestions');
  input.disabled = atCap;

  const list = document.createElement('ul');
  list.id = 'comp-search-suggestions';
  list.className = 'comp-search-suggestions';
  list.setAttribute('role', 'listbox');

  function close() {
    list.replaceChildren();
    list.classList.remove('open');
  }

  function commit(name) {
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
    const inSet = new Set(comparisonCountries);
    const matches = sortedCountryNames
      .filter(n => !inSet.has(n) && n.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q);
        const bStarts = b.toLowerCase().startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      })
      .slice(0, 6);

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
    const active = list.querySelector('li.active');
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
      if (target) commit(target.textContent);
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  wrap.append(input, list);
  return wrap;
}

export function renderAddBar() {
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

function renderChips(names) {
  const container = document.getElementById('comparison-chips');
  container.replaceChildren();
  names.forEach((name) => {
    const color = getColorFor(name);
    const chip = document.createElement('span');
    chip.className = 'comp-chip';
    chip.style.setProperty('--chip-color', color);

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

    container.appendChild(chip);
  });
}

function renderDetails(names) {
  const container = document.getElementById('comparison-details');
  container.replaceChildren();

  const { regulationData } = getState();

  // Header row with country names colored by their palette entry
  const header = document.createElement('div');
  header.className = 'comp-details-row comp-details-header';
  header.style.setProperty('--col-count', String(names.length));
  const corner = document.createElement('div');
  corner.className = 'comp-details-label';
  header.appendChild(corner);
  names.forEach((name) => {
    const cell = document.createElement('div');
    cell.className = 'comp-details-cell comp-details-country';
    cell.style.color = getColorFor(name);
    cell.dataset.country = name;
    cell.textContent = name;
    header.appendChild(cell);
  });
  container.appendChild(header);

  DETAIL_DIMENSIONS.forEach(dim => {
    const row = document.createElement('div');
    row.className = 'comp-details-row';
    row.style.setProperty('--col-count', String(names.length));

    const label = document.createElement('div');
    label.className = 'comp-details-label';
    label.textContent = ATTRIBUTE_LABELS[dim];
    row.appendChild(label);

    names.forEach(name => {
      const cell = document.createElement('div');
      cell.className = 'comp-details-cell';
      cell.dataset.country = name;
      cell.style.setProperty('--chip-color', getColorFor(name));
      const reg = regulationData[name];
      const text = reg ? cleanRegulationText(reg[dim]) : null;
      if (text) {
        cell.textContent = text;
      } else {
        cell.textContent = 'No data';
        cell.classList.add('empty');
      }
      row.appendChild(cell);
    });
    container.appendChild(row);
  });
}

export function renderComparisonPanel(names) {
  renderAddBar();
  renderChips(names);

  const radarEl = document.getElementById('radar-chart');
  const detailsEl = document.getElementById('comparison-details');

  // Radar + details grid need two or more countries to be meaningful.
  // At exactly one country, clear them and show a friendly prompt so
  // the user knows what to do next.
  if (names.length >= 2) {
    radarEl.classList.remove('is-empty');
    detailsEl.classList.remove('is-empty');
    renderRadar(radarEl, names, getState().scoreData);
    renderDetails(names);
  } else {
    radarEl.replaceChildren();
    radarEl.classList.add('is-empty');
    const prompt = document.createElement('p');
    prompt.className = 'comp-empty-prompt';
    prompt.textContent = names.length === 1
      ? `Add another country to compare with ${names[0]}.`
      : 'Add countries to compare.';
    radarEl.appendChild(prompt);

    detailsEl.replaceChildren();
    detailsEl.classList.add('is-empty');
  }
}

export function clearComparisonPanel() {
  const addBar = document.getElementById('comparison-add-bar');
  const chips = document.getElementById('comparison-chips');
  const radar = document.getElementById('radar-chart');
  const details = document.getElementById('comparison-details');
  if (addBar) addBar.replaceChildren();
  if (chips) chips.replaceChildren();
  if (radar) radar.replaceChildren();
  if (details) details.replaceChildren();
}
