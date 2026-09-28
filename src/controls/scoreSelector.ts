import { ATTRIBUTES, ATTRIBUTE_LABELS, GROUPS, attributesIn } from '../constants';
import type { AttributeGroup } from '../constants';
import type { AttributeKey } from '../constants';
import { getState, setState, on } from '../state/store';
import { el } from '../dom';

// The score-type button opens a listbox (the ARIA "select-only combobox"
// pattern's popup): options carry role="option" and aria-selected, focus
// roves across them with the arrow keys, Home and End, Enter or Space
// picks one, and Esc or Tab closes the list. Focus returns to the button
// when the list closes by keyboard.
//
// Options sit in two labelled groups (role="group"), "Implementation" and
// "Governance style" (PRD 16), and each carries the one-line question its
// score answers, so the reader knows what a colour means before choosing
// it. The groups are presentational for the keyboard: the arrows rove
// across all six options in display order.

// Label and aria-selected follow the state, whoever wrote it (a dimension
// row, a URL, popstate).
function syncSelected(attr: AttributeKey): void {
  el('score-btn-label').textContent = ATTRIBUTE_LABELS[attr];
  document.querySelectorAll<HTMLLIElement>('#score-dropdown [role="option"]').forEach(li => {
    const selected = li.dataset.value === attr;
    li.classList.toggle('selected', selected);
    li.setAttribute('aria-selected', String(selected));
  });
}

export function switchAttribute(attr: AttributeKey): void {
  setState({ currentAttribute: attr });
}

export function buildScoreSelector(): void {
  const btn = el('score-btn');
  const dropdown = el('score-dropdown');
  btn.setAttribute('aria-controls', 'score-dropdown');

  const options: HTMLLIElement[] = [];
  for (const group of ['implementation', 'style'] as AttributeGroup[]) {
    const wrap = document.createElement('li');
    wrap.setAttribute('role', 'presentation');
    wrap.className = 'score-group';
    const head = document.createElement('span');
    head.className = 'score-group-head';
    head.id = `score-group-${group}`;
    head.textContent = GROUPS[group].label;
    const list = document.createElement('ul');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-labelledby', head.id);
    for (const value of attributesIn(group)) {
      const li = document.createElement('li');
      li.id = `score-option-${value}`;
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      li.dataset.value = value;
      const label = document.createElement('span');
      label.className = 'score-option-label';
      label.id = `${li.id}-label`;
      label.textContent = ATTRIBUTES[value].label;
      const question = document.createElement('span');
      question.className = 'score-option-question';
      question.id = `${li.id}-question`;
      question.textContent = ATTRIBUTES[value].question;
      li.append(label, question);
      li.setAttribute('aria-labelledby', label.id);
      li.setAttribute('aria-describedby', question.id);
      li.addEventListener('click', () => pick(value));
      list.appendChild(li);
      options.push(li);
    }
    wrap.append(head, list);
    dropdown.appendChild(wrap);
  }

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
    el('filter-popover').classList.remove('open');
    el('filter-btn').classList.remove('active');
    el('filter-btn').setAttribute('aria-expanded', 'false');
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
  // the active dimension again toggles back to the implementation index
  // (there was no in-panel way back before).
  document.querySelectorAll<HTMLElement>('.dimension-row[data-dimension]').forEach(row => {
    const main = row.querySelector<HTMLElement>('.dim-main');
    if (!main) return;
    main.title = 'Colour the map by this dimension; click again to return to the implementation index';
    main.addEventListener('click', () => {
      const dimension = row.dataset.dimension as AttributeKey;
      switchAttribute(getState().currentAttribute === dimension ? 'averageScore' : dimension);
    });
  });
}
