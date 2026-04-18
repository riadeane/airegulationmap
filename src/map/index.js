import { on, getState } from '../state/store.js';
import { generateMap, updateMap } from './renderer.js';
import { updateLegendLabels } from './legend.js';
import { ATTRIBUTE_LABELS, LEGEND_ENDPOINTS } from '../constants.js';

export { updateMap, highlightCountry, clearHighlight, updateSearchHighlight, markComparisonCountries } from './renderer.js';
export { generateMap };

// Speak the current map mode to assistive tech when it changes. The
// region is polite — it waits for a lull in the user's focus rather
// than interrupting mid-reading. aria-atomic ensures the whole
// message is re-read on every update (not just the diff).
function announceMode() {
  const region = document.getElementById('map-live-region');
  if (!region) return;
  const { currentAttribute } = getState();
  const label = ATTRIBUTE_LABELS[currentAttribute] || currentAttribute;
  const [low, high] = LEGEND_ENDPOINTS[currentAttribute] || ['low', 'high'];
  region.textContent = `Map now showing ${label}. Legend ranges from ${low} to ${high}.`;
}

export function initMapSubscriptions() {
  on('currentAttribute', () => {
    updateMap();
    updateLegendLabels();
    announceMode();
  });

  on('filterMin', () => updateMap());
  on('filterMax', () => updateMap());
}
