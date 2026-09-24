// Evidence coverage line in the panel header (PRD 14): one factual sentence
// under "Data as of ..." saying how many verified policy initiatives
// grounded the latest research pass and whether the model had web search.
// The record arrives with subscores.json (after first paint); a country
// without one shows nothing.
//
// The words "verified policy initiative(s)" link to the Policy Initiatives
// section, but only while that section is showing for this country. The
// section is Supabase progressive enhancement (initiatives.ts), so without
// it the words stay plain text rather than pointing at nothing;
// initiatives.ts calls renderEvidence() whenever the section's visibility
// changes.

import { getState } from '../state/store';
import { maybeEl } from '../dom';
import { evidenceOf } from '../state/selectors';
import { evidenceSentence } from '../data/evidence';

const SECTION_ID = 'initiatives-section';

/** The Policy Initiatives section, when it is showing rows for `country`. */
function initiativesSectionFor(country: string): HTMLElement | null {
  const section = document.getElementById(SECTION_ID);
  if (!section || section.style.display === 'none') return null;
  return section.dataset.country === country ? section : null;
}

// Scroll to the section and move focus there. The hash stays out of the
// URL: url.ts owns the query string, and a #fragment would outlive the
// selection it pointed into.
function jumpToInitiatives(event: MouseEvent): void {
  event.preventDefault();
  const { selectedCountry } = getState();
  const section = selectedCountry ? initiativesSectionFor(selectedCountry) : null;
  if (!section) return;
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  if (!section.hasAttribute('tabindex')) section.setAttribute('tabindex', '-1');
  section.focus({ preventScroll: true });
}

/**
 * Render #evidence-coverage for the selected country. Reads the current
 * selection and the section's current state, so a call made on behalf of a
 * superseded selection (a late initiatives fetch) renders the right entry.
 */
export function renderEvidence(): void {
  const el = maybeEl('evidence-coverage');
  if (!el) return;
  const { selectedCountry } = getState();
  const record = selectedCountry ? evidenceOf(selectedCountry) : null;
  if (!selectedCountry || !record) {
    el.hidden = true;
    el.replaceChildren();
    el.removeAttribute('title');
    return;
  }

  const sentence = evidenceSentence(record);
  if (sentence.link && initiativesSectionFor(selectedCountry)) {
    const a = document.createElement('a');
    a.href = `#${SECTION_ID}`;
    a.className = 'evidence-initiatives-link';
    a.textContent = sentence.link;
    a.addEventListener('click', jumpToInitiatives);
    el.replaceChildren(sentence.before, a, sentence.after);
  } else {
    el.textContent = sentence.text;
  }

  if (record.model) el.title = `Researched with ${record.model}`;
  else el.removeAttribute('title');
  el.hidden = false;
}
