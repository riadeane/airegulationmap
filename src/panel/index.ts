import { getState, setState, on } from '../state/store';
import { renderScoreBar, renderAllDots } from './scores';
import { renderTextSections } from './sections';
import { renderChangelog } from './changelog';
import { highlightCountry, clearHighlight } from '../map/index';
import { toggleComparison, MAX_COMPARISON } from '../comparison/index';
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

function updateDimensionHighlight(): void {
  const { currentAttribute } = getState();
  document.querySelectorAll<HTMLElement>('.dimension-row[data-dimension]').forEach(row => {
    row.classList.toggle('active-dimension', row.dataset.dimension === currentAttribute);
  });
}

function updateCompareButton(): void {
  const btn = document.getElementById('compare-btn') as HTMLButtonElement | null;
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
  const btn = document.getElementById('cite-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const { selectedCountry, comparisonCountries } = getState();
  const disabled = !selectedCountry && comparisonCountries.length === 0;
  btn.disabled = disabled;
  btn.title = disabled ? 'Select a country first' : '';
}

// Maturity-index rank among countries with a composite score. Ties
// share a rank (strictly-higher count + 1).
function renderRank(countryName: string): void {
  const el = document.getElementById('maturity-rank');
  if (!el) return;
  const { scoreData } = getState();
  const mine = scoreData[countryName]?.averageScore;
  if (mine == null) {
    el.textContent = '';
    return;
  }
  const scored = Object.values(scoreData)
    .map(d => d.averageScore)
    .filter((v): v is number => v != null);
  const rank = scored.filter(v => v > mine).length + 1;
  el.textContent = `Rank ${rank} of ${scored.length}`;
}

function renderPanel(countryName: string): void {
  const { scoreData, regulationData, comparisonViewOpen } = getState();
  const score = scoreData[countryName];
  const reg = regulationData[countryName];

  // The full comparison view owns the main area; don't reveal the
  // single-country panel underneath it. While merely staging a set
  // (view closed), the panel stays usable so the user keeps browsing.
  if (!comparisonViewOpen) {
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

  renderScoreBar(score ? score.averageScore : null);
  renderRank(countryName);
  renderAllDots(score);
  updateDimensionHighlight();
  renderTextSections(reg);
  renderChangelog(countryName);
  highlightCountry(countryName);
  updateCompareButton();
  updateCiteButton();

  // On phones the panel is a bottom sheet layered over the map. Selecting
  // a country slides it up (the transition lives in CSS); on desktop the
  // class is inert. Skip while the full comparison view owns the screen.
  if (!comparisonViewOpen) {
    // Reset to the top for every fresh country — otherwise, after
    // scrolling one country's sheet/panel, the next selection opens
    // mid-content with the name and score off-screen. renderPanel only
    // runs on a selection change, so this never clobbers a deliberate
    // scroll mid-read.
    document.getElementById('country-panel')?.scrollTo({ top: 0 });
    document.body.classList.add('sheet-open');
  }
}

function clearPanel(): void {
  const fallback = document.getElementById('no-selection-message');
  if (fallback) fallback.hidden = false;
  document.getElementById('panel-content')!.style.display = 'none';
  // Slide the mobile bottom sheet back down (inert on desktop).
  document.body.classList.remove('sheet-open');
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

  // The mobile bottom sheet's grab handle also dismisses the sheet.
  const grabber = document.getElementById('sheet-grabber');
  if (grabber) {
    grabber.addEventListener('click', () => setState({ selectedCountry: null }));
  }

  // The scatter explorer takes over the map slot; drop the sheet out of
  // the way when it opens so it doesn't sit on top of the plot. Tapping a
  // dot re-selects a country, which re-opens the sheet over the scatter.
  on('scatterOpen', (open) => {
    if (open) document.body.classList.remove('sheet-open');
  });

  // Copy the full source list as a numbered, paste-ready block —
  // analysts move these into footnotes and research notes.
  const sourcesCopyBtn = document.getElementById('sources-copy') as HTMLButtonElement | null;
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
