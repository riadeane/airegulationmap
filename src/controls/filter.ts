import { setState } from '../state/store';

export function initFilter(): void {
  const btn = document.getElementById('filter-btn')!;
  const popover = document.getElementById('filter-popover')!;
  const minSlider = document.getElementById('filter-min') as HTMLInputElement;
  const maxSlider = document.getElementById('filter-max') as HTMLInputElement;
  const minLabel = document.getElementById('filter-min-label')!;
  const maxLabel = document.getElementById('filter-max-label')!;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popover.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    document.getElementById('score-dropdown')!.classList.remove('open');
    document.getElementById('score-btn')!.classList.remove('active');
    document.getElementById('score-btn')!.setAttribute('aria-expanded', 'false');
  });

  function applyFilter() {
    const min = parseFloat(minSlider.value);
    let max = parseFloat(maxSlider.value);
    if (min > max) {
      max = min;
      maxSlider.value = String(max);
    }
    minLabel.textContent = String(min);
    maxLabel.textContent = String(max);
    setState({ filterMin: min, filterMax: max });
  }

  minSlider.addEventListener('input', applyFilter);
  maxSlider.addEventListener('input', applyFilter);
}
