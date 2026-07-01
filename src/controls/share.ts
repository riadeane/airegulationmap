// Header "Share" popover — the citability affordance for ANY view, not
// just a selected country. The URL layer already serializes dimension,
// bloc, filter range, timeline date, scatter axes, comparison set, and
// committed search; this surfaces that permalink (plus formatted
// citations) where the panel's Cite button can't reach: before any
// selection, and for map-wide views like "Enforcement across the EU as
// of March".

import { getState, on } from '../state/store';
import { buildPermalink } from './url';
import { citationsFor } from './citation';
import type { Citations } from './citation';
import { writeClipboard } from './clipboard';
import { maybeEl } from '../dom';

const FORMATS: { key: keyof Citations; label: string }[] = [
  { key: 'apa', label: 'APA' },
  { key: 'chicago', label: 'Chicago' },
  { key: 'mla', label: 'MLA' },
];

function isOpen(popover: HTMLElement): boolean {
  return popover.classList.contains('open');
}

function render(popover: HTMLElement): void {
  const state = getState();
  popover.replaceChildren();

  const heading = document.createElement('p');
  heading.className = 'share-heading';
  heading.textContent = 'Link to this view';
  popover.appendChild(heading);

  const liveRegion = document.createElement('div');
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  popover.appendChild(liveRegion);

  const linkRow = document.createElement('div');
  linkRow.className = 'share-link-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'share-link-input';
  input.readOnly = true;
  input.value = buildPermalink(state);
  input.setAttribute('aria-label', 'Permalink for the current view');
  input.addEventListener('focus', () => input.select());

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'share-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    const ok = await writeClipboard(input.value);
    copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    liveRegion.textContent = ok ? 'Link copied to clipboard' : 'Copy failed';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
      liveRegion.textContent = '';
    }, 1500);
  });

  linkRow.append(input, copyBtn);
  popover.appendChild(linkRow);

  // Formatted citations for the same view — the permalink inside them
  // omits the theme (a display preference has no place in a footnote).
  const citeHeading = document.createElement('p');
  citeHeading.className = 'share-heading share-cite-heading';
  citeHeading.textContent = 'Cite this view';
  popover.appendChild(citeHeading);

  const citations = citationsFor({
    country: state.selectedCountry,
    compareCountries: state.comparisonCountries,
    mode: state.currentAttribute,
    timelineDate: state.timelineDate,
    url: buildPermalink(state, { omitTheme: true }),
  });

  for (const { key, label } of FORMATS) {
    const row = document.createElement('div');
    row.className = 'share-cite-row';

    const name = document.createElement('span');
    name.className = 'share-cite-format';
    name.textContent = label;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'share-cite-copy';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      const ok = await writeClipboard(citations[key]);
      btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      liveRegion.textContent = ok ? `${label} citation copied` : 'Copy failed';
      setTimeout(() => {
        btn.textContent = 'Copy';
        liveRegion.textContent = '';
      }, 1500);
    });

    row.append(name, btn);
    popover.appendChild(row);
  }
}

export function initShare(): void {
  const btn = maybeEl<HTMLButtonElement>('share-btn');
  const popover = maybeEl<HTMLElement>('share-popover');
  if (!btn || !popover) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = popover.classList.toggle('open');
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      render(popover);
      // Close the sibling header popovers — one open at a time.
      for (const [pid, bid] of [
        ['score-dropdown', 'score-btn'],
        ['filter-popover', 'filter-btn'],
        ['export-popover', 'export-btn'],
      ]) {
        document.getElementById(pid)?.classList.remove('open');
        const other = document.getElementById(bid);
        other?.classList.remove('active');
        other?.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // The permalink must always reflect what's on screen — refresh while open.
  const rerenderIfOpen = () => { if (isOpen(popover)) render(popover); };
  for (const key of [
    'selectedCountry', 'comparisonCountries', 'mainView', 'currentAttribute',
    'timelineDate', 'selectedBloc', 'filterMin', 'filterMax',
    'scatterX', 'scatterY', 'searchQuery',
  ] as const) {
    on(key, rerenderIfOpen);
  }
}
