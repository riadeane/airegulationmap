// The map as a table (#139). The choropleth is one role="img" SVG, so
// keyboard and screen-reader users could reach countries only through
// search and arrow-stepping, never "look" at the map. This section lists
// the countries in the current view with the score the map is painting and
// its confidence. It is always in the accessibility tree; visually it is
// hidden until focus enters it, when it opens as a card over the map (the
// skip-link pattern), so it never competes with the choropleth for sighted
// mouse users.
//
// Keyboard: the two column headers sort (country, score). The country
// buttons use a roving tabindex, so the whole table is three Tab stops;
// Up/Down, Home/End and Page Up/Down move between rows, Enter or Space
// selects the country. Esc leaves the table (focus goes to the search box).

import { getState, on } from '../state/store';
import { selectCountry } from '../state/interactions';
import { visibleCountrySet, confidenceAtDate } from '../state/selectors';
import { ATTRIBUTES, INSUFFICIENT_EVIDENCE_LABEL, isInsufficient } from '../constants';
import { displayedEntry } from './renderer';

type SortKey = 'name' | 'score';

let sortKey: SortKey = 'name';
let sortDesc = false;
// The row that holds the roving tabindex, by country name.
let activeName: string | null = null;
let pending = false;

const collator = new Intl.Collator('en');

function formatScore(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function rows(): { name: string; score: number | null; insufficient: boolean; confidence: string | null }[] {
  const { currentAttribute } = getState();
  const list = [...visibleCountrySet()].map(name => {
    const { entry } = displayedEntry(name);
    const value = entry?.[currentAttribute];
    return {
      name,
      score: value != null && Number.isFinite(value) ? value : null,
      insufficient: isInsufficient(value),
      confidence: confidenceAtDate(name),
    };
  });
  list.sort((a, b) => {
    if (sortKey === 'score') {
      const diff = (a.score ?? -1) - (b.score ?? -1);
      if (diff !== 0) return sortDesc ? -diff : diff;
    }
    const byName = collator.compare(a.name, b.name);
    return sortKey === 'name' && sortDesc ? -byName : byName;
  });
  return list;
}

function sortButton(key: SortKey, text: string): HTMLTableCellElement {
  const th = document.createElement('th');
  th.scope = 'col';
  const active = sortKey === key;
  th.setAttribute('aria-sort', active ? (sortDesc ? 'descending' : 'ascending') : 'none');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'country-table-sort';
  btn.dataset.sort = key;
  btn.textContent = text;
  const mark = document.createElement('span');
  mark.className = 'country-table-sort-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = active ? (sortDesc ? '↓' : '↑') : '';
  btn.appendChild(mark);
  th.appendChild(btn);
  return th;
}

function render(): void {
  const section = document.getElementById('country-table');
  if (!section) return;
  const { currentAttribute, selectedCountry, mainView, timelineDate } = getState();
  section.hidden = mainView !== 'map';

  // Keep keyboard focus on the same control across a re-render.
  const focused = section.contains(document.activeElement)
    ? (document.activeElement as HTMLElement)
    : null;
  const focusedSort = focused?.dataset.sort ?? null;
  const focusedCountry = focused?.dataset.country ?? null;

  const meaning = ATTRIBUTES[currentAttribute];
  const data = rows();
  if (!activeName || !data.some(r => r.name === activeName)) {
    activeName = data.some(r => r.name === selectedCountry) ? selectedCountry : data[0]?.name ?? null;
  }

  const title = document.createElement('h2');
  title.id = 'country-table-title';
  title.className = 'country-table-title';
  title.textContent = 'Countries on the map';

  const note = document.createElement('p');
  note.className = 'country-table-note';
  note.textContent = `${data.length} ${data.length === 1 ? 'country' : 'countries'} in the current view, `
    + `${meaning.label} from 1 (${meaning.low}) to 5 (${meaning.high})`
    + (timelineDate ? `, as of ${timelineDate}` : '')
    + `. ${meaning.notClaim} Select a country to open its entry.`;

  const table = document.createElement('table');
  table.className = 'country-table-grid';
  const thead = document.createElement('thead');
  const head = document.createElement('tr');
  const conf = document.createElement('th');
  conf.scope = 'col';
  conf.textContent = 'Confidence';
  head.append(sortButton('name', 'Country'), sortButton('score', meaning.label), conf);
  thead.appendChild(head);

  const tbody = document.createElement('tbody');
  for (const row of data) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'country-table-pick';
    pick.dataset.country = row.name;
    pick.textContent = row.name;
    pick.tabIndex = row.name === activeName ? 0 : -1;
    if (row.name === selectedCountry) pick.setAttribute('aria-current', 'true');
    th.appendChild(pick);
    const score = document.createElement('td');
    score.className = 'num';
    // A null value is insufficient evidence, not "no data".
    score.textContent = row.score != null
      ? formatScore(row.score)
      : row.insufficient ? INSUFFICIENT_EVIDENCE_LABEL : 'No data';
    const confidence = document.createElement('td');
    confidence.textContent = row.confidence
      ? row.confidence[0].toUpperCase() + row.confidence.slice(1)
      : '';
    tr.append(th, score, confidence);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  section.replaceChildren(title, note, table);

  if (focusedSort) section.querySelector<HTMLElement>(`[data-sort="${focusedSort}"]`)?.focus({ preventScroll: true });
  else if (focusedCountry) {
    const again = [...section.querySelectorAll<HTMLElement>('.country-table-pick')]
      .find(b => b.dataset.country === focusedCountry)
      ?? section.querySelector<HTMLElement>('.country-table-pick[tabindex="0"]');
    again?.focus({ preventScroll: true });
  }
}

function scheduleRender(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    render();
  });
}

function moveTo(section: HTMLElement, btn: HTMLElement): void {
  section.querySelectorAll<HTMLElement>('.country-table-pick').forEach(b => { b.tabIndex = -1; });
  btn.tabIndex = 0;
  activeName = btn.dataset.country ?? null;
  btn.focus();
  btn.scrollIntoView({ block: 'nearest' });
}

export function initCountryTable(): void {
  const section = document.getElementById('country-table');
  if (!section) return;

  section.addEventListener('click', (e) => {
    const target = e.target as Element;
    const sort = target.closest<HTMLElement>('[data-sort]');
    if (sort) {
      const key = sort.dataset.sort as SortKey;
      if (sortKey === key) sortDesc = !sortDesc;
      else { sortKey = key; sortDesc = key === 'score'; }
      render();
      return;
    }
    const pick = target.closest<HTMLElement>('.country-table-pick');
    if (pick?.dataset.country) {
      activeName = pick.dataset.country;
      selectCountry(pick.dataset.country);
    }
  });

  section.addEventListener('keydown', (e) => {
    const current = (e.target as Element).closest<HTMLElement>('.country-table-pick');
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('country-search')?.focus();
      return;
    }
    // Left/Right would step the selected country (search.ts); in the table
    // they mean nothing.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation();
      return;
    }
    if (!current) return;
    const buttons = [...section.querySelectorAll<HTMLElement>('.country-table-pick')];
    const i = buttons.indexOf(current);
    let next: number;
    switch (e.key) {
      case 'ArrowDown': next = Math.min(i + 1, buttons.length - 1); break;
      case 'ArrowUp': next = Math.max(i - 1, 0); break;
      case 'Home': next = 0; break;
      case 'End': next = buttons.length - 1; break;
      case 'PageDown': next = Math.min(i + 10, buttons.length - 1); break;
      case 'PageUp': next = Math.max(i - 10, 0); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    moveTo(section, buttons[next]);
  });

  for (const key of [
    'currentAttribute', 'scoreData', 'regulationData', 'selectedCountry', 'mainView',
    'filterMin', 'filterMax', 'selectedBloc', 'filterConfidence', 'filterOfficialOnly',
    'filterEvidence', 'subscores', 'timelineDate', 'history',
  ] as const) {
    on(key, scheduleRender);
  }
  render();
}
