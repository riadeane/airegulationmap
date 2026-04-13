import { create } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { lineRadial, curveLinearClosed } from 'd3-shape';
import { ATTRIBUTE_LABELS } from '../constants.js';
import { COMPARISON_COLORS } from './colors.js';

// Axis order for the radar (6 axes). Keep averageScore first so the most
// prominent axis is the composite score.
export const RADAR_AXES = [
  'averageScore',
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

const SIZE = 380;
const MARGIN = 64;
const R = (SIZE - MARGIN * 2) / 2;
const CENTER = SIZE / 2;
const MAX_SCORE = 5;

function angleFor(i) {
  // 0 at top (-PI/2), going clockwise.
  return -Math.PI / 2 + (i / RADAR_AXES.length) * Math.PI * 2;
}

export function renderRadar(containerEl, countries, scoreData) {
  containerEl.replaceChildren();

  const svg = create('svg')
    .attr('viewBox', `0 0 ${SIZE} ${SIZE}`)
    .attr('role', 'img')
    .attr('aria-label', 'Radar chart comparing selected countries');

  const rScale = scaleLinear().domain([0, MAX_SCORE]).range([0, R]);

  // Grid rings: one polygon per integer score 1..5
  const gridGroup = svg.append('g').attr('class', 'radar-grid');
  for (let score = 1; score <= MAX_SCORE; score++) {
    const pts = RADAR_AXES.map((_, i) => {
      const angle = angleFor(i);
      const rr = rScale(score);
      return `${CENTER + rr * Math.cos(angle)},${CENTER + rr * Math.sin(angle)}`;
    }).join(' ');
    gridGroup.append('polygon')
      .attr('points', pts)
      .attr('fill', 'none')
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', score === MAX_SCORE ? 1 : 0.6);
  }

  // Axis lines + labels
  const axisGroup = svg.append('g').attr('class', 'radar-axes');
  RADAR_AXES.forEach((key, i) => {
    const angle = angleFor(i);
    const x2 = CENTER + R * Math.cos(angle);
    const y2 = CENTER + R * Math.sin(angle);
    axisGroup.append('line')
      .attr('x1', CENTER).attr('y1', CENTER)
      .attr('x2', x2).attr('y2', y2)
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 0.6);

    const lx = CENTER + (R + 18) * Math.cos(angle);
    const ly = CENTER + (R + 18) * Math.sin(angle);
    let anchor = 'middle';
    if (Math.cos(angle) > 0.2) anchor = 'start';
    else if (Math.cos(angle) < -0.2) anchor = 'end';
    axisGroup.append('text')
      .attr('x', lx)
      .attr('y', ly)
      .attr('text-anchor', anchor)
      .attr('dominant-baseline', 'middle')
      .attr('class', 'radar-axis-label')
      .text(ATTRIBUTE_LABELS[key] || key);
  });

  // One polygon per country
  const polyGen = lineRadial()
    .angle((_, i) => (i / RADAR_AXES.length) * Math.PI * 2)
    .radius(d => rScale(d))
    .curve(curveLinearClosed);

  const polyGroup = svg.append('g').attr('class', 'radar-polygons');
  countries.forEach((name, idx) => {
    const scores = scoreData[name] || {};
    const values = RADAR_AXES.map(k => (scores[k] == null ? 0 : scores[k]));
    const color = COMPARISON_COLORS[idx % COMPARISON_COLORS.length];
    const pathD = polyGen(values);
    polyGroup.append('path')
      .attr('d', pathD)
      .attr('transform', `translate(${CENTER}, ${CENTER})`)
      .attr('fill', color)
      .attr('fill-opacity', 0.18)
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round');

    // Points on vertices
    values.forEach((v, i) => {
      const angle = angleFor(i);
      const rr = rScale(v);
      polyGroup.append('circle')
        .attr('cx', CENTER + rr * Math.cos(angle))
        .attr('cy', CENTER + rr * Math.sin(angle))
        .attr('r', 2.5)
        .attr('fill', color);
    });
  });

  containerEl.appendChild(svg.node());

  // Accessibility: plain data table
  const table = document.createElement('table');
  table.className = 'radar-data-table';
  table.setAttribute('aria-label', 'Comparison scores');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  countries.forEach((name, idx) => {
    const th = document.createElement('th');
    th.textContent = name;
    th.style.color = COMPARISON_COLORS[idx % COMPARISON_COLORS.length];
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  RADAR_AXES.forEach(key => {
    const tr = document.createElement('tr');
    const labelTh = document.createElement('th');
    labelTh.scope = 'row';
    labelTh.textContent = ATTRIBUTE_LABELS[key] || key;
    tr.appendChild(labelTh);
    countries.forEach(name => {
      const td = document.createElement('td');
      const val = (scoreData[name] && scoreData[name][key]);
      td.textContent = val == null ? '—' : val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  containerEl.appendChild(table);
}
