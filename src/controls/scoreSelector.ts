import { SCORE_OPTIONS, ATTRIBUTE_LABELS } from '../constants';
import type { AttributeKey } from '../constants';
import { getState, setState, on } from '../state/store';

// The score-type button opens a listbox (the ARIA "select-only combobox"
// pattern's popup): options carry role="option" and aria-selected, focus
// roves across them with the arrow keys, Home and End, Enter or Space
// picks one, and Esc or Tab closes the list. Focus returns to the button
// when the list closes by keyboard.

// Label and aria-selected follow the state, whoever wrote it (a dimension
// row, a URL, popstate).
function syncSelected(attr: AttributeKey): void {
  document.getElementById('score-btn-label')!.textContent = ATTRIBUTE_LABELS[attr];
  document.querySelectorAll<HTMLLIElement>('#score-dropdown li').forEach(li => {
    const selected = li.dataset.value === attr;
    li.classList.toggle('selected', selected);
    li.setAttribute('aria-selected', String(selected));
  });
}

export function switchAttribute(attr: AttributeKey): void {
  setState({ currentAttribute: attr });
}

export function buildScoreSelector(): void {
  const btn = document.getElementById('score-btn')!;
  const dropdown = document.getElementById('score-dropdown')!;
  btn.setAttribute('aria-controls', 'score-dropdown');

  const options = SCORE_OPTIONS.map(opt => {
    const li = document.createElement('li');
    li.id = `score-option-${opt.value}`;
    li.setAttribute('role', 'option');
    li.tabIndex = -1;
    li.textContent = opt.text;
    li.dataset.value = opt.value;
    li.addEventListener('click', () => pick(opt.value));
    dropdown.appendChild(li);
    return li;
  });

  // Set the initial label from state so a URL-provided `?mode=` shows up
  // correctly without a click.
  syncSelected(getState().currentAttribute);
  on('currentAttribute', syncSelected);

  const isOpen = (): boolean => dropdown.classList.contains('open');
  const selectedIndex = (): number =>
    Math.max(0, options.findIndex(li => li.dataset.value === getState().currentAttribute));

  function setOpen(open: boolean): void {
    dropdown.classList.toggle('open', open);
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
  }

  function open(focusIndex: number = selectedIndex()): void {
    setOpen(true);
    document.getElementById('filter-popover')!.classList.remove('open');
    document.getElementById('filter-btn')!.classList.remove('active');
    document.getElementById('filter-btn')!.setAttribute('aria-expanded', 'false');
    options[focusIndex].focus();
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) btn.focus();
  }

  function pick(attr: AttributeKey): void {
    switchAttribute(attr);
    close(true);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (isOpen()) close(false);
    else open();
  });

  // Arrow keys on the closed button open the list, as a native select does.
  btn.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    open(e.key === 'ArrowUp' ? options.length - 1 : selectedIndex());
  });

  dropdown.addEventListener('keydown', e => {
    const i = options.indexOf(document.activeElement as HTMLLIElement);
    const last = options.length - 1;
    switch (e.key) {
      case 'ArrowDown': options[Math.min(i + 1, last)].focus(); break;
      case 'ArrowUp': options[Math.max(i - 1, 0)].focus(); break;
      case 'Home': options[0].focus(); break;
      case 'End': options[last].focus(); break;
      case 'Enter':
      case ' ':
        if (i >= 0) pick(options[i].dataset.value as AttributeKey);
        break;
      case 'Escape': close(true); break;
      // Left/Right mean nothing here, but must not reach the global
      // arrow-key country navigation either.
      case 'ArrowLeft':
      case 'ArrowRight': break;
      case 'Tab':
        // Tab moves on from the button, with the list closed.
        close(false);
        return;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  });
}

export function initDimensionClicks(): void {
  // Each dimension row has two distinct controls: the main button
  // recolors the map by that dimension (this handler), and a separate
  // caret button discloses the sub-indicator breakdown (see
  // panel/subscores.ts). They were a single overloaded click target
  // before - one click did both, with contradictory signifiers.
  //
  // Clicking the main button colors the map by that dimension; clicking
  // the active dimension again toggles back to the maturity index
  // (there was no in-panel way back before).
  document.querySelectorAll<HTMLElement>('.dimension-row[data-dimension]').forEach(row => {
    const main = row.querySelector<HTMLElement>('.dim-main');
    if (!main) return;
    main.title = 'Color the map by this dimension; click again to return to the maturity index';
    main.addEventListener('click', () => {
      const dimension = row.dataset.dimension as AttributeKey;
      switchAttribute(getState().currentAttribute === dimension ? 'averageScore' : dimension);
    });
  });
}
