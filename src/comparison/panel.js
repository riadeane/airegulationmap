import { getState } from '../state/store.js';
import { ATTRIBUTE_LABELS } from '../constants.js';
import { cleanRegulationText } from '../panel/sections.js';
import { renderRadar } from './radar.js';
import { COMPARISON_COLORS } from './colors.js';
import { removeFromComparison } from './index.js';

const DETAIL_DIMENSIONS = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

function renderChips(names) {
  const container = document.getElementById('comparison-chips');
  container.replaceChildren();
  names.forEach((name, idx) => {
    const color = COMPARISON_COLORS[idx % COMPARISON_COLORS.length];
    const chip = document.createElement('span');
    chip.className = 'comp-chip';
    chip.style.setProperty('--chip-color', color);

    const label = document.createElement('span');
    label.className = 'comp-chip-label';
    label.textContent = name;
    chip.appendChild(label);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'comp-chip-remove';
    btn.setAttribute('aria-label', `Remove ${name} from comparison`);
    btn.textContent = '×';
    btn.addEventListener('click', () => removeFromComparison(name));
    chip.appendChild(btn);

    container.appendChild(chip);
  });
}

function renderDetails(names) {
  const container = document.getElementById('comparison-details');
  container.replaceChildren();

  const { regulationData } = getState();

  // Header row with country names colored by their palette entry
  const header = document.createElement('div');
  header.className = 'comp-details-row comp-details-header';
  header.style.setProperty('--col-count', String(names.length));
  const corner = document.createElement('div');
  corner.className = 'comp-details-label';
  header.appendChild(corner);
  names.forEach((name, idx) => {
    const cell = document.createElement('div');
    cell.className = 'comp-details-cell comp-details-country';
    cell.style.color = COMPARISON_COLORS[idx % COMPARISON_COLORS.length];
    cell.textContent = name;
    header.appendChild(cell);
  });
  container.appendChild(header);

  DETAIL_DIMENSIONS.forEach(dim => {
    const row = document.createElement('div');
    row.className = 'comp-details-row';
    row.style.setProperty('--col-count', String(names.length));

    const label = document.createElement('div');
    label.className = 'comp-details-label';
    label.textContent = ATTRIBUTE_LABELS[dim];
    row.appendChild(label);

    names.forEach(name => {
      const cell = document.createElement('div');
      cell.className = 'comp-details-cell';
      const reg = regulationData[name];
      const text = reg ? cleanRegulationText(reg[dim]) : null;
      if (text) {
        cell.textContent = text;
      } else {
        cell.textContent = 'No data';
        cell.classList.add('empty');
      }
      row.appendChild(cell);
    });
    container.appendChild(row);
  });
}

export function renderComparisonPanel(names) {
  renderChips(names);
  renderRadar(document.getElementById('radar-chart'), names, getState().scoreData);
  renderDetails(names);
}

export function clearComparisonPanel() {
  const chips = document.getElementById('comparison-chips');
  const radar = document.getElementById('radar-chart');
  const details = document.getElementById('comparison-details');
  if (chips) chips.replaceChildren();
  if (radar) radar.replaceChildren();
  if (details) details.replaceChildren();
}
