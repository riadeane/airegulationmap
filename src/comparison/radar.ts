import { create } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { lineRadial, curveLinear, curveLinearClosed } from 'd3-shape';
import { ATTRIBUTES, GROUPS, attributesIn, isInsufficient } from '../constants';
import type { AttributeKey } from '../constants';
import type { ScoreData, ScoreEntry } from '../data/loader';
import { getColorFor } from './colorSlots';

// Axis order for the radar: the implementation lens only (the index first,
// then regulation status, policy lever, enforcement level), so a larger
// shape reads as "more in force". The governance style dimensions are
// descriptive (neither end is better) and would inflate the shape, so they
// get their own labelled strip below the radar (renderStyleStrip).
export const RADAR_AXES: AttributeKey[] = attributesIn('implementation');
export const STYLE_AXES: AttributeKey[] = attributesIn('style');

const SIZE = 480;
const MARGIN = 110;
const R = (SIZE - MARGIN * 2) / 2;
const CENTER = SIZE / 2;
const MAX_SCORE = 5;

/**
 * A country's radar values in RADAR_AXES order. An "insufficient evidence"
 * axis is null (the chart leaves a gap there instead of drawing it at the
 * centre, which would read as a score of 0); a missing value keeps the old
 * 0. Pure, for tests.
 */
export function radarValues(scores: Partial<ScoreEntry>): (number | null)[] {
  return RADAR_AXES.map(k => {
    const v = scores[k];
    if (isInsufficient(v)) return null;
    return v == null ? 0 : v;
  });
}

function angleFor(i: number): number {
  // 0 at top (-PI/2), going clockwise.
  return -Math.PI / 2 + (i / RADAR_AXES.length) * Math.PI * 2;
}

function renderRadarSvg(countries: readonly string[], scoreData: ScoreData): SVGSVGElement {
  const svg = create('svg')
    .attr('viewBox', `0 0 ${SIZE} ${SIZE}`)
    .attr('role', 'img')
    .attr('aria-label', 'Radar chart comparing how much is in force in the selected countries; the scores are in the table below');

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
    const text = axisGroup.append('text')
      .attr('x', lx)
      .attr('y', ly)
      .attr('text-anchor', anchor)
      .attr('dominant-baseline', 'middle')
      .attr('class', 'radar-axis-label');
    // Side axes break their label over two lines so it stays inside the
    // chart at phone widths ("Enforcement / Level").
    const words = ATTRIBUTES[key].label.split(' ');
    if (anchor !== 'middle' && words.length > 1) {
      const first = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      const rest = words.slice(Math.ceil(words.length / 2)).join(' ');
      text.append('tspan').attr('x', lx).attr('dy', '-0.55em').text(first);
      text.append('tspan').attr('x', lx).attr('dy', '1.1em').text(rest);
    } else {
      text.text(ATTRIBUTES[key].label);
    }
  });

  // One polygon per country
  const polyGen = lineRadial<number>()
    .angle((_, i) => (i / RADAR_AXES.length) * Math.PI * 2)
    .radius(d => rScale(d))
    .curve(curveLinearClosed);
  // With an insufficient-evidence axis the outline breaks on either side
  // of it: an open line through the axes in order, back to the first, with
  // undefined points skipped. There is no closed shape to fill.
  const gapGen = lineRadial<number | null>()
    .defined(d => d != null)
    .angle((_, i) => (i / RADAR_AXES.length) * Math.PI * 2)
    .radius(d => rScale(d ?? 0))
    .curve(curveLinear);

  const polyGroup = svg.append('g').attr('class', 'radar-polygons');
  countries.forEach((name) => {
    const scores: Partial<ScoreEntry> = scoreData[name] || {};
    const values = radarValues(scores);
    const complete = values.every((v): v is number => v != null);
    const color = getColorFor(name);
    // The gap path repeats the first axis at the end (angle 2π) so the
    // segment from the last axis back to the first is drawn when both exist.
    const pathD = complete ? polyGen(values) : gapGen([...values, values[0]]);
    // Inline styles, not presentation attributes, so the var() colour
    // resolves (and follows a theme switch) in every engine.
    polyGroup.append('path')
      .attr('d', pathD)
      .attr('transform', `translate(${CENTER}, ${CENTER})`)
      .style('fill', complete ? color : 'none')
      .attr('fill-opacity', 0.18)
      .style('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round');

    // Points on vertices (none on an insufficient-evidence axis)
    values.forEach((v, i) => {
      if (v == null) return;
      const angle = angleFor(i);
      const rr = rScale(v);
      polyGroup.append('circle')
        .attr('cx', CENTER + rr * Math.cos(angle))
        .attr('cy', CENTER + rr * Math.sin(angle))
        .attr('r', 2.5)
        .style('fill', color);
    });
  });

  return svg.node()!;
}

// Governance style as positions on a line: one track per descriptive
// dimension, each country a dot in its comparison colour. A position, not
// a length, so nothing reads as "more".
function renderStyleStrip(countries: readonly string[], scoreData: ScoreData): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'style-strip';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', `${GROUPS.style.label}: ${GROUPS.style.caption}`);

  const head = document.createElement('p');
  head.className = 'style-strip-head';
  const title = document.createElement('span');
  title.className = 'style-strip-title';
  title.textContent = GROUPS.style.label;
  const caption = document.createElement('span');
  caption.className = 'style-strip-caption';
  caption.textContent = GROUPS.style.caption;
  head.append(title, ' ', caption);
  strip.appendChild(head);

  for (const key of STYLE_AXES) {
    const meaning = ATTRIBUTES[key];
    const row = document.createElement('div');
    row.className = 'style-strip-row';

    const label = document.createElement('span');
    label.className = 'style-strip-label';
    label.textContent = meaning.label;

    const track = document.createElement('div');
    track.className = 'style-strip-track';
    // Screen readers get the numbers from the table below.
    track.setAttribute('aria-hidden', 'true');
    countries.forEach((name, i) => {
      const value = scoreData[name]?.[key];
      if (value == null) return;
      const dot = document.createElement('span');
      dot.className = 'style-strip-dot';
      dot.style.left = `${((value - 1) / 4) * 100}%`;
      dot.style.setProperty('--dot-color', getColorFor(name));
      // Countries on the same value stack upwards a little, so none hides.
      dot.style.setProperty('--stack', String(
        countries.slice(0, i).filter(n => scoreData[n]?.[key] === value).length
      ));
      dot.title = `${name}: ${value}`;
      track.appendChild(dot);
    });

    const ends = document.createElement('div');
    ends.className = 'style-strip-ends';
    const lo = document.createElement('span');
    lo.textContent = `1 ${meaning.low}`;
    const hi = document.createElement('span');
    hi.textContent = `${meaning.high} 5`;
    ends.append(lo, hi);

    row.append(label, track, ends);
    strip.appendChild(row);
  }
  return strip;
}

export function renderRadar(containerEl: Element, countries: readonly string[], scoreData: ScoreData): void {
  containerEl.replaceChildren();

  const head = document.createElement('p');
  head.className = 'style-strip-head radar-head';
  const title = document.createElement('span');
  title.className = 'style-strip-title';
  title.textContent = GROUPS.implementation.label;
  const caption = document.createElement('span');
  caption.className = 'style-strip-caption';
  caption.textContent = GROUPS.implementation.caption;
  head.append(title, ' ', caption);

  containerEl.append(head, renderRadarSvg(countries, scoreData), renderStyleStrip(countries, scoreData));
  // The numeric scores live in the unified comparison table below the
  // chart (renderComparisonTable), which is a real <table> and serves
  // the accessibility role this chart needs - no separate data table.
}
