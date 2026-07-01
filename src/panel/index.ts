import { getState, setState, on } from '../state/store';
import { maybeEl } from '../dom';
import { renderScoreBar, renderAllDots } from './scores';
import { renderTextSections } from './sections';
import { renderChangelog } from './changelog';
import { highlightCountry, clearHighlight } from '../map/index';
import { toggleComparison } from '../state/interactions';
import { maturityRank, scoresAtDate } from '../state/selectors';
import { MAX_COMPARISON } from '../constants';
import { classifySources, formatSourcesForCopy } from '../data/sources';
import { writeClipboard } from '../controls/clipboard';

const CONFIDENCE_LABELS = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

type ConfidenceLevel = keyof typeof CONFIDENCE_LABELS;

function normalizeConfidence(raw: string | null | undefined): ConfidenceLevel | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return null;
}

// The bottom-sheet layout is active exactly when this media list matches
// (phone width OR a short touch viewport / landscape phone) — mirrors the
// CSS in _responsive.css.
function isSheetLayout(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)').matches;
}

// Element focused before the sheet took over, so focus can be handed back.
let sheetOpener: HTMLElement | null = null;

// Give the open sheet dialog semantics and move focus into it (mobile
// only). Non-modal — the map stays visible and tappable behind the peek,
// so we deliberately don't trap focus or `inert` the background.
function openSheetDialog(): void {
  const panel = document.getElementById('country-panel');
  if (!panel || !isSheetLayout()) return;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'country-name');
  sheetOpener = document.activeElement as HTMLElement | null;
  const name = document.getElementById('country-name');
  if (name) {
    name.setAttribute('tabindex', '-1');
    name.focus({ preventScroll: true });
  }
}

function closeSheetDialog(): void {
  const panel = document.getElementById('country-panel');
  if (panel) {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('aria-labelledby');
  }
  if (sheetOpener && document.contains(sheetOpener) && sheetOpener.offsetParent !== null) {
    sheetOpener.focus({ preventScroll: true });
  }
  sheetOpener = null;
}

// Drag-down-to-dismiss on the grab handle — the gesture the pill affords.
// A tap (no travel) closes via the button's click handler; a small drag
// springs back; a firm downward drag closes.
function initSheetDrag(): void {
  const grabber = document.getElementById('sheet-grabber');
  const panel = document.getElementById('country-panel');
  if (!grabber || !panel) return;
  let startY = 0;
  let dy = 0;
  let dragging = false;

  grabber.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!isSheetLayout()) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    panel.style.transition = 'none';
    grabber.setPointerCapture(e.pointerId);
  });
  grabber.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);   // downward only
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    panel.style.transform = '';
    // Suppress the click that follows a real drag so it doesn't
    // double-fire; only a firm downward drag dismisses.
    if (dy > 6) grabber.dataset.dragged = '1';
    if (dy > panel.offsetHeight * 0.3) setState({ selectedCountry: null });
  };
  grabber.addEventListener('pointerup', end);
  grabber.addEventListener('pointercancel', end);
}

function updateDimensionHighlight(): void {
  const { currentAttribute } = getState();
  document.querySelectorAll<HTMLElement>('.dimension-row[data-dimension]').forEach(row => {
    row.classList.toggle('active-dimension', row.dataset.dimension === currentAttribute);
  });
}

function updateCompareButton(): void {
  const btn = maybeEl<HTMLButtonElement>('compare-btn');
  if (!btn) return;
  const { selectedCountry, comparisonCountries } = getState();
  if (!selectedCountry) {
    btn.disabled = true;
    btn.textContent = '+ Compare';
    btn.title = '';
    return;
  }
  const inList = comparisonCountries.includes(selectedCountry);
  if (inList) {
    btn.disabled = false;
    btn.textContent = '− Remove from comparison';
    btn.title = '';
    btn.classList.add('in-comparison');
  } else {
    btn.classList.remove('in-comparison');
    const atCap = comparisonCountries.length >= MAX_COMPARISON;
    btn.disabled = atCap;
    btn.textContent = '+ Compare';
    btn.title = atCap ? `Maximum ${MAX_COMPARISON} countries` : '';
  }
}

function updateCiteButton(): void {
  const btn = maybeEl<HTMLButtonElement>('cite-btn');
  if (!btn) return;
  const { selectedCountry, comparisonCountries } = getState();
  const disabled = !selectedCountry && comparisonCountries.length === 0;
  btn.disabled = disabled;
  btn.title = disabled ? 'Select a country first' : '';
}

// Maturity-index rank among countries with a composite score. The ranking is
// derived once per data load by the memoized selector, not recomputed on every
// panel render.
function renderRank(countryName: string): void {
  const el = document.getElementById('maturity-rank');
  if (!el) return;
  const result = maturityRank(countryName);
  el.textContent = result ? `Rank ${result.rank} of ${result.total}` : '';
}

// Score bar, dots, and rank — split from renderPanel because the timeline
// re-renders just these. While the timeline is scrubbed to a historical
// date, the panel shows that date's snapshot (the same vintage the map is
// painting) instead of silently disagreeing with it. Prose, sources, and
// sub-indicators have no historical record, so a notice says exactly what
// the reader is looking at; rank is a latest-data derivation and hides.
function renderScores(countryName: string): void {
  const { scoreData, timelineDate } = getState();
  const historical = timelineDate != null;
  const entry = historical
    ? scoresAtDate()?.[countryName] ?? null
    : scoreData[countryName] ?? null;

  renderScoreBar(entry ? entry.averageScore : null);
  renderAllDots(entry);

  if (historical) {
    const rankEl = document.getElementById('maturity-rank');
    if (rankEl) rankEl.textContent = '';
  } else {
    renderRank(countryName);
  }

  const notice = document.getElementById('panel-history-notice');
  if (notice) {
    notice.hidden = !historical;
    const dateEl = document.getElementById('panel-history-date');
    if (dateEl && timelineDate) dateEl.textContent = timelineDate;
  }
}

function renderPanel(countryName: string): void {
  const { scoreData, regulationData, mainView } = getState();
  const score = scoreData[countryName];
  const reg = regulationData[countryName];
  const comparisonOpen = mainView === 'comparison';

  // The full comparison view owns the main area; don't reveal the
  // single-country panel underneath it. While merely staging a set
  // (view closed), the panel stays usable so the user keeps browsing.
  if (!comparisonOpen) {
    const fallback = document.getElementById('no-selection-message');
    if (fallback) fallback.hidden = true;
    document.getElementById('panel-content')!.style.display = '';
  }

  document.getElementById('country-name')!.textContent = countryName;

  const badge = document.getElementById('confidence-badge')!;
  const level = normalizeConfidence(reg && reg.confidence);
  if (level) {
    badge.textContent = CONFIDENCE_LABELS[level];
    badge.setAttribute('data-level', level);
    badge.style.display = 'inline-flex';
    badge.title = level === 'low'
      ? 'Sparse public information; treat as indicative.'
      : level === 'medium'
      ? 'Based on a mix of primary and secondary sources.'
      : 'Supported by enacted legislation and recent primary sources.';
  } else {
    badge.style.display = 'none';
    badge.removeAttribute('data-level');
    badge.removeAttribute('title');
  }

  const dateStr = (score && score.lastUpdated) || (reg && reg.lastUpdated);
  const sources = classifySources(reg?.sources);
  const officialCount = sources.filter(s => s.kind === 'official').length;
  const countText = sources.length > 0
    ? `${sources.length} source${sources.length === 1 ? '' : 's'}`
      + (officialCount > 0 ? ` · ${officialCount} official` : '')
    : 'no primary sources';
  document.getElementById('last-updated')!.textContent = dateStr
    ? `Data as of ${dateStr} · ${countText}`
    : countText;

  renderScores(countryName);
  updateDimensionHighlight();
  renderTextSections(reg);
  renderChangelog(countryName);
  highlightCountry(countryName);
  updateCompareButton();
  updateCiteButton();

  // On phones the panel is a bottom sheet layered over the map. Selecting
  // a country slides it up (the transition lives in CSS); on desktop the
  // class is inert. Skip while the full comparison view owns the screen.
  if (!comparisonOpen) {
    // Reset to the top for every fresh country — otherwise, after
    // scrolling one country's sheet/panel, the next selection opens
    // mid-content with the name and score off-screen. renderPanel only
    // runs on a selection change, so this never clobbers a deliberate
    // scroll mid-read.
    document.getElementById('country-panel')?.scrollTo({ top: 0 });
    const wasOpen = document.body.classList.contains('sheet-open');
    document.body.classList.add('sheet-open');
    // Only take over focus on the initial open, not when switching
    // countries with the sheet already up (that would steal focus on
    // every tap).
    if (!wasOpen) openSheetDialog();
  }
}

function clearPanel(): void {
  const fallback = document.getElementById('no-selection-message');
  // Show the "select a country" fallback only once the onboarding intro
  // is gone. Until the user has selected their first country the intro
  // is still mounted (consumeIntro removes it), and stacking both reads
  // as a contradictory double empty-state — which a bare Esc (deselect
  // with nothing selected) would otherwise trigger.
  if (fallback) fallback.hidden = document.getElementById('panel-intro') !== null;
  document.getElementById('panel-content')!.style.display = 'none';
  // Slide the mobile bottom sheet back down (inert on desktop).
  document.body.classList.remove('sheet-open');
  closeSheetDialog();
  clearHighlight();
  updateCompareButton();
  updateCiteButton();
}

export function initPanel(): void {
  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      const { selectedCountry } = getState();
      if (selectedCountry) toggleComparison(selectedCountry);
    });
  }

  // Touch-equivalent of Esc — visible on coarse pointers only (CSS).
  const closeBtn = document.getElementById('panel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => setState({ selectedCountry: null }));
  }

  // The mobile bottom sheet's grab handle: tap (or keyboard) dismisses;
  // drag-down dismisses via initSheetDrag(). The dataset flag guards the
  // synthetic click that follows a real drag.
  const grabber = document.getElementById('sheet-grabber');
  if (grabber) {
    grabber.addEventListener('click', () => {
      if (grabber.dataset.dragged) { delete grabber.dataset.dragged; return; }
      setState({ selectedCountry: null });
    });
  }
  initSheetDrag();

  // An overlay view (scatter or comparison) takes over the map slot; drop the
  // mobile sheet out of the way when one opens so it doesn't sit on top.
  // Tapping a dot re-selects a country, which re-opens the sheet over scatter.
  on('mainView', (view) => {
    if (view !== 'map') document.body.classList.remove('sheet-open');
  });

  // Copy the full source list as a numbered, paste-ready block —
  // analysts move these into footnotes and research notes.
  const sourcesCopyBtn = maybeEl<HTMLButtonElement>('sources-copy');
  if (sourcesCopyBtn) {
    sourcesCopyBtn.addEventListener('click', async () => {
      const { selectedCountry, regulationData } = getState();
      if (!selectedCountry) return;
      const sources = classifySources(regulationData[selectedCountry]?.sources);
      if (sources.length === 0) return;
      const ok = await writeClipboard(formatSourcesForCopy(sources, selectedCountry));
      const original = 'Copy all';
      sourcesCopyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      setTimeout(() => { sourcesCopyBtn.textContent = original; }, 1500);
    });
  }

  on('selectedCountry', (countryName) => {
    if (countryName) {
      renderPanel(countryName);
    } else {
      clearPanel();
    }
  });

  on('currentAttribute', updateDimensionHighlight);
  on('comparisonCountries', () => { updateCompareButton(); updateCiteButton(); });

  // history.json arrives async — a URL-deep-linked country may already
  // be rendered by then, so backfill its changelog section.
  on('history', () => {
    const { selectedCountry } = getState();
    if (selectedCountry) renderChangelog(selectedCountry);
  });

  // The timeline scrubber re-vintages the open panel's scores so the panel
  // and the map always show the same date. Only the score block re-renders —
  // no scroll reset, no sheet re-open.
  on('timelineDate', () => {
    const { selectedCountry } = getState();
    if (selectedCountry) renderScores(selectedCountry);
  });
  updateCiteButton();

  let introConsumed = false;
  const consumeIntro = () => {
    if (introConsumed) return;
    const { selectedCountry, comparisonCountries } = getState();
    if (selectedCountry || (comparisonCountries && comparisonCountries.length > 0)) {
      introConsumed = true;
      const intro = document.getElementById('panel-intro');
      if (intro) intro.remove();
    }
  };
  on('selectedCountry', consumeIntro);
  on('comparisonCountries', consumeIntro);
}
