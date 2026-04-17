import { on } from '../state/store.js';
import { generateMap, updateMap } from './renderer.js';
import { updateLegendLabels } from './legend.js';

export { updateMap, highlightCountry, clearHighlight, updateSearchHighlight, markComparisonCountries } from './renderer.js';
export { generateMap };

export function initMapSubscriptions() {
  on('currentAttribute', () => {
    updateMap();
    updateLegendLabels();
  });

  on('filterMin', () => updateMap());
  on('filterMax', () => updateMap());
}
