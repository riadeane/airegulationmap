import { SCORE_OPTIONS, ATTRIBUTE_LABELS } from '../constants.js';
import { getState, setState } from '../state/store.js';

export function switchAttribute(attr) {
  setState({ currentAttribute: attr });
  document.getElementById('score-btn-label').textContent = ATTRIBUTE_LABELS[attr];
  document.querySelectorAll('#score-dropdown li').forEach(li => {
    li.classList.toggle('selected', li.dataset.value === attr);
  });
}

export function buildScoreSelector() {
  const btn = document.getElementById('score-btn');
  const dropdown = document.getElementById('score-dropdown');

  // Set initial button label from state so a URL-provided `?mode=` or
  // a future persisted preference shows up correctly without a click.
  const { currentAttribute } = getState();
  document.getElementById('score-btn-label').textContent =
    ATTRIBUTE_LABELS[currentAttribute] || ATTRIBUTE_LABELS.averageScore;

  for (const opt of SCORE_OPTIONS) {
    const li = document.createElement('li');
    li.textContent = opt.text;
    li.dataset.value = opt.value;
    if (opt.value === getState().currentAttribute) li.classList.add('selected');
    li.addEventListener('click', () => {
      switchAttribute(opt.value);
      dropdown.classList.remove('open');
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    });
    dropdown.appendChild(li);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    document.getElementById('filter-popover').classList.remove('open');
    document.getElementById('filter-btn').classList.remove('active');
    document.getElementById('filter-btn').setAttribute('aria-expanded', 'false');
  });
}

export function initDimensionClicks() {
  // Rows are real <button> elements now — Enter/Space activation comes
  // free from the browser, so we only wire click.
  document.querySelectorAll('.dimension-row[data-dimension]').forEach(row => {
    row.addEventListener('click', () => switchAttribute(row.dataset.dimension));
  });
}
