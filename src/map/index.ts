import { on, getState } from '../state/store';
import { generateMap, updateMap, markComparisonCountries, displayedEntry, isHatched } from './renderer';
import { updateLegendLabels, updateLegendUncertainty } from './legend';
import { ATTRIBUTE_LABELS, isInsufficient } from '../constants';
import { modeAnnouncement } from '../data/meaning';

export { updateMap, highlightCountry, clearHighlight, updateSearchHighlight, markComparisonCountries } from './renderer';
export { generateMap };
export { initCountryTable } from './countryTable';

// Speak the current map mode to assistive tech when it changes. The
// region is polite - it waits for a lull in the user's focus rather
// than interrupting mid-reading. aria-atomic ensures the whole
// message is re-read on every update (not just the diff).
function announceMode() {
  const region = document.getElementById('map-live-region');
  if (!region) return;
  region.textContent = modeAnnouncement(getState().currentAttribute);
}

// Speak the selected country and its current-mode score. Keyboard and
// screen-reader users reach countries through search, arrow-stepping and
// the country table under the map (countryTable.ts); without this, they
// get no feedback on what they landed on.
function announceCountry(name: string | null) {
  const region = document.getElementById('map-live-region');
  if (!region) return;
  if (!name) {
    region.textContent = 'Selection cleared.';
    return;
  }
  const { currentAttribute } = getState();
  const label = ATTRIBUTE_LABELS[currentAttribute] || currentAttribute;
  const { entry, vintage } = displayedEntry(name);
  const score = entry?.[currentAttribute];
  // The hatch is visual; say it too, as the tooltip does.
  const flag = isHatched(name) ? ' Low confidence.' : '';
  region.textContent = score != null
    ? `Selected ${name}. ${label}: ${score} of 5${vintage ? ` as of ${vintage}` : ''}.${flag}`
    : isInsufficient(score)
      ? `Selected ${name}. ${label}: insufficient evidence${vintage ? ` as of ${vintage}` : ''}.`
      : `Selected ${name}. No ${label} data.`;
}

// Coalesce map recolors to one per frame. Several state keys can flip in
// the same tick (a reset writes filterMin + filterMax + selectedBloc; the
// store already drops no-op writes, but genuine multi-key changes still
// fan out). Without this, each key queued its own full-map 500ms
// transition and they stacked up during a slider drag. rAF collapses a
// burst into a single updateMap.
let mapUpdatePending = false;
function scheduleUpdateMap(): void {
  if (mapUpdatePending) return;
  mapUpdatePending = true;
  requestAnimationFrame(() => {
    mapUpdatePending = false;
    updateMap();
  });
}

export function initMapSubscriptions() {
  on('currentAttribute', () => {
    scheduleUpdateMap();
    updateLegendLabels();
    announceMode();
  });

  on('selectedCountry', announceCountry);
  // A ?date= deep link announces the selection before history.json
  // lands, so with the latest score; say it again once the vintage the
  // map paints has resolved.
  on('history', () => {
    const { selectedCountry, timelineDate } = getState();
    if (selectedCountry && timelineDate) announceCountry(selectedCountry);
  });

  on('filterMin', scheduleUpdateMap);
  on('filterMax', scheduleUpdateMap);
  on('selectedBloc', scheduleUpdateMap);
  on('filterConfidence', scheduleUpdateMap);
  on('filterOfficialOnly', scheduleUpdateMap);
  on('filterEvidence', scheduleUpdateMap);
  // The evidence facet reads its records from subscores.json, which loads
  // after first paint: repaint when it lands so an evidence= deep link
  // settles on the right set.
  on('subscores', () => { if (getState().filterEvidence !== 'any') scheduleUpdateMap(); });

  // The low-confidence hatch: its toggle, and confidence itself (a
  // hydrated dataset can carry new ratings). The legend key follows the
  // toggle and, on a past date, whether history recorded confidence.
  on('showUncertainty', () => {
    scheduleUpdateMap();
    updateLegendUncertainty();
  });
  on('regulationData', scheduleUpdateMap);
  on('timelineDate', updateLegendUncertainty);
  on('history', updateLegendUncertainty);

  // The map paints its own comparison markers. Colour slots are assigned by
  // the interactions orchestrator before this fires, so the indices are ready.
  // (Owning this here is what lets comparison/ stop importing the renderer.)
  on('comparisonCountries', markComparisonCountries);
}
