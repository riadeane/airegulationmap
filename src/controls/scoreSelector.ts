import { SCORE_OPTIONS, ATTRIBUTE_LABELS } from '../constants';
import type { AttributeKey } from '../constants';
import { getState, setState } from '../state/store';

export function switchAttribute(attr: AttributeKey): void {
  setState({ currentAttribute: attr });
  document.getElementById('score-btn-label')!.textContent = ATTRIBUTE_LABELS[attr];
  document.querySelectorAll<HTMLLIElement>('#score-dropdown li').forEach(li => {
    li.classList.toggle('selected', li.dataset.value === attr);
  });
}

export function buildScoreSelector(): void {
  const btn = document.getElementById('score-btn')!;
  const dropdown = document.getElementById('score-dropdown')!;

  // Set initial button label from state so a URL-provided `?mode=` or
  // a future persisted preference shows up correctly without a click.
  const { currentAttribute } = getState();
  document.getElementById('score-btn-label')!.textContent =
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
    document.getElementById('filter-popover')!.classList.remove('open');
    document.getElementById('filter-btn')!.classList.remove('active');
    document.getElementById('filter-btn')!.setAttribute('aria-expanded', 'false');
  });
}

export function initDimensionClicks(): void {
  // Each dimension row has two distinct controls: the main button
  // recolors the map by that dimension (this handler), and a separate
  // caret button discloses the sub-indicator breakdown (see
  // panel/subscores.ts). They were a single overloaded click target
  // before — one click did both, with contradictory signifiers.
  //
  // Clicking the main button colors the map by that dimension; clicking
  // the active dimension again toggles back to the maturity index
  // (there was no in-panel way back before).
  document.querySelectorAll<HTMLElement>('.dimension-row[data-dimension]').forEach(row => {
    const main = row.querySelector<HTMLElement>('.dim-main');
    if (!main) return;
    main.title = 'Color the map by this dimension — click again to return to the maturity index';
    main.addEventListener('click', () => {
      const dimension = row.dataset.dimension as AttributeKey;
      switchAttribute(getState().currentAttribute === dimension ? 'averageScore' : dimension);
    });
  });
}
