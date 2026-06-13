// Expandable sub-indicator breakdown beneath each dimension row.
// Methodology v2 scores every dimension as the mean of four named
// sub-indicators; this is the per-claim audit trail, one click deep.

import { getState, on } from '../state/store';
import type { DimensionKey } from '../constants';
import { DIMENSION_TO_SNAKE, SUBSCORE_LABELS } from '../data/subscores';

let expanded: DimensionKey | null = null;

function panelFor(row: HTMLElement): HTMLElement {
  // One container per dimension row, created on demand directly after it.
  const existing = row.nextElementSibling;
  if (existing instanceof HTMLElement && existing.classList.contains('subscore-panel')) {
    return existing;
  }
  const div = document.createElement('div');
  div.className = 'subscore-panel';
  div.hidden = true;
  row.insertAdjacentElement('afterend', div);
  return div;
}

function renderBreakdown(container: HTMLElement, dimension: DimensionKey): boolean {
  const { subscores, selectedCountry } = getState();
  container.replaceChildren();
  if (!subscores || !selectedCountry) return false;

  const snake = DIMENSION_TO_SNAKE[dimension as Exclude<DimensionKey, never>];
  const entry = subscores.countries[selectedCountry];
  const block = entry?.[snake];
  if (!block) return false;

  const caption = document.createElement('div');
  caption.className = 'subscore-caption';
  caption.textContent = `Sub-indicators · assessed ${entry.date}`;
  container.appendChild(caption);

  for (const [key, label] of SUBSCORE_LABELS[snake]) {
    const value = block[key];
    if (value == null) continue;

    const line = document.createElement('div');
    line.className = 'subscore-line';

    const name = document.createElement('span');
    name.className = 'subscore-label';
    name.textContent = label;

    const track = document.createElement('span');
    track.className = 'subscore-track';
    const fill = document.createElement('span');
    fill.className = 'subscore-fill';
    fill.style.width = `${((value - 1) / 4) * 100}%`;
    track.appendChild(fill);

    const num = document.createElement('span');
    num.className = 'subscore-value';
    num.textContent = String(value);

    line.append(name, track, num);
    container.appendChild(line);
  }
  return container.children.length > 1;
}

function collapseAll(): void {
  expanded = null;
  document.querySelectorAll<HTMLElement>('.subscore-panel').forEach(p => { p.hidden = true; });
  document.querySelectorAll('.dimension-row').forEach(r => r.setAttribute('aria-expanded', 'false'));
}

export function initSubscores(): void {
  document.querySelectorAll<HTMLElement>('.dimension-row[data-dimension]').forEach(row => {
    row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', () => {
      const dimension = row.dataset.dimension as DimensionKey;
      const panel = panelFor(row);

      if (expanded === dimension) {
        collapseAll();
        return;
      }
      collapseAll();
      if (renderBreakdown(panel, dimension)) {
        panel.hidden = false;
        row.setAttribute('aria-expanded', 'true');
        expanded = dimension;
      }
    });
  });

  // New country: values change, so collapse rather than show stale data.
  on('selectedCountry', collapseAll);
}
