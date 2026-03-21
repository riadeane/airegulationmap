import { setState } from '../state/store.js';

export function initFilter() {
  const btn = document.getElementById('filter-btn');
  const popover = document.getElementById('filter-popover');
  const minSlider = document.getElementById('filter-min');
  const maxSlider = document.getElementById('filter-max');
  const minLabel = document.getElementById('filter-min-label');
  const maxLabel = document.getElementById('filter-max-label');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popover.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    document.getElementById('score-dropdown').classList.remove('open');
    document.getElementById('score-btn').classList.remove('active');
    document.getElementById('score-btn').setAttribute('aria-expanded', 'false');
  });

  function applyFilter() {
    let min = parseFloat(minSlider.value);
    let max = parseFloat(maxSlider.value);
    if (min > max) {
      max = min;
      maxSlider.value = max;
    }
    minLabel.textContent = min;
    maxLabel.textContent = max;
    setState({ filterMin: min, filterMax: max });
  }

  minSlider.addEventListener('input', applyFilter);
  maxSlider.addEventListener('input', applyFilter);
}
