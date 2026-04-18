import { getState, setState, on } from '../state/store.js';
import { renderComparisonPanel, clearComparisonPanel, renderAddBar } from './panel.js';
import { markComparisonCountries } from '../map/renderer.js';
import { comparisonColor } from './colors.js';

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
  return comparisonColor(getColorIndex(name));
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

  // Tracks whether the comparison panel is already visible, so we only
  // auto-scroll on the first transition from hidden → shown (avoids
  // scroll-on-every-chip-change once the user is in compare mode).
  let wasVisible = false;

  on('comparisonCountries', (names) => {
    syncColorSlots(names);
    markComparisonCountries(names);
    if (countEl) countEl.textContent = String(names.length);

    // Open the comparison panel as soon as the user adds the first
     // country. Without this the "+ Compare" button feels like a
    // no-op (panel only appears after a second add). At 1 country
    // the panel shows the chip + search so the user understands
    // they are in compare mode; radar + details stay hidden until
    // there's something to actually compare.
    if (names.length >= 1) {
      if (panelEl) panelEl.hidden = false;
      if (countryPanelEl) countryPanelEl.style.display = 'none';
      renderComparisonPanel(names);

      // On mobile, the comparison panel sits below the map — scroll
      // it into view the first time it opens so the user doesn't
      // have to hunt for it.
      if (!wasVisible && panelEl && window.matchMedia('(max-width: 768px)').matches) {
        requestAnimationFrame(() => {
          panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      wasVisible = true;
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
      wasVisible = false;
    }
  });

  // When comparison is active (even with just 1 country), refresh the
  // add-bar whenever the user clicks a new country on the map so the
  // "+ Add [country]" quick-add button follows the click.
  on('selectedCountry', () => {
    if (getState().comparisonCountries.length >= 1) {
      renderAddBar();
    }
  });
}
