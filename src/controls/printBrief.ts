// "Print brief": a one-to-two page reference entry for the selected
// country through the browser's print path, so Save as PDF needs no
// extra code. The panel already renders everything the brief needs;
// src/styles/_print.css restyles and reorders it while <body> carries
// the `print-brief` class.
//
// `beforeprint` fires for the panel button (window.print) and for
// Ctrl/Cmd+P alike, so one handler prepares both paths: it adds the
// body class, renders every sub-indicator block, and fills the citation
// and permanent-link lines. `afterprint` removes the class again.

import { getState } from '../state/store';
import type { AppState } from '../state/store';
import { maybeEl } from '../dom';
import { citationsFor } from './citation';
import { renderAllBreakdowns } from '../panel/subscores';

export const PRINT_BRIEF_CLASS = 'print-brief';

/**
 * The brief needs a selected country whose panel is on screen. The full
 * comparison view hides the panel, so the page prints as it is there.
 */
export function canPrintBrief(state: Pick<AppState, 'selectedCountry' | 'mainView'>): boolean {
  return state.selectedCountry != null && state.mainView !== 'comparison';
}

/**
 * The link a paper copy points back to: the country alone, plus the
 * timeline date when the brief shows a historical vintage. Filters,
 * score mode and theme describe the map view, not the entry. This is
 * the share URL; switch to /country/<slug>/ when static country pages
 * (PRD 04) exist.
 */
export function briefPermalink(base: string, country: string, timelineDate: string | null): string {
  const params = new URLSearchParams({ country });
  if (timelineDate) params.set('date', timelineDate);
  return `${base}?${params.toString()}`;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function prepare(): void {
  // The @page footer reads this string on every print, brief or not.
  document.documentElement.style.setProperty('--print-date', `"${isoToday()}"`);

  const state = getState();
  const { selectedCountry: country, timelineDate } = state;
  if (!country || !canPrintBrief(state)) return;

  document.body.classList.add(PRINT_BRIEF_CLASS);
  renderAllBreakdowns();

  const url = briefPermalink(window.location.origin + window.location.pathname, country, timelineDate);
  const citation = maybeEl('print-citation-text');
  if (citation) citation.textContent = citationsFor({ country, timelineDate, url }).apa;
  const link = maybeEl('print-permalink-text');
  if (link) link.textContent = url;
}

function restore(): void {
  document.body.classList.remove(PRINT_BRIEF_CLASS);
}

export function initPrintBrief(): void {
  // prepare() runs here as well as on beforeprint, so the body class is
  // in place before the dialog opens even if an engine lays out early.
  maybeEl<HTMLButtonElement>('print-brief-btn')?.addEventListener('click', () => {
    prepare();
    window.print();
  });
  window.addEventListener('beforeprint', prepare);
  window.addEventListener('afterprint', restore);
}
