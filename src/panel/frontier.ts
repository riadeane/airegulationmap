// The panel's Frontier risk governance block (PRD 15): the score in the
// frontier ramp, the track in words, the four sub-indicators with what
// each level means (or "Not applicable" / "Insufficient evidence", never a
// 1), their rationales, the EU-level and computed notes, then the frontier
// text and its sources. Hidden for a country never scored on the lens.
//
// While the timeline shows a past date the score and the track follow that
// date's snapshot, which reads "no data" before the country's first
// frontier snapshot. History keeps no sub-indicators, so they step aside
// on a past date, as the dimension breakdowns lock (panel/subscores.ts);
// the text and sources stay the latest, as the panel notice says.

import { getState } from '../state/store';
import { scoresAtDate } from '../state/selectors';
import {
  ATTRIBUTE_LABELS, COMPUTED_NOTE, EU_LEVEL_LABEL, EU_LEVEL_NOTE, FRONTIER_CAP_SENTENCE, FRONTIER_SUBINDICATORS,
  FRONTIER_SUBINDICATOR_KEYS, FRONTIER_TRACKS, isInsufficient, isNotApplicable, parseFrontierTrack,
} from '../constants';
import type { FrontierTrack } from '../constants';
import { frontierCellValue, levelMeaning } from '../data/meaning';
import { classifySources } from '../data/sources';
import type { FrontierBlock } from '../data/subscores';
import { makeColorScale } from '../map/ramp';
import { renderDots } from './scores';
import { renderSources } from './sections';
import { cleanRegulationText } from './normalize';

function paragraph(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

// "Frontier host track." then what the track means and how the score is built.
function renderTrack(container: HTMLElement, track: FrontierTrack | null): void {
  container.replaceChildren();
  container.hidden = track == null;
  if (!track) return;
  const label = document.createElement('span');
  label.className = 'frontier-track-label';
  label.textContent = `${FRONTIER_TRACKS[track].label} track.`;
  container.append(label, ` ${FRONTIER_TRACKS[track].description} ${FRONTIER_CAP_SENTENCE}`);
}

function renderSubindicators(container: HTMLElement, block: FrontierBlock): void {
  const caption = document.createElement('div');
  caption.className = 'subscore-caption';
  caption.textContent = block.date ? `Sub-indicators · assessed ${block.date}` : 'Sub-indicators';
  // The print brief names the block's dimension in its caption.
  caption.dataset.dimension = ATTRIBUTE_LABELS.frontierRisk;
  container.appendChild(caption);

  for (const key of FRONTIER_SUBINDICATOR_KEYS) {
    const cell = block[key];
    if (!cell) continue;
    const value = cell.score;

    const line = document.createElement('div');
    line.className = 'subscore-line';
    line.dataset.subindicator = key;
    const row = document.createElement('div');
    row.className = 'subscore-row';

    const name = document.createElement('span');
    name.className = 'subscore-label';
    name.textContent = FRONTIER_SUBINDICATORS[key].label;
    if (cell.eu_level) {
      const flag = document.createElement('span');
      flag.className = 'source-tag subscore-flag';
      flag.textContent = EU_LEVEL_LABEL;
      name.append(' ', flag);
    }

    if (isNotApplicable(value) || isInsufficient(value)) {
      // Words, no track: an empty track would read as a 1.
      const words = document.createElement('span');
      words.className = `subscore-value ${isNotApplicable(value) ? 'subscore-na' : 'subscore-insufficient'}`;
      words.textContent = frontierCellValue(value);
      row.append(name, words);
    } else {
      const track = document.createElement('span');
      track.className = 'subscore-track';
      const fill = document.createElement('span');
      fill.className = 'subscore-fill';
      fill.style.width = `${((value - 1) / 4) * 100}%`;
      track.appendChild(fill);
      const num = document.createElement('span');
      num.className = 'subscore-value';
      num.textContent = frontierCellValue(value);
      row.append(name, track, num);
    }
    line.appendChild(row);

    if (typeof value === 'number') {
      const meaning = levelMeaning('frontier', key, value);
      if (meaning) line.appendChild(paragraph('subscore-meaning', `${value}: ${meaning}`));
    }
    if (cell.eu_level) line.appendChild(paragraph('subscore-meaning', EU_LEVEL_NOTE));
    if (cell.computed) line.appendChild(paragraph('subscore-meaning', COMPUTED_NOTE));
    if (cell.rationale) line.appendChild(paragraph('subscore-rationale', cell.rationale));
    container.appendChild(line);
  }
}

/** True when the country has anything to show on the frontier lens. */
export function hasFrontierEntry(countryName: string): boolean {
  const { scoreData, regulationData, subscores } = getState();
  const reg = regulationData[countryName];
  return scoreData[countryName]?.frontierTrack != null
    || subscores?.countries[countryName]?.frontier != null
    || !!reg?.frontierRisk
    || !!reg?.frontierSources;
}

/** Render (or hide) the block for the selected country. */
export function renderFrontier(countryName: string): void {
  const section = document.getElementById('frontier-section');
  if (!section) return;
  const show = hasFrontierEntry(countryName);
  section.hidden = !show;
  if (!show) return;

  const { scoreData, regulationData, subscores, sourceMeta, timelineDate } = getState();
  const block = subscores?.countries[countryName]?.frontier ?? null;
  // scoresAtDate() is null at Latest and for a date history does not know,
  // where the map shows the latest data too.
  const snapshots = timelineDate ? scoresAtDate() : null;
  const historical = snapshots != null;
  const entry = historical ? snapshots[countryName] : scoreData[countryName];
  const score = entry?.frontierRisk;
  const track = parseFrontierTrack(entry?.frontierTrack) ?? (historical ? null : block?.track ?? null);

  const dots = document.getElementById('dots-frontier');
  if (dots && score === undefined) {
    // No frontier score here (a date before the lens): words, not empty dots.
    dots.replaceChildren();
    dots.classList.add('dim-dots-note');
    dots.textContent = historical ? 'No data on this date' : 'No data';
  } else {
    const scale = makeColorScale('frontierRisk');
    renderDots('dots-frontier', score, v => scale(v));
  }

  const trackEl = document.getElementById('frontier-track');
  if (trackEl) renderTrack(trackEl, track);

  const subs = document.getElementById('frontier-subscores');
  if (subs) {
    subs.replaceChildren();
    subs.hidden = historical || !block;
    if (!subs.hidden && block) renderSubindicators(subs, block);
  }

  const reg = regulationData[countryName];
  const text = cleanRegulationText(reg?.frontierRisk);
  const details = document.getElementById('frontier-details');
  if (details) {
    details.textContent = text ?? '';
    details.hidden = !text;
  }

  const sources = classifySources(reg?.frontierSources);
  const sourcesWrap = document.getElementById('frontier-sources');
  const list = document.getElementById('frontier-sources-list');
  if (sourcesWrap && list) {
    renderSources(list, sources, sourceMeta);
    sourcesWrap.hidden = sources.length === 0;
  }
}
