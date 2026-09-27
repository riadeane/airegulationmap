// "Show uncertainty" (PRD 13): hatch low-confidence countries on the map.
//
// A display preference, not a filter. It sits in the filter popover (the
// header menu that already holds the confidence filter, and the one that
// folds behind ☰ on mobile) on its own row below "Reset filters", which
// leaves it alone. On by default, persisted per browser in localStorage,
// and never carried in the URL: a shared link opens with the reader's own
// setting.

import { getState, setState, on } from '../state/store';

export const UNCERTAINTY_STORAGE_KEY = 'showUncertainty';

type PrefStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The stored preference: on unless explicitly turned off ('0'). Blocked
 *  or missing storage reads as the default (on). */
export function readUncertaintyPref(storage: PrefStore | null): boolean {
  try {
    return storage?.getItem(UNCERTAINTY_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeUncertaintyPref(storage: PrefStore | null, show: boolean): void {
  try {
    storage?.setItem(UNCERTAINTY_STORAGE_KEY, show ? '1' : '0');
  } catch { /* storage blocked */ }
}

function browserStorage(): PrefStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function initUncertaintyToggle(): void {
  const storage = browserStorage();
  setState({ showUncertainty: readUncertaintyPref(storage) });

  const popover = document.getElementById('filter-popover');
  if (!popover) return;

  const row = document.createElement('div');
  row.className = 'filter-display-row';

  const label = document.createElement('label');
  label.className = 'filter-uncertainty-toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'show-uncertainty';
  box.checked = getState().showUncertainty;
  label.append(box, 'Show uncertainty');

  const hint = document.createElement('span');
  hint.className = 'filter-hint';
  hint.id = 'show-uncertainty-hint';
  hint.textContent = 'Hatches low-confidence countries';
  box.setAttribute('aria-describedby', hint.id);

  row.append(label, hint);
  // After the reset row (appended by initFilter): not part of the filters.
  popover.appendChild(row);

  box.addEventListener('change', () => {
    setState({ showUncertainty: box.checked });
  });

  on('showUncertainty', (show) => {
    box.checked = show;
    writeUncertaintyPref(storage, show);
  });
}
