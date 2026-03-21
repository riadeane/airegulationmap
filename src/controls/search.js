import { getState, setState } from '../state/store.js';
import { updateSearchHighlight } from '../map/index.js';

export function initSearch() {
  const searchInput = document.getElementById('country-search');
  const suggestions = document.getElementById('search-suggestions');

  searchInput.addEventListener('input', function () {
    const query = this.value.trim().toLowerCase();
    suggestions.replaceChildren();
    updateSearchHighlight(query);
    if (query.length < 2) return;

    const { sortedCountryNames } = getState();
    const matches = sortedCountryNames
      .filter(name => name.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(query);
        const bStarts = b.toLowerCase().startsWith(query);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      })
      .slice(0, 8);

    for (const name of matches) {
      const li = document.createElement('li');
      li.textContent = name;
      li.setAttribute('role', 'option');
      li.addEventListener('click', () => {
        searchInput.value = name;
        suggestions.replaceChildren();
        updateSearchHighlight('');
        setState({ selectedCountry: name });
      });
      suggestions.appendChild(li);
    }
  });

  // Close suggestions on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-container')) {
      suggestions.replaceChildren();
      updateSearchHighlight('');
      searchInput.value = '';
    }
  });

  // Keyboard navigation for search
  searchInput.addEventListener('keydown', function (e) {
    const items = suggestions.querySelectorAll('li');
    if (!items.length) return;
    const highlighted = suggestions.querySelector('li.highlighted');
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
      updateSearchHighlight('');
      return;
    } else {
      return;
    }
    items.forEach(li => li.classList.remove('highlighted'));
    items[idx].classList.add('highlighted');
  });
}

export function initKeyboardNav() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        document.getElementById('search-suggestions').replaceChildren();
        updateSearchHighlight('');
      }
      return;
    }

    if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      document.getElementById('country-search').focus();
      return;
    }

    if (e.key === 'Escape') {
      setState({ selectedCountry: null });
      document.getElementById('score-dropdown').classList.remove('open');
      document.getElementById('score-btn').classList.remove('active');
      document.getElementById('filter-popover').classList.remove('open');
      document.getElementById('filter-btn').classList.remove('active');
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
