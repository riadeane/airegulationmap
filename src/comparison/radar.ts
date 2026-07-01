import { create } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { lineRadial, curveLinearClosed } from 'd3-shape';
import { ATTRIBUTE_LABELS } from '../constants';
import type { AttributeKey } from '../constants';
import type { ScoreData, ScoreEntry } from '../data/loader';
import { getColorFor } from './index';

// Axis order for the radar (6 axes). Keep averageScore first so the most
// prominent axis is the composite score.
export const RADAR_AXES: AttributeKey[] = [
  'averageScore',
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

const SIZE = 480;
const MARGIN = 110;
const R = (SIZE - MARGIN * 2) / 2;
const CENTER = SIZE / 2;
const MAX_SCORE = 5;

function angleFor(i: number): number {
  // 0 at top (-PI/2), going clockwise.
  return -Math.PI / 2 + (i / RADAR_AXES.length) * Math.PI * 2;
}

export function renderRadar(containerEl: Element, countries: readonly string[], scoreData: ScoreData): void {
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
  const polyGen = lineRadial<number>()
    .angle((_, i) => (i / RADAR_AXES.length) * Math.PI * 2)
    .radius(d => rScale(d))
    .curve(curveLinearClosed);

  const polyGroup = svg.append('g').attr('class', 'radar-polygons');
  countries.forEach((name) => {
    const scores: Partial<ScoreEntry> = scoreData[name] || {};
    const values = RADAR_AXES.map(k => (scores[k] == null ? 0 : scores[k]!));
    const color = getColorFor(name);
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

  containerEl.appendChild(svg.node()!);
  // The numeric scores live in the unified comparison table below the
  // chart (renderComparisonTable), which is a real <table> and serves
  // the accessibility role this chart needs — no separate data table.
}
