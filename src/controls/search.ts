import { getState, setState } from '../state/store';
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

  const selectCountry = (name: string) => {
    searchInput.value = name;
    suggestions.replaceChildren();
    updateSearchHighlight(null);
    setState({ selectedCountry: name });
  };

  const updateSuggestions = (query: string) => {
    suggestions.replaceChildren();
    if (query.length < 2) {
      updateSearchHighlight(null);
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

    updateSearchHighlight(new Set([
      ...countryMatches,
      ...textMatches.map(m => m.country),
    ]));

    if (countryMatches.length > 0 && textMatches.length > 0) {
      suggestions.appendChild(sectionLabel('Countries'));
    }
    for (const name of countryMatches) {
      const li = document.createElement('li');
      li.textContent = name;
      li.setAttribute('role', 'option');
      li.addEventListener('click', () => selectCountry(name));
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
      li.addEventListener('click', () => selectCountry(match.country));
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
    } else if (e.key === 'Enter' && highlighted) {
      highlighted.click();
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
      // While the comparison panel is active, leave selectedCountry
      // alone so the add-bar keeps reflecting the last clicked country.
      if (getState().comparisonCountries.length < 2) {
        setState({ selectedCountry: null });
      }
      document.getElementById('score-dropdown')!.classList.remove('open');
      document.getElementById('score-btn')!.classList.remove('active');
      document.getElementById('filter-popover')!.classList.remove('open');
      document.getElementById('filter-btn')!.classList.remove('active');
      document.getElementById('export-popover')!.classList.remove('open');
      document.getElementById('export-btn')!.classList.remove('active');
      return;
    }

    const { sortedCountryNames, selectedCountry } = getState();
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sortedCountryNames.length > 0) {
      e.preventDefault();
      let idx = selectedCountry ? sortedCountryNames.indexOf(selectedCountry) : -1;
      if (e.key === 'ArrowRight') {
        idx = idx < sortedCountryNames.length - 1 ? idx + 1 : 0;
      } else {
        idx = idx > 0 ? idx - 1 : sortedCountryNames.length - 1;
      }
      setState({ selectedCountry: sortedCountryNames[idx] });
    }
  });
}
