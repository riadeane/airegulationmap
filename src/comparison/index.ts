import { getState, on } from '../state/store';
import { openComparison, showMap, clearComparison } from '../state/interactions';
import { renderComparisonPanel, clearComparisonPanel, renderAddBar, renderTray } from './panel';

// Membership mutation, colour slots, and view transitions now live in the
// interactions orchestrator and the colorSlots leaf. This module owns only the
// comparison view's DOM: the staging strip, the full panel, and focus.

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
  if (backBtn) backBtn.addEventListener('click', showMap);
  if (viewBtn) viewBtn.addEventListener('click', openComparison);

  // The comparison set lives as a pinned footer in the country panel while the
  // user assembles it — visible the whole time you're picking countries, never
  // over the map. It hides once the full view opens or the set is empty.
  function updateStrip(): void {
    const { comparisonCountries, mainView } = getState();
    if (stripEl) stripEl.hidden = !(comparisonCountries.length >= 1 && mainView !== 'comparison');
  }

  on('comparisonCountries', (names) => {
    if (countEl) countEl.textContent = String(names.length);
    if (stripCountEl) stripCountEl.textContent = String(names.length);
    renderTray(names);
    updateStrip();

    // Can't compare fewer than two — drop out of the full view if the set
    // falls below the threshold while it's open.
    if (getState().mainView === 'comparison' && names.length < 2) {
      showMap();
    } else if (getState().mainView === 'comparison') {
      // Set changed while viewing — re-render the table/radar.
      renderComparisonPanel(names);
    }
  });

  // Remember what had focus when the full view took over, so closing it can
  // hand focus back rather than dropping it on a now-hidden element.
  let focusBeforeView: HTMLElement | null = null;

  on('mainView', (view) => {
    const open = view === 'comparison';
    document.body.classList.toggle('view-compare', open);
    updateStrip();

    if (open) {
      focusBeforeView = document.activeElement as HTMLElement | null;
      if (panelEl) panelEl.hidden = false;
      if (countryPanelEl) countryPanelEl.style.display = 'none';
      renderComparisonPanel(getState().comparisonCountries);
      // The country panel may have just been hidden — move focus into the new
      // region so keyboard users aren't stranded.
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
    if (getState().mainView === 'comparison') renderAddBar();
  });
}
