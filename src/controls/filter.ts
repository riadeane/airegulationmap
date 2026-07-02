import { getState, setState, on } from '../state/store';
import type { ConfidenceLevel } from '../state/store';
import { el } from '../dom';

const ALL_LEVELS: readonly ConfidenceLevel[] = ['high', 'medium', 'low'];

export function initFilter(): void {
  const btn = document.getElementById('filter-btn')!;
  const popover = document.getElementById('filter-popover')!;
  const minSlider = el<HTMLInputElement>('filter-min');
  const maxSlider = el<HTMLInputElement>('filter-max');
  const minLabel = document.getElementById('filter-min-label')!;
  const maxLabel = document.getElementById('filter-max-label')!;
  const confBoxes = Array.from(
    document.querySelectorAll<HTMLInputElement>('#filter-confidence input[type="checkbox"]')
  );
  const officialBox = el<HTMLInputElement>('filter-official');

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

  // Confidence checkboxes: all checked reads as "no filter" (null), so the
  // URL stays clean and the active-dot logic stays honest.
  function applyConfidence() {
    const checked = confBoxes.filter(b => b.checked).map(b => b.value as ConfidenceLevel);
    setState({ filterConfidence: checked.length === ALL_LEVELS.length ? null : checked });
  }
  confBoxes.forEach(b => b.addEventListener('change', applyConfidence));
  officialBox.addEventListener('change', () => {
    setState({ filterOfficialOnly: officialBox.checked });
  });

  // Reset affordance — a narrowed map greys most countries, and there
  // was no one-click way back. Appended last so the async-loaded bloc
  // row (blocSelector.ts) can insert itself above it.
  const resetRow = document.createElement('div');
  resetRow.className = 'filter-reset-row';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'filter-reset';
  resetBtn.textContent = 'Reset filters';
  resetBtn.addEventListener('click', () => {
    minSlider.value = '1';
    maxSlider.value = '5';
    minLabel.textContent = '1';
    maxLabel.textContent = '5';
    setState({
      filterMin: 1, filterMax: 5, selectedBloc: null,
      filterConfidence: null, filterOfficialOnly: false,
    });
  });
  resetRow.appendChild(resetBtn);
  popover.appendChild(resetRow);

  // Persistent active-state signal: when the score range is narrowed or
  // a bloc is selected, the button carries a dot + accent border so the
  // narrowed view is legible with the popover closed. Subscribes to the
  // state (not just slider input) so URL navigation and the bloc
  // dropdown keep it in sync.
  function updateActiveState() {
    const {
      filterMin, filterMax, selectedBloc, blocsData, filterConfidence, filterOfficialOnly,
    } = getState();
    const rangeActive = filterMin > 1 || filterMax < 5;
    const blocActive = !!selectedBloc;
    const confActive = filterConfidence != null;
    const active = rangeActive || blocActive || confActive || filterOfficialOnly;
    btn.classList.toggle('has-filter', active);
    resetBtn.disabled = !active;
    const parts: string[] = [];
    if (rangeActive) parts.push(`scores ${filterMin}–${filterMax}`);
    if (blocActive) parts.push(blocsData?.[selectedBloc!]?.name || selectedBloc!);
    if (confActive) parts.push(`${filterConfidence!.join('/')} confidence`);
    if (filterOfficialOnly) parts.push('official sources only');
    btn.title = active ? `Active filter: ${parts.join(' · ')}` : '';
  }

  // Keep the sliders and labels in sync when the range changes from
  // elsewhere (URL load, popstate, reset) — the input handler only covers
  // the user dragging the sliders themselves.
  function syncFromState() {
    const { filterMin, filterMax, filterConfidence, filterOfficialOnly } = getState();
    if (parseFloat(minSlider.value) !== filterMin) minSlider.value = String(filterMin);
    if (parseFloat(maxSlider.value) !== filterMax) maxSlider.value = String(filterMax);
    minLabel.textContent = String(filterMin);
    maxLabel.textContent = String(filterMax);
    confBoxes.forEach(b => {
      b.checked = !filterConfidence || filterConfidence.includes(b.value as ConfidenceLevel);
    });
    officialBox.checked = filterOfficialOnly;
  }

  on('filterMin', () => { syncFromState(); updateActiveState(); });
  on('filterMax', () => { syncFromState(); updateActiveState(); });
  on('filterConfidence', () => { syncFromState(); updateActiveState(); });
  on('filterOfficialOnly', () => { syncFromState(); updateActiveState(); });
  on('selectedBloc', updateActiveState);
  on('blocsData', updateActiveState);
  syncFromState();
  updateActiveState();
}
