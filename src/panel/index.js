import { getState, on } from '../state/store.js';
import { renderScoreBar, renderAllDots } from './scores.js';
import { renderTextSections } from './sections.js';
import { highlightCountry, clearHighlight } from '../map/index.js';

function updateDimensionHighlight() {
  const { currentAttribute } = getState();
  document.querySelectorAll('.dimension-row[data-dimension]').forEach(row => {
    row.classList.toggle('active-dimension', row.dataset.dimension === currentAttribute);
  });
}

function renderPanel(countryName) {
  const { scoreData, regulationData } = getState();
  const score = scoreData[countryName];
  const reg = regulationData[countryName];

  document.getElementById('no-selection-message').style.display = 'none';
  document.getElementById('panel-content').style.display = '';

  document.getElementById('country-name').textContent = countryName;

  const badge = document.getElementById('confidence-badge');
  if (reg && reg.confidence === 'low') {
    badge.textContent = 'Low confidence';
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  const dateStr = (score && score.lastUpdated) || (reg && reg.lastUpdated);
  document.getElementById('last-updated').textContent = dateStr ? `Data as of ${dateStr}` : '';

  renderScoreBar(score ? score.averageScore : null);
  renderAllDots(score);
  updateDimensionHighlight();
  renderTextSections(reg);
  highlightCountry(countryName);
}

function clearPanel() {
  document.getElementById('no-selection-message').style.display = '';
  document.getElementById('panel-content').style.display = 'none';
  clearHighlight();
}

export function initPanel() {
  on('selectedCountry', (countryName) => {
    if (countryName) {
      renderPanel(countryName);
    } else {
      clearPanel();
    }
  });

  on('currentAttribute', updateDimensionHighlight);
}
