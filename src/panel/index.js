import { getState, on } from '../state/store.js';
import { renderScoreBar, renderAllDots } from './scores.js';
import { renderTextSections } from './sections.js';
import { highlightCountry, clearHighlight } from '../map/index.js';
import { toggleComparison, MAX_COMPARISON } from '../comparison/index.js';

const CONFIDENCE_LABELS = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

function normalizeConfidence(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return null;
}

function updateDimensionHighlight() {
  const { currentAttribute } = getState();
  document.querySelectorAll('.dimension-row[data-dimension]').forEach(row => {
    row.classList.toggle('active-dimension', row.dataset.dimension === currentAttribute);
  });
}

function updateCompareButton() {
  const btn = document.getElementById('compare-btn');
  if (!btn) return;
  const { selectedCountry, comparisonCountries } = getState();
  if (!selectedCountry) {
    btn.disabled = true;
    btn.textContent = '+ Compare';
    btn.title = '';
    return;
  }
  const inList = comparisonCountries.includes(selectedCountry);
  if (inList) {
    btn.disabled = false;
    btn.textContent = '− Remove from comparison';
    btn.title = '';
    btn.classList.add('in-comparison');
  } else {
    btn.classList.remove('in-comparison');
    const atCap = comparisonCountries.length >= MAX_COMPARISON;
    btn.disabled = atCap;
    btn.textContent = '+ Compare';
    btn.title = atCap ? `Maximum ${MAX_COMPARISON} countries` : '';
  }
}

function updateCiteButton() {
  const btn = document.getElementById('cite-btn');
  if (!btn) return;
  const { selectedCountry, comparisonCountries } = getState();
  const disabled = !selectedCountry && comparisonCountries.length === 0;
  btn.disabled = disabled;
  btn.title = disabled ? 'Select a country first' : '';
}

function renderPanel(countryName) {
  const { scoreData, regulationData, comparisonCountries } = getState();
  const score = scoreData[countryName];
  const reg = regulationData[countryName];

  // If comparison is active, don't take over the panel slot — just update
  // the map highlight and bail. The comparison panel owns the right side.
  const comparisonActive = comparisonCountries.length >= 2;

  if (!comparisonActive) {
    const fallback = document.getElementById('no-selection-message');
    if (fallback) fallback.hidden = true;
    document.getElementById('panel-content').style.display = '';
  }

  document.getElementById('country-name').textContent = countryName;

  const badge = document.getElementById('confidence-badge');
  const level = normalizeConfidence(reg && reg.confidence);
  if (level) {
    badge.textContent = CONFIDENCE_LABELS[level];
    badge.setAttribute('data-level', level);
    badge.style.display = 'inline-flex';
    badge.title = level === 'low'
      ? 'Sparse public information; treat as indicative.'
      : level === 'medium'
      ? 'Based on a mix of primary and secondary sources.'
      : 'Supported by enacted legislation and recent primary sources.';
  } else {
    badge.style.display = 'none';
    badge.removeAttribute('data-level');
    badge.removeAttribute('title');
  }

  const dateStr = (score && score.lastUpdated) || (reg && reg.lastUpdated);
  const sourceUrls = reg && reg.sources
    ? reg.sources.split('|').map(u => u.trim()).filter(Boolean)
    : [];
  const countText = sourceUrls.length > 0
    ? `${sourceUrls.length} source${sourceUrls.length === 1 ? '' : 's'}`
    : 'no primary sources';
  document.getElementById('last-updated').textContent = dateStr
    ? `Data as of ${dateStr} · ${countText}`
    : countText;

  renderScoreBar(score ? score.averageScore : null);
  renderAllDots(score);
  updateDimensionHighlight();
  renderTextSections(reg);
  highlightCountry(countryName);
  updateCompareButton();
  updateCiteButton();
}

function clearPanel() {
  const fallback = document.getElementById('no-selection-message');
  if (fallback) fallback.hidden = false;
  document.getElementById('panel-content').style.display = 'none';
  clearHighlight();
  updateCompareButton();
  updateCiteButton();
}

export function initPanel() {
  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      const { selectedCountry } = getState();
      if (selectedCountry) toggleComparison(selectedCountry);
    });
  }

  on('selectedCountry', (countryName) => {
    if (countryName) {
      renderPanel(countryName);
    } else {
      clearPanel();
    }
  });

  on('currentAttribute', updateDimensionHighlight);
  on('comparisonCountries', () => { updateCompareButton(); updateCiteButton(); });
  updateCiteButton();

  let introConsumed = false;
  const consumeIntro = () => {
    if (introConsumed) return;
    const { selectedCountry, comparisonCountries } = getState();
    if (selectedCountry || (comparisonCountries && comparisonCountries.length > 0)) {
      introConsumed = true;
      const intro = document.getElementById('panel-intro');
      if (intro) intro.remove();
    }
  };
  on('selectedCountry', consumeIntro);
  on('comparisonCountries', consumeIntro);
}
