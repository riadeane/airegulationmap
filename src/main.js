import './styles/main.css';

import { setState } from './state/store.js';
import { loadScores, loadRegulation } from './data/loader.js';
import { loadHistory } from './data/history.js';
import { loadBlocs } from './data/blocs.js';
import { initBlocSelector } from './controls/blocSelector.js';
import { initBlocSummary } from './controls/blocSummary.js';
import { generateMap, initMapSubscriptions } from './map/index.js';
import { initPanel } from './panel/index.js';
import { initComparison } from './comparison/index.js';
import { buildScoreSelector, initDimensionClicks } from './controls/scoreSelector.js';
import { initFilter } from './controls/filter.js';
import { initExport } from './controls/export.js';
import { initSearch, initKeyboardNav } from './controls/search.js';
import { initTimeline } from './controls/timeline.js';
import { initTheme } from './controls/theme.js';
import { parseUrl, initUrlSync } from './controls/url.js';
import { initCitePopover } from './controls/citePopover.js';
import { initHelpOverlay } from './controls/helpOverlay.js';
import { removeMapSkeleton, showLoadError } from './panel/resilience.js';

function updateSiteLastUpdated(scoreData) {
  const dates = Object.values(scoreData)
    .map(d => d.lastUpdated)
    .filter(Boolean)
    .sort();
  const latest = dates[dates.length - 1];
  const el = document.getElementById('site-last-updated');
  if (el) el.textContent = latest || '—';
}

function updateCountryCount(scoreData) {
  const count = Object.keys(scoreData).length;
  const el = document.getElementById('country-count');
  if (el) el.textContent = `${count} countries`;
}

function closeAllDropdowns(e) {
  if (e.target.closest('#score-dropdown, #score-btn, #filter-popover, #filter-btn, #export-popover, #export-btn')) return;
  for (const [popoverId, btnId] of [
    ['score-dropdown', 'score-btn'],
    ['filter-popover', 'filter-btn'],
    ['export-popover', 'export-btn'],
  ]) {
    document.getElementById(popoverId).classList.remove('open');
    const btn = document.getElementById(btnId);
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

async function main() {
  let scoreData, regulationData;
  try {
    [scoreData, regulationData] = await Promise.all([
      loadScores(),
      loadRegulation(),
    ]);
  } catch (err) {
    showLoadError(err);
    return;
  }

  const sortedCountryNames = Object.keys(scoreData).sort();
  setState({ scoreData, regulationData, sortedCountryNames });

  // Apply URL state BEFORE first render so `currentAttribute` and
  // `timelineDate` land correctly on initial paint. Theme was already
  // applied pre-paint by the inline script in index.html; we re-apply
  // here only so `initTheme()` sees a consistent localStorage value.
  const urlState = parseUrl();
  if (urlState.theme) {
    document.documentElement.setAttribute('data-theme', urlState.theme);
    try { localStorage.setItem('theme', urlState.theme); } catch (e) { /* storage blocked */ }
  }
  if (urlState.mode) setState({ currentAttribute: urlState.mode });
  if (urlState.date) setState({ timelineDate: urlState.date });

  // Wire up UI controls
  initTheme();
  buildScoreSelector();
  initFilter();
  initExport();
  initDimensionClicks();
  initPanel();
  initCitePopover();
  initComparison();
  initSearch();
  initKeyboardNav();
  initMapSubscriptions();
  initHelpOverlay();

  // Render map
  try {
    await generateMap();
    removeMapSkeleton();
  } catch (err) {
    showLoadError(err);
    return;
  }

  // Country / comparison selection needs the map to exist so the
  // highlight fires correctly. Unknown country names (typo, deleted
  // from data) are dropped silently.
  if (urlState.compare && urlState.compare.length > 0) {
    const valid = urlState.compare.filter(name => scoreData[name]);
    if (valid.length > 0) setState({ comparisonCountries: valid });
    if (valid.length === 1) setState({ selectedCountry: valid[0] });
  } else if (urlState.country && scoreData[urlState.country]) {
    setState({ selectedCountry: urlState.country });
  }

  // Header info
  updateSiteLastUpdated(scoreData);
  updateCountryCount(scoreData);

  // Load history non-blocking. Stored in state for the panel changelog;
  // the timeline keeps its own module reference.
  loadHistory().then(history => {
    setState({ history });
    initTimeline(history);
  });

  // Load bloc membership non-blocking; the bloc filter and summary
  // appear once the data exists. URL bloc is applied late, same as
  // country/compare above.
  loadBlocs(sortedCountryNames).then(blocsData => {
    if (!blocsData) return;
    setState({ blocsData });
    initBlocSelector();
    initBlocSummary();
    if (urlState.bloc && blocsData[urlState.bloc]) {
      setState({ selectedBloc: urlState.bloc });
    }
  });

  // Start writing URL changes. Done after initial state is applied so
  // we don't clobber the user's URL on boot.
  initUrlSync();

  // Global click-away to close dropdowns
  document.addEventListener('click', closeAllDropdowns);
}

main();
