import { getState, setState, on } from '../state/store';
import { renderComparisonPanel, clearComparisonPanel, renderAddBar, renderTray } from './panel';
import { markComparisonCountries } from '../map/renderer';
import { comparisonColor } from './colors';

export const MAX_COMPARISON = 4;

export function openComparisonView(): void {
  if (getState().comparisonCountries.length >= 2) {
    setState({ comparisonViewOpen: true });
  }
}

export function closeComparisonView(): void {
  setState({ comparisonViewOpen: false });
}

// Stable color-slot assignment so a country keeps its color for the
// lifetime of its presence in the comparison. Without this, removing
// a middle country reshuffles every other country's color (because
// callers were using the array index).
const colorSlots = new Map<string, number>(); // countryName -> 0..MAX_COMPARISON-1

function syncColorSlots(names: string[]): void {
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

export function getColorIndex(name: string): number {
  return colorSlots.get(name) ?? 0;
}

export function getColorFor(name: string): string {
  return comparisonColor(getColorIndex(name));
}

export function addToComparison(name: string | null): void {
  const { comparisonCountries } = getState();
  if (!name) return;
  if (comparisonCountries.includes(name)) return;
  if (comparisonCountries.length >= MAX_COMPARISON) return;
  setState({ comparisonCountries: [...comparisonCountries, name] });
}

export function removeFromComparison(name: string): void {
  const { comparisonCountries } = getState();
  if (!comparisonCountries.includes(name)) return;
  setState({ comparisonCountries: comparisonCountries.filter(c => c !== name) });
}

export function toggleComparison(name: string): void {
  const { comparisonCountries } = getState();
  if (comparisonCountries.includes(name)) {
    removeFromComparison(name);
  } else {
    addToComparison(name);
  }
}

export function clearComparison(): void {
  setState({ comparisonCountries: [], comparisonViewOpen: false });
}

export function initComparison(): void {
  const panelEl = document.getElementById('comparison-panel');
  const countryPanelEl = document.getElementById('country-panel');
  const stripEl = document.getElementById('comparison-strip');
  const clearBtn = document.getElementById('clear-comparison-btn');
  const backBtn = document.getElementById('comparison-back-btn');
  const viewBtn = document.getElementById('tray-view-btn');
  const countEl = document.getElementById('comparison-count');
  const stripCountEl = document.getElementById('comparison-strip-count');

  if (clearBtn) clearBtn.addEventListener('click', clearComparison);
  if (backBtn) backBtn.addEventListener('click', closeComparisonView);
  if (viewBtn) viewBtn.addEventListener('click', openComparisonView);

  // The comparison set lives as a pinned footer in the country panel
  // while the user assembles it — visible the whole time you're picking
  // countries, never over the map. It hides once the full view opens or
  // the set is empty.
  function updateStrip(): void {
    const { comparisonCountries, comparisonViewOpen } = getState();
    if (stripEl) stripEl.hidden = !(comparisonCountries.length >= 1 && !comparisonViewOpen);
  }

  on('comparisonCountries', (names) => {
    syncColorSlots(names);
    markComparisonCountries(names);
    if (countEl) countEl.textContent = String(names.length);
    if (stripCountEl) stripCountEl.textContent = String(names.length);
    renderTray(names);
    updateStrip();

    // Can't compare fewer than two — drop out of the full view if the
    // set falls below the threshold while it's open.
    if (getState().comparisonViewOpen && names.length < 2) {
      setState({ comparisonViewOpen: false });
    } else if (getState().comparisonViewOpen) {
      // Set changed while viewing — re-render the table/radar.
      renderComparisonPanel(names);
    }
  });

  // Remember what had focus when the full view took over, so closing it
  // can hand focus back rather than dropping it on a now-hidden element.
  let focusBeforeView: HTMLElement | null = null;

  on('comparisonViewOpen', (open) => {
    document.body.classList.toggle('view-compare', open);
    updateStrip();

    if (open) {
      // Comparison and the scatter explorer both claim the main area.
      if (getState().scatterOpen) setState({ scatterOpen: false });
      focusBeforeView = document.activeElement as HTMLElement | null;
      if (panelEl) panelEl.hidden = false;
      if (countryPanelEl) countryPanelEl.style.display = 'none';
      renderComparisonPanel(getState().comparisonCountries);
      // The country panel may have just been hidden — move focus into
      // the new region so keyboard users aren't stranded.
      backBtn?.focus();
    } else {
      if (panelEl) panelEl.hidden = true;
      if (countryPanelEl) countryPanelEl.style.display = '';
      clearComparisonPanel();
      // Restore focus to the opener if it's still on-screen.
      if (focusBeforeView && document.contains(focusBeforeView) && focusBeforeView.offsetParent !== null) {
        focusBeforeView.focus();
      }
      focusBeforeView = null;
    }
  });

  // While a set is being assembled, keep the add-bar's quick-add button
  // pointed at the most recently clicked country.
  on('selectedCountry', () => {
    if (getState().comparisonViewOpen) renderAddBar();
  });
}
