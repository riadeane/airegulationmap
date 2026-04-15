import { getState, setState, on } from '../state/store.js';
import { renderComparisonPanel, clearComparisonPanel, renderAddBar } from './panel.js';
import { markComparisonCountries } from '../map/renderer.js';
import { COMPARISON_COLORS } from './colors.js';

export const MAX_COMPARISON = 4;

// Stable color-slot assignment so a country keeps its color for the
// lifetime of its presence in the comparison. Without this, removing
// a middle country reshuffles every other country's color (because
// callers were using the array index).
const colorSlots = new Map(); // countryName -> 0..MAX_COMPARISON-1

function syncColorSlots(names) {
  // Release slots for countries that left the list.
  for (const name of [...colorSlots.keys()]) {
    if (!names.includes(name)) colorSlots.delete(name);
  }
  // Assign slots to new countries, reusing the lowest free index.
  const used = new Set(colorSlots.values());
  for (const name of names) {
    if (colorSlots.has(name)) continue;
    for (let i = 0; i < MAX_COMPARISON; i++) {
      if (!used.has(i)) {
        colorSlots.set(name, i);
        used.add(i);
        break;
      }
    }
  }
}

export function getColorIndex(name) {
  return colorSlots.get(name) ?? 0;
}

export function getColorFor(name) {
  return COMPARISON_COLORS[getColorIndex(name)];
}

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
    syncColorSlots(names);
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
      // Re-render the single panel with the most relevant country:
      // prefer the one country still left in the comparison (if any),
      // otherwise fall back to whatever was selected before.
      const { selectedCountry } = getState();
      const target = names[0] || selectedCountry;
      if (target) {
        setState({ selectedCountry: target });
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
