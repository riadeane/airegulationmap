// Floating summary card on the map while a bloc is selected: member
// coverage, the share of members grounded in verified policy initiatives,
// average, spread (how aligned the bloc is), and the members at each end of
// the scale as jump links, labelled in the lens's own words ("Most in
// force", "Most centralised"), never as best or worst (PRD 16).

import { getState, on } from '../state/store';
import { selectBloc, selectCountry } from '../state/interactions';
import { evidenceOf, scoresAtDate } from '../state/selectors';
import {
  computeBlocStats, computeBlocEvidenceShare, blocEvidenceShareText, countInsufficient, blocCoverageText,
} from '../data/blocs';
import type { BlocMemberScore } from '../data/blocs';
import { ATTRIBUTES } from '../constants';
import { blocExtremes } from '../data/meaning';
import { makeColorScale } from '../map/ramp';
import { onThemeChange } from '../map/cssColors';

// Map a 1–5 score to a percentage along the range track.
const pct = (score: number) => ((score - 1) / 4) * 100;

function memberLink(label: string, member: BlocMemberScore): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'bloc-member-line';

  const tag = document.createElement('span');
  tag.className = 'bloc-member-tag';
  tag.textContent = label;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bloc-member-link';
  btn.textContent = `${member.name} (${member.score})`;
  btn.addEventListener('click', () => selectCountry(member.name));

  wrap.append(tag, btn);
  return wrap;
}

function render() {
  const card = document.getElementById('bloc-summary');
  if (!card) return;

  const { selectedBloc, blocsData, scoreData, currentAttribute, timelineDate } = getState();
  const bloc = selectedBloc && blocsData ? blocsData[selectedBloc] : null;

  if (!bloc) {
    card.hidden = true;
    card.replaceChildren();
    return;
  }

  // The vintage the map is painting: a scrubbed timeline date's snapshot,
  // else the latest rows (scoresAtDate() is null for Latest).
  const past = scoresAtDate();
  const stats = computeBlocStats(bloc.members, past ?? scoreData, currentAttribute);
  const insufficient = countInsufficient(bloc.members, past ?? scoreData, currentAttribute);
  card.replaceChildren();
  card.hidden = false;

  const header = document.createElement('div');
  header.className = 'bloc-summary-header';

  const title = document.createElement('span');
  title.className = 'bloc-summary-title';
  title.textContent = bloc.name;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bloc-summary-close';
  close.setAttribute('aria-label', 'Clear bloc filter');
  close.textContent = '×';
  close.addEventListener('click', () => selectBloc(null));

  header.append(title, close);
  card.appendChild(header);

  const coverage = document.createElement('div');
  coverage.className = 'bloc-summary-coverage';
  coverage.textContent = blocCoverageText(bloc.members.length, stats?.scoredCount ?? 0, insufficient);
  card.appendChild(coverage);

  // Independent of the current dimension, so it renders before the
  // no-scores early return below.
  const evidence = computeBlocEvidenceShare(bloc.members, evidenceOf);
  if (evidence) {
    const line = document.createElement('div');
    line.className = 'bloc-summary-evidence';
    line.textContent = blocEvidenceShareText(evidence);
    card.appendChild(line);
  }

  if (!stats) return;

  const dim = document.createElement('div');
  dim.className = 'bloc-summary-dim';
  const label = ATTRIBUTES[currentAttribute].label;
  dim.textContent = past && timelineDate ? `${label} · as of ${timelineDate}` : label;
  card.appendChild(dim);

  const statRow = document.createElement('div');
  statRow.className = 'bloc-summary-stats';
  for (const [label, value] of [['Average', stats.average], ['Spread (σ)', stats.stdDev]] as [string, number][]) {
    const cell = document.createElement('div');
    cell.className = 'bloc-stat';
    const v = document.createElement('span');
    v.className = 'bloc-stat-value';
    v.textContent = String(value);
    const l = document.createElement('span');
    l.className = 'bloc-stat-label';
    l.textContent = label;
    cell.append(v, l);
    statRow.appendChild(cell);
  }
  card.appendChild(statRow);

  // Min–max range bar with the average marked.
  const track = document.createElement('div');
  track.className = 'bloc-range-track';
  const fill = document.createElement('div');
  fill.className = 'bloc-range-fill';
  fill.style.left = `${pct(stats.min)}%`;
  fill.style.width = `${pct(stats.max) - pct(stats.min)}%`;
  // The lens's own ramp between the bloc's two ends, as the map colours them.
  const scale = makeColorScale(currentAttribute);
  fill.style.background = `linear-gradient(to right, ${scale(stats.min)}, ${scale(stats.max)})`;
  const marker = document.createElement('div');
  marker.className = 'bloc-range-avg';
  marker.style.left = `${pct(stats.average)}%`;
  marker.title = `Average ${stats.average}`;
  track.append(fill, marker);
  card.appendChild(track);

  const ends = document.createElement('div');
  ends.className = 'bloc-range-ends';
  const { low, high } = ATTRIBUTES[currentAttribute];
  const lo = document.createElement('span');
  lo.textContent = `1 ${low}`;
  const hi = document.createElement('span');
  hi.textContent = `${high} 5`;
  ends.append(lo, hi);
  card.appendChild(ends);

  const extremes = blocExtremes(currentAttribute);
  card.appendChild(memberLink(extremes.high, stats.highest));
  if (stats.lowest.name !== stats.highest.name) {
    card.appendChild(memberLink(extremes.low, stats.lowest));
  }
}

export function initBlocSummary(): void {
  on('selectedBloc', render);
  on('currentAttribute', render);
  // Follow the timeline (and the history that resolves a ?date= vintage)
  // and a dataset replacement, like the map beneath the card.
  on('timelineDate', render);
  on('history', render);
  on('scoreData', render);
  // Evidence records arrive with subscores.json, possibly after the card.
  on('subscores', render);
  // The range bar carries colours resolved from the ramp.
  onThemeChange(render);
  render();
}
