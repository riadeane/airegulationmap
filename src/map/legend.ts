import { range } from 'd3-array';

import { ATTRIBUTES, INSUFFICIENT_EVIDENCE_LABEL } from '../constants';
import { getState } from '../state/store';
import { confidenceFallsBackAtDate } from '../state/selectors';
import { legendCaption } from '../data/meaning';
import { makeColorScale } from './ramp';

// The map legend (PRD 16): an HTML key laid over the map's bottom-right
// corner, so its text wraps at phone widths and its "What does this mean?"
// button is reachable by keyboard and assistive technology (the map SVG
// itself is one role="img"). It carries the ramp for the current lens, the
// two endpoints in words, the lens's question and what it does not claim,
// the "No data" key, the "Insufficient evidence" key (rubric v3.1, shown
// only while a country on the map is in that state) and the low-confidence
// hatch key.

export { makeColorScale } from './ramp';
export type { ColorScale } from './ramp';

// Whether any shown country is "insufficient evidence" on the current
// attribute (see setLegendInsufficient). Module state so a legend rebuilt
// later comes back in the same state.
let insufficientShown = false;

const FALLBACK_NOTE_TITLE =
  'History records no confidence for this date, so the hatch shows each '
  + "country's current confidence.";

function span(className: string, text = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}

/** Build the legend once, inside #map after the SVG. Idempotent. */
export function addLegend(): void {
  const host = document.getElementById('map');
  if (!host || host.querySelector('.map-legend')) {
    updateLegend();
    return;
  }

  const legend = document.createElement('div');
  legend.className = 'map-legend legend';
  legend.id = 'map-legend';
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', 'Map legend');

  const keys = document.createElement('div');
  keys.className = 'legend-keys';

  const uncertainty = document.createElement('div');
  uncertainty.className = 'legend-uncertainty';
  // Hatch swatch: the map's diagonal lines (--map-stroke at
  // --hatch-opacity, _legend.css) over a mid-ramp fill set below.
  const swatch = span('legend-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  uncertainty.append(swatch);
  const note = span('legend-label legend-uncertainty-note', '(current rating)');
  note.title = FALLBACK_NOTE_TITLE;
  uncertainty.append(span('legend-label', 'Hatched: low confidence'), note);

  const noData = document.createElement('div');
  noData.className = 'legend-nodata';
  noData.append(span('legend-nodata-dot'), span('legend-label', 'No data'));

  const insufficient = document.createElement('div');
  insufficient.className = 'legend-insufficient';
  insufficient.append(span('legend-insufficient-dot'), span('legend-label', INSUFFICIENT_EVIDENCE_LABEL));
  insufficient.hidden = !insufficientShown;

  keys.append(noData, insufficient, uncertainty);

  const ramp = document.createElement('div');
  ramp.className = 'legend-ramp';
  ramp.setAttribute('aria-hidden', 'true');

  const ends = document.createElement('div');
  ends.className = 'legend-ends';
  ends.append(span('legend-label legend-label-low'), span('legend-label legend-label-high'));

  const caption = document.createElement('p');
  caption.className = 'legend-caption';
  caption.append(span('legend-question'), ' ', span('legend-notclaim'));

  const explain = document.createElement('button');
  explain.type = 'button';
  explain.className = 'legend-explain';
  explain.textContent = 'What does this mean?';
  explain.setAttribute('aria-haspopup', 'dialog');
  // Opened by the delegated [data-explainer] listener (controls/helpOverlay.ts).
  explain.dataset.explainer = '';

  legend.append(keys, ramp, ends, caption, explain);
  host.appendChild(legend);
  updateLegend();
}

/**
 * Show the uncertainty key while "Show uncertainty" is on. While a past
 * date is shown and history records no confidence for it, the hatch uses
 * current confidence and a note says so.
 */
export function updateLegendUncertainty(): void {
  const key = document.querySelector<HTMLElement>('#map .legend-uncertainty');
  if (!key) return;
  const { showUncertainty } = getState();
  const fallback = showUncertainty && confidenceFallsBackAtDate();
  key.hidden = !showUncertainty;
  const note = key.querySelector<HTMLElement>('.legend-uncertainty-note');
  if (note) note.hidden = !fallback;
}

/** Show the "Insufficient evidence" key only while at least one country
 * on the map is in that state for the current attribute. */
export function setLegendInsufficient(show: boolean): void {
  insufficientShown = show;
  const key = document.querySelector<HTMLElement>('#map .legend-insufficient');
  if (key) key.hidden = !show;
}

/** Repaint the ramp and relabel the legend for the current lens and theme. */
export function updateLegend(): void {
  const legend = document.querySelector<HTMLElement>('#map .map-legend');
  if (!legend) return;
  const { currentAttribute } = getState();
  const meaning = ATTRIBUTES[currentAttribute];
  const scale = makeColorScale(currentAttribute);

  const stops = range(0, 1.0001, 0.1).map(t => `${scale(1 + t * 4)} ${Math.round(t * 100)}%`);
  legend.querySelector<HTMLElement>('.legend-ramp')!.style.background =
    `linear-gradient(to right, ${stops.join(', ')})`;
  legend.querySelector<HTMLElement>('.legend-swatch')?.style.setProperty('--swatch-fill', scale(3));
  legend.dataset.group = meaning.group;

  legend.querySelector('.legend-label-low')!.textContent = `1 ${meaning.low}`;
  legend.querySelector('.legend-label-high')!.textContent = `${meaning.high} 5`;
  const { question, notClaim } = legendCaption(currentAttribute);
  legend.querySelector('.legend-question')!.textContent = question;
  legend.querySelector('.legend-notclaim')!.textContent = notClaim;
  updateLegendUncertainty();
}

/** Kept for the map subscriptions: the labels follow the lens. */
export const updateLegendLabels = updateLegend;
