// Floating summary card on the map while a bloc is selected: member
// coverage, average, spread (how aligned the bloc is), and the
// highest / lowest scoring members as jump links.

import { getState, setState, on } from '../state/store';
import { computeBlocStats } from '../data/blocs';
import { ATTRIBUTE_LABELS } from '../constants';

// Map a 1–5 score to a percentage along the range track.
const pct = score => ((score - 1) / 4) * 100;

function memberLink(label, member) {
  const wrap = document.createElement('div');
  wrap.className = 'bloc-member-line';

  const tag = document.createElement('span');
  tag.className = 'bloc-member-tag';
  tag.textContent = label;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bloc-member-link';
  btn.textContent = `${member.name} (${member.score})`;
  btn.addEventListener('click', () => setState({ selectedCountry: member.name }));

  wrap.append(tag, btn);
  return wrap;
}

function render() {
  const card = document.getElementById('bloc-summary');
  if (!card) return;

  const { selectedBloc, blocsData, scoreData, currentAttribute } = getState();
  const bloc = selectedBloc && blocsData ? blocsData[selectedBloc] : null;

  if (!bloc) {
    card.hidden = true;
    card.replaceChildren();
    return;
  }

  const stats = computeBlocStats(bloc.members, scoreData, currentAttribute);
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
  close.addEventListener('click', () => setState({ selectedBloc: null }));

  header.append(title, close);
  card.appendChild(header);

  const coverage = document.createElement('div');
  coverage.className = 'bloc-summary-coverage';
  coverage.textContent = stats
    ? `${stats.scoredCount} of ${stats.memberCount} members scored`
    : `${bloc.members.length} members — no scores for this dimension`;
  card.appendChild(coverage);

  if (!stats) return;

  const dim = document.createElement('div');
  dim.className = 'bloc-summary-dim';
  dim.textContent = ATTRIBUTE_LABELS[currentAttribute] || currentAttribute;
  card.appendChild(dim);

  const statRow = document.createElement('div');
  statRow.className = 'bloc-summary-stats';
  for (const [label, value] of [['Average', stats.average], ['Spread (σ)', stats.stdDev]]) {
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
  const marker = document.createElement('div');
  marker.className = 'bloc-range-avg';
  marker.style.left = `${pct(stats.average)}%`;
  marker.title = `Average ${stats.average}`;
  track.append(fill, marker);
  card.appendChild(track);

  const ends = document.createElement('div');
  ends.className = 'bloc-range-ends';
  const lo = document.createElement('span');
  lo.textContent = '1';
  const hi = document.createElement('span');
  hi.textContent = '5';
  ends.append(lo, hi);
  card.appendChild(ends);

  card.appendChild(memberLink('Highest', stats.highest));
  if (stats.lowest.name !== stats.highest.name) {
    card.appendChild(memberLink('Lowest', stats.lowest));
  }
}

export function initBlocSummary() {
  on('selectedBloc', render);
  on('currentAttribute', render);
  render();
}
