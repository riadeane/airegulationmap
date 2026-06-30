import './styles/main.css';

import { setState } from './state/store';
import { loadScores, loadRegulation } from './data/loader';
import { loadHistory } from './data/history';
import { loadBlocs } from './data/blocs';
import { loadSubscores } from './data/subscores';
import { initBlocSelector } from './controls/blocSelector';
import { initBlocSummary } from './controls/blocSummary';
import { initSubscores } from './panel/subscores';
import { generateMap, initMapSubscriptions } from './map/index';
import { initPanel } from './panel/index';
import { initComparison } from './comparison/index';
import { initScatter } from './scatter/index';
import { buildScoreSelector, initDimensionClicks } from './controls/scoreSelector';
import { initFilter } from './controls/filter';
import { initExport } from './controls/export';
import { initSearch, initKeyboardNav } from './controls/search';
import { initTimeline } from './controls/timeline';
import { initTheme } from './controls/theme';
import { parseUrl, initUrlSync } from './controls/url';
import { initCitePopover } from './controls/citePopover';
import { initHelpOverlay } from './controls/helpOverlay';
import { removeMapSkeleton, showLoadError } from './panel/resilience';
import type { ScoreData, RegulationData } from './data/loader';

function updateSiteLastUpdated(scoreData: ScoreData): void {
  const dates = Object.values(scoreData)
    .map(d => d.lastUpdated)
    .filter(Boolean)
    .sort();
  const latest = dates[dates.length - 1];
  const el = document.getElementById('site-last-updated');
  if (el) el.textContent = latest || '—';
}

function updateCountryCount(scoreData: ScoreData): void {
  const count = Object.keys(scoreData).length;
  const el = document.getElementById('country-count');
  if (el) el.textContent = `${count} countries`;
  // Keep the intro lede's count in sync with the data rather than a
  // hardcoded number that silently drifts.
  const introCount = document.getElementById('intro-country-count');
  if (introCount) introCount.textContent = String(count);
}

function closeAllDropdowns(e: MouseEvent): void {
  if ((e.target as Element).closest('#score-dropdown, #score-btn, #filter-popover, #filter-btn, #export-popover, #export-btn')) return;
  for (const [popoverId, btnId] of [
    ['score-dropdown', 'score-btn'],
    ['filter-popover', 'filter-btn'],
    ['export-popover', 'export-btn'],
  ]) {
    document.getElementById(popoverId)!.classList.remove('open');
    const btn = document.getElementById(btnId)!;
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

async function main(): Promise<void> {
  let scoreData: ScoreData, regulationData: RegulationData;
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
  initSubscores();
  initCitePopover();
  initComparison();
  initSearch();
  initKeyboardNav();
  initMapSubscriptions();
  initScatter();
  initHelpOverlay();

  if (urlState.scatter) {
    setState({
      scatterOpen: true,
      scatterX: urlState.scatter.x,
      scatterY: urlState.scatter.y,
    });
  }

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
  if (urlState.compare && urlState.compare.length >= 2) {
    const valid = urlState.compare.filter(name => scoreData[name]);
    // A shared compare link opens the full comparison view directly.
    if (valid.length >= 2) setState({ comparisonCountries: valid, comparisonViewOpen: true });
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

  // Sub-indicator audit trail (methodology v2) — non-blocking; the
  // dimension-row breakdown appears once it loads.
  loadSubscores().then(subscores => setState({ subscores }));

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
