import { getState } from '../state/store';
import { selectCountry, stepCountry, escapeMainView } from '../state/interactions';
import { updateSearchHighlight } from '../map/index';
import { matchCountryNames } from '../data/countryMatch';
import { buildSearchIndex, searchRegulationText, FIELD_LABELS } from '../data/searchIndex';
import type { IndexEntry, SearchMatch } from '../data/searchIndex';

const COUNTRY_LIMIT = 4;
const TEXT_LIMIT = 6;

// Trailing debounce — typing filters the country list, scans the text
// index, AND walks every map path for highlight classes, so don't do
// it per keystroke.
function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let textIndex: IndexEntry[] | null = null;

function sectionLabel(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'search-section-label';
  li.setAttribute('role', 'presentation');
  li.setAttribute('aria-hidden', 'true');
  li.textContent = text;
  return li;
}

// Snippet with the matched term wrapped in <mark>, built from index
// offsets via textContent — no innerHTML with data-derived strings.
function snippetNode(match: SearchMatch): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'match-snippet';
  span.appendChild(document.createTextNode(match.snippet.slice(0, match.matchStart)));
  const mark = document.createElement('mark');
  mark.textContent = match.snippet.slice(match.matchStart, match.matchStart + match.matchLength);
  span.appendChild(mark);
  span.appendChild(document.createTextNode(match.snippet.slice(match.matchStart + match.matchLength)));
  return span;
}

export function initSearch(): void {
  const searchInput = document.getElementById('country-search') as HTMLInputElement;
  const suggestions = document.getElementById('search-suggestions')!;
  // The options list is role="listbox" with presentational section
  // labels, so screen readers don't announce result changes on their
  // own — and a no-results message inside it is invisible to AT. This
  // out-of-band polite region speaks the outcome instead.
  const statusRegion = document.getElementById('search-status');
  const announce = (msg: string) => { if (statusRegion) statusRegion.textContent = msg; };

  const pickSuggestion = (name: string) => {
    searchInput.value = name;
    suggestions.replaceChildren();
    announce('');
    updateSearchHighlight(null);
    selectCountry(name);
  };

  const updateSuggestions = (query: string) => {
    suggestions.replaceChildren();
    if (query.length < 2) {
      updateSearchHighlight(null);
      announce('');
      return;
    }

    const { sortedCountryNames } = getState();
    if (!textIndex) textIndex = buildSearchIndex(getState().regulationData);

    const countryMatches = matchCountryNames(sortedCountryNames, query, { limit: COUNTRY_LIMIT });
    const textMatches = query.length >= 3
      ? searchRegulationText(textIndex, query, TEXT_LIMIT + COUNTRY_LIMIT)
        // A country already listed by name doesn't need a second row.
        .filter(m => !countryMatches.includes(m.country))
        .slice(0, TEXT_LIMIT)
      : [];

    // Nothing matched: clear the highlight to null — NOT an empty set,
    // which would mark every country "dimmed" and fade the whole map to
    // 8% — and show an explicit empty state instead of a vanished box.
    if (countryMatches.length === 0 && textMatches.length === 0) {
      updateSearchHighlight(null);
      const empty = document.createElement('li');
      empty.className = 'search-empty';
      empty.setAttribute('role', 'presentation');
      empty.textContent = `No countries or policies match “${query}”`;
      suggestions.appendChild(empty);
      announce(`No countries or policies match ${query}`);
      return;
    }

    updateSearchHighlight(new Set([
      ...countryMatches,
      ...textMatches.map(m => m.country),
    ]));

    const total = countryMatches.length + textMatches.length;
    announce(`${total} ${total === 1 ? 'result' : 'results'} for ${query}`);

    if (countryMatches.length > 0 && textMatches.length > 0) {
      suggestions.appendChild(sectionLabel('Countries'));
    }
    for (const name of countryMatches) {
      const li = document.createElement('li');
      li.textContent = name;
      li.setAttribute('role', 'option');
      li.addEventListener('click', () => pickSuggestion(name));
      suggestions.appendChild(li);
    }

    if (textMatches.length > 0) {
      suggestions.appendChild(sectionLabel('Mentions'));
    }
    for (const match of textMatches) {
      const li = document.createElement('li');
      li.className = 'text-match';
      li.setAttribute('role', 'option');

      const country = document.createElement('span');
      country.className = 'match-country';
      country.textContent = match.country;

      const field = document.createElement('span');
      field.className = 'match-field';
      field.textContent = FIELD_LABELS[match.field] || match.field;

      const head = document.createElement('span');
      head.className = 'match-head';
      head.append(country, field);

      li.append(head, snippetNode(match));
      li.addEventListener('click', () => pickSuggestion(match.country));
      suggestions.appendChild(li);
    }
  };

  const debouncedUpdate = debounce(updateSuggestions, 120);
  searchInput.addEventListener('input', function () {
    debouncedUpdate(this.value.trim().toLowerCase());
  });

  // Close suggestions on outside click
  document.addEventListener('click', e => {
    if (!(e.target as Element).closest('#search-container')) {
      suggestions.replaceChildren();
      updateSearchHighlight(null);
      searchInput.value = '';
    }
  });

  // Keyboard navigation for search. Only real options participate —
  // section labels are presentational.
  searchInput.addEventListener('keydown', function (e) {
    const items = suggestions.querySelectorAll<HTMLLIElement>('li[role="option"]');
    if (!items.length) return;
    const highlighted = suggestions.querySelector<HTMLLIElement>('li.highlighted');
    let idx = highlighted ? Array.from(items).indexOf(highlighted) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
    } else if (e.key === 'Enter') {
      // Enter commits the highlighted option, or — when the user typed a
      // query and hit Enter without arrowing — the first (top) option.
      // Previously Enter with no highlight did nothing, so typing a full
      // country name and pressing Enter was a dead end.
      e.preventDefault();
      (highlighted ?? items[0]).click();
      return;
    } else if (e.key === 'Escape') {
      suggestions.replaceChildren();
      updateSearchHighlight(null);
      return;
    } else {
      return;
    }
    items.forEach(li => li.classList.remove('highlighted'));
    items[idx].classList.add('highlighted');
    items[idx].scrollIntoView({ block: 'nearest' });
  });
}

export function initKeyboardNav(): void {
  document.addEventListener('keydown', e => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        target.blur();
        document.getElementById('search-suggestions')!.replaceChildren();
        updateSearchHighlight(null);
      }
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      const dialog = document.getElementById('help-overlay') as HTMLDialogElement | null;
      if (dialog && !dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
      return;
    }

    if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      document.getElementById('country-search')!.focus();
      return;
    }

    if (e.key === 'Escape') {
      // Esc backs out one layer at a time: the cite popover owns its own Esc
      // (closes + restores focus), then an overlay view (scatter/comparison)
      // via the orchestrator, then selection/dropdowns on later presses.
      const citePopover = document.getElementById('cite-popover');
      if (citePopover && !citePopover.hidden) return;
      if (escapeMainView()) return;
      selectCountry(null);
      document.getElementById('score-dropdown')!.classList.remove('open');
      document.getElementById('score-btn')!.classList.remove('active');
      document.getElementById('filter-popover')!.classList.remove('open');
      document.getElementById('filter-btn')!.classList.remove('active');
      document.getElementById('export-popover')!.classList.remove('open');
      document.getElementById('export-btn')!.classList.remove('active');
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepCountry(e.key === 'ArrowRight' ? 1 : -1);
    }
  });
}
