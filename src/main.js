import './styles/main.css';

import { setState } from './state/store.js';
import { loadScores, loadRegulation } from './data/loader.js';
import { loadHistory } from './data/history.js';
import { generateMap, initMapSubscriptions } from './map/index.js';
import { initPanel } from './panel/index.js';
import { initComparison } from './comparison/index.js';
import { buildScoreSelector, initDimensionClicks } from './controls/scoreSelector.js';
import { initFilter } from './controls/filter.js';
import { initSearch, initKeyboardNav } from './controls/search.js';
import { initTimeline } from './controls/timeline.js';

function updateSiteLastUpdated(scoreData) {
  const dates = Object.values(scoreData)
    .map(d => d.lastUpdated)
    .filter(Boolean)
    .sort();
  const latest = dates[dates.length - 1];
  const el = document.getElementById('site-last-updated');
  if (el) el.textContent = latest || '2024';
}

function updateCountryCount(scoreData) {
  const count = Object.keys(scoreData).length;
  const el = document.getElementById('country-count');
  if (el) el.textContent = `${count} countries`;
}

function closeAllDropdowns(e) {
  if (e.target.closest('#score-dropdown, #score-btn, #filter-popover, #filter-btn')) return;
  document.getElementById('score-dropdown').classList.remove('open');
  document.getElementById('score-btn').classList.remove('active');
  document.getElementById('score-btn').setAttribute('aria-expanded', 'false');
  document.getElementById('filter-popover').classList.remove('open');
  document.getElementById('filter-btn').classList.remove('active');
  document.getElementById('filter-btn').setAttribute('aria-expanded', 'false');
}

async function main() {
  const [scoreData, regulationData] = await Promise.all([
    loadScores(),
    loadRegulation(),
  ]);

  const sortedCountryNames = Object.keys(scoreData).sort();
  setState({ scoreData, regulationData, sortedCountryNames });

  // Wire up UI controls
  buildScoreSelector();
  initFilter();
  initDimensionClicks();
  initPanel();
  initComparison();
  initSearch();
  initKeyboardNav();
  initMapSubscriptions();

  // Render map
  await generateMap();

  // Header info
  updateSiteLastUpdated(scoreData);
  updateCountryCount(scoreData);

  // Load history non-blocking
  loadHistory().then(history => initTimeline(history));

  // Global click-away to close dropdowns
  document.addEventListener('click', closeAllDropdowns);
}

main();
