import { getState, setState, on } from '../state/store';
import type { ConfidenceLevel } from '../state/store';
import { evidenceFacetCounts } from '../state/selectors';
import { el } from '../dom';
import { parseEvidenceFilter } from '../data/evidence';
import type { EvidenceFilter } from '../data/evidence';

const ALL_LEVELS: readonly ConfidenceLevel[] = ['high', 'medium', 'low'];

// Title fragments for the active-filter tooltip, one per narrowing facet.
const EVIDENCE_TITLE: Record<Exclude<EvidenceFilter, 'any'>, string> = {
  grounded: 'grounded evidence',
  search: 'search-only evidence',
};

// Why a narrowing Evidence option is disabled: no country's latest
// research pass has that kind of record yet.
const EVIDENCE_EMPTY_TITLE: Record<Exclude<EvidenceFilter, 'any'>, string> = {
  grounded: 'No country has a research record grounded in verified policy initiatives yet',
  search: 'No country has a search-only research record yet',
};

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
  const evidenceRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>('#filter-evidence input[type="radio"]')
  );

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
  // Evidence radios: 'any' is the default and the only value outside the
  // URL's vocabulary, so anything unparseable falls back to it.
  evidenceRadios.forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    setState({ filterEvidence: parseEvidenceFilter(r.value) ?? 'any' });
  }));

  // An Evidence option that would keep no country is disabled, with the
  // reason as its tooltip: until the first research run records evidence,
  // "Grounded" and "Search only" would empty the map. A deep-linked value
  // still applies (its radio shows checked); "Any" clears it.
  function updateEvidenceAvailability() {
    const counts = evidenceFacetCounts();
    for (const radio of evidenceRadios) {
      const facet = parseEvidenceFilter(radio.value);
      if (!facet || facet === 'any') continue;
      const label = radio.closest('label');
      if (label && label.dataset.title === undefined) label.dataset.title = label.title;
      const empty = counts[facet] === 0;
      radio.disabled = empty;
      if (label) label.title = empty ? EVIDENCE_EMPTY_TITLE[facet] : label.dataset.title ?? '';
    }
  }
  on('subscores', updateEvidenceAvailability);
  on('scoreData', updateEvidenceAvailability);
  updateEvidenceAvailability();

  // Reset affordance - a narrowed map greys most countries, and there
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
      filterConfidence: null, filterOfficialOnly: false, filterEvidence: 'any',
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
      filterEvidence,
    } = getState();
    const rangeActive = filterMin > 1 || filterMax < 5;
    const blocActive = !!selectedBloc;
    const confActive = filterConfidence != null;
    const evidenceActive = filterEvidence !== 'any';
    const active = rangeActive || blocActive || confActive || filterOfficialOnly || evidenceActive;
    btn.classList.toggle('has-filter', active);
    resetBtn.disabled = !active;
    const parts: string[] = [];
    if (rangeActive) parts.push(`scores ${filterMin}–${filterMax}`);
    if (blocActive) parts.push(blocsData?.[selectedBloc!]?.name || selectedBloc!);
    if (confActive) {
      parts.push(filterConfidence!.length > 0 ? `${filterConfidence!.join('/')} confidence` : 'no confidence level');
    }
    if (filterOfficialOnly) parts.push('official sources only');
    if (filterEvidence !== 'any') parts.push(EVIDENCE_TITLE[filterEvidence]);
    btn.title = active ? `Active filter: ${parts.join(' · ')}` : '';
  }

  // Keep the sliders and labels in sync when the range changes from
  // elsewhere (URL load, popstate, reset) - the input handler only covers
  // the user dragging the sliders themselves.
  function syncFromState() {
    const { filterMin, filterMax, filterConfidence, filterOfficialOnly, filterEvidence } = getState();
    if (parseFloat(minSlider.value) !== filterMin) minSlider.value = String(filterMin);
    if (parseFloat(maxSlider.value) !== filterMax) maxSlider.value = String(filterMax);
    minLabel.textContent = String(filterMin);
    maxLabel.textContent = String(filterMax);
    confBoxes.forEach(b => {
      b.checked = !filterConfidence || filterConfidence.includes(b.value as ConfidenceLevel);
    });
    officialBox.checked = filterOfficialOnly;
    evidenceRadios.forEach(r => { r.checked = r.value === filterEvidence; });
  }

  on('filterMin', () => { syncFromState(); updateActiveState(); });
  on('filterMax', () => { syncFromState(); updateActiveState(); });
  on('filterConfidence', () => { syncFromState(); updateActiveState(); });
  on('filterOfficialOnly', () => { syncFromState(); updateActiveState(); });
  on('filterEvidence', () => { syncFromState(); updateActiveState(); });
  on('selectedBloc', updateActiveState);
  on('blocsData', updateActiveState);
  syncFromState();
  updateActiveState();
}
