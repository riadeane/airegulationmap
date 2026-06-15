// Bloc filter — a third row inside the existing filter popover. Blocs
// are semantically a filter, and the header is already at capacity.

import { getState, setState, on } from '../state/store';

export function initBlocSelector(): void {
  const popover = document.getElementById('filter-popover');
  const { blocsData } = getState();
  if (!popover || !blocsData) return;

  const row = document.createElement('div');
  row.className = 'filter-row filter-row-bloc';

  const label = document.createElement('span');
  label.className = 'filter-label';
  label.textContent = 'Bloc';

  const select = document.createElement('select');
  select.id = 'bloc-select';
  select.setAttribute('aria-label', 'Filter by political or economic bloc');

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'All countries';
  select.appendChild(defaultOpt);

  for (const [key, bloc] of Object.entries(blocsData)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = bloc.name;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => {
    setState({ selectedBloc: select.value || null });
  });

  // Keep the select in sync when the bloc changes elsewhere (URL
  // navigation, summary-card dismiss).
  on('selectedBloc', value => {
    select.value = value || '';
  });

  row.append(label, select);
  // Keep the reset button (appended by initFilter) last in the popover.
  const resetRow = popover.querySelector('.filter-reset-row');
  if (resetRow) popover.insertBefore(row, resetRow);
  else popover.appendChild(row);

  select.value = getState().selectedBloc || '';
}
