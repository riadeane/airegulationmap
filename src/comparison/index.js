import { getState, setState, on } from '../state/store.js';
import { renderComparisonPanel, clearComparisonPanel, renderAddBar } from './panel.js';
import { markComparisonCountries } from '../map/renderer.js';

export const MAX_COMPARISON = 4;

export function addToComparison(name) {
  const { comparisonCountries } = getState();
  if (!name) return;
  if (comparisonCountries.includes(name)) return;
  if (comparisonCountries.length >= MAX_COMPARISON) return;
  setState({ comparisonCountries: [...comparisonCountries, name] });
}

export function removeFromComparison(name) {
  const { comparisonCountries } = getState();
  if (!comparisonCountries.includes(name)) return;
  setState({ comparisonCountries: comparisonCountries.filter(c => c !== name) });
}

export function toggleComparison(name) {
  const { comparisonCountries } = getState();
  if (comparisonCountries.includes(name)) {
    removeFromComparison(name);
  } else {
    addToComparison(name);
  }
}

export function clearComparison() {
  setState({ comparisonCountries: [] });
}

export function initComparison() {
  const panelEl = document.getElementById('comparison-panel');
  const countryPanelEl = document.getElementById('country-panel');
  const clearBtn = document.getElementById('clear-comparison-btn');
  const countEl = document.getElementById('comparison-count');

  if (clearBtn) clearBtn.addEventListener('click', clearComparison);

  on('comparisonCountries', (names) => {
    markComparisonCountries(names);
    if (countEl) countEl.textContent = String(names.length);

    if (names.length >= 2) {
      if (panelEl) panelEl.hidden = false;
      if (countryPanelEl) countryPanelEl.style.display = 'none';
      renderComparisonPanel(names);
    } else {
      if (panelEl) panelEl.hidden = true;
      if (countryPanelEl) countryPanelEl.style.display = '';
      clearComparisonPanel();
      // Re-trigger the single panel render so it picks up current selection.
      const { selectedCountry } = getState();
      if (selectedCountry) {
        setState({ selectedCountry });
      }
    }
  });

  // When comparison is active, update the add-bar whenever the user
  // clicks a new country on the map (normal click still fires this).
  // This is the mouse-only path for adding a 3rd/4th country.
  on('selectedCountry', () => {
    if (getState().comparisonCountries.length >= 2) {
      renderAddBar();
    }
  });
}
