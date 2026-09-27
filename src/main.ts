import './styles/main.css';

import { getState, on, setState } from './state/store';
import { restoreComparison, selectCountry, openScatter, commitSearch } from './state/interactions';
import { loadScores, loadRegulation } from './data/loader';
import { loadHistory } from './data/history';
import { loadBlocs } from './data/blocs';
import { loadSubscores } from './data/subscores';
import { loadCountryIso } from './data/countryIso';
import { initBlocSelector } from './controls/blocSelector';
import { initBlocSummary } from './controls/blocSummary';
import { initSubscores } from './panel/subscores';
import { generateMap, initMapSubscriptions, updateMap } from './map/index';
import { initPanel } from './panel/index';
import { initComparison } from './comparison/index';
import { initScatter } from './scatter/index';
import { buildScoreSelector, initDimensionClicks } from './controls/scoreSelector';
import { initFilter } from './controls/filter';
import { initUncertaintyToggle } from './controls/uncertainty';
import { initExport } from './controls/export';
import { initSearch, initKeyboardNav, invalidateSearchIndex } from './controls/search';
import { initSearchResults } from './panel/searchResults';
import { initShare } from './controls/share';
import { initTimeline } from './controls/timeline';
import { initTheme } from './controls/theme';
import { parseUrl, initUrlSync } from './controls/url';
import { initCitePopover } from './controls/citePopover';
import { initPrintBrief } from './controls/printBrief';
import { initReport } from './controls/report';
import { initInitiatives } from './panel/initiatives';
import { hydrateFromSupabase } from './data/hydrate';
import { loadSourceMeta } from './data/sourceMeta';
import { initHelpOverlay } from './controls/helpOverlay';
import { initMenu } from './controls/menu';
import { initThisWeek } from './controls/thisWeek';
import { initOnboarding } from './controls/onboarding';
import { removeMapSkeleton, showLoadError } from './panel/resilience';
import type { ScoreData, RegulationData } from './data/loader';

function updateSiteLastUpdated(scoreData: ScoreData): void {
  const dates = Object.values(scoreData)
    .map(d => d.lastUpdated)
    .filter(Boolean)
    .sort();
  const latest = dates[dates.length - 1];
  const el = document.getElementById('site-last-updated');
  if (el) el.textContent = latest || '–';
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
  if ((e.target as Element).closest('#score-dropdown, #score-btn, #filter-popover, #filter-btn, #export-popover, #export-btn, #share-popover, #share-btn')) return;
  for (const [popoverId, btnId] of [
    ['score-dropdown', 'score-btn'],
    ['filter-popover', 'filter-btn'],
    ['export-popover', 'export-btn'],
    ['share-popover', 'share-btn'],
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
  if (urlState.filterMin !== undefined || urlState.filterMax !== undefined) {
    setState({ filterMin: urlState.filterMin ?? 1, filterMax: urlState.filterMax ?? 5 });
  }
  if (urlState.filterConfidence) setState({ filterConfidence: urlState.filterConfidence });
  if (urlState.filterOfficialOnly) setState({ filterOfficialOnly: true });
  // The evidence records arrive with subscores.json (below); the map and
  // scatter repaint on 'subscores', so the facet can apply before they land.
  if (urlState.filterEvidence) setState({ filterEvidence: urlState.filterEvidence });

  // Wire up UI controls
  initTheme();
  buildScoreSelector();
  initFilter();
  initUncertaintyToggle();
  initExport();
  initDimensionClicks();
  initPanel();
  initSubscores();
  initCitePopover();
  initPrintBrief();
  initReport();
  initComparison();
  initSearch();
  initSearchResults();
  initShare();
  initInitiatives();
  initKeyboardNav();
  initMapSubscriptions();
  initScatter();
  initHelpOverlay();
  initMenu();
  initThisWeek();
  initOnboarding();

  if (urlState.scatter) {
    setState({ scatterX: urlState.scatter.x, scatterY: urlState.scatter.y });
  }

  // Render map
  try {
    await generateMap();
    removeMapSkeleton();
    // The first paint sets fills only; opacity (the score-range and
    // country filters) is updateMap's job. Run it once so filters from
    // the URL (?conf=, ?min=, ?max=, ?official=) show on load.
    updateMap();
  } catch (err) {
    showLoadError(err);
    return;
  }

  // Country / comparison selection needs the map to exist so the
  // highlight fires correctly. Unknown country names (typo, deleted
  // from data) are dropped silently.
  // Committed search first: it deselects to reveal the results list, so a
  // country/compare in the same URL takes precedence by applying after.
  if (urlState.q) commitSearch(urlState.q);
  if (urlState.compare && urlState.compare.length >= 2) {
    const valid = urlState.compare.filter(name => scoreData[name]);
    // A shared compare link opens the full comparison view directly.
    if (valid.length >= 2) restoreComparison(valid);
  } else if (urlState.country && scoreData[urlState.country]) {
    selectCountry(urlState.country);
  }
  if (urlState.scatter) openScatter();

  // Header info
  updateSiteLastUpdated(scoreData);
  updateCountryCount(scoreData);

  // Load history non-blocking. Stored in state for the panel changelog;
  // the timeline keeps its own module reference.
  loadHistory().then(history => {
    setState({ history });
    initTimeline(history);
  });

  // Sub-indicator audit trail (methodology v2) - non-blocking; the
  // dimension-row breakdown appears once it loads.
  loadSubscores().then(subscores => setState({ subscores }));

  // ISO codes for the panel name row and the printed brief - non-blocking.
  loadCountryIso().then(countryIso => setState({ countryIso }));

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

  // Supabase progressive enhancement, off the critical path: hydrate the
  // dataset if the database is strictly newer than the static snapshot,
  // and fetch source titles for the panel. Both no-op when unconfigured
  // or unreachable - the static files remain authoritative.
  //
  // A dataset replacement must actually repaint: the store emits
  // 'scoreData'/'regulationData', and these subscriptions carry the new
  // data into the surfaces that render from it.
  on('scoreData', () => {
    const { scoreData: fresh } = getState();
    updateMap();
    updateSiteLastUpdated(fresh);
    updateCountryCount(fresh);
  });
  // The full-text index caches off regulationData; the open panel
  // re-renders itself (panel/index.ts subscribes to the same key).
  on('regulationData', invalidateSearchIndex);

  const idle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (fn: () => void) => setTimeout(fn, 1500);
  idle(() => {
    void hydrateFromSupabase();
    void loadSourceMeta();
  });

  // Global click-away to close dropdowns
  document.addEventListener('click', closeAllDropdowns);
}

main();
