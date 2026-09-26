// The drift dashboard's small multiples (drift.html). Each render function
// draws one figure into a host element with D3 and returns the legend
// entries the page lists beside it, so the swatches always match the
// marks. Colours come from the app's tokens at render time (cssVar), never
// from literals: a single-hue ramp off the map legend's high pole for
// ordered series and the neutral tints for everything else. The page
// re-renders on theme change and resize.
//
// Marks follow one spec: columns at most 24px wide with a 2px surface gap
// between stacked segments, 2px lines, 8px markers with a 2px surface
// ring, hairline solid gridlines. Text in the SVG wears text tokens via
// CSS classes (drift.html), so only fills need a re-render on theme change.

import { max } from 'd3-array';
import { lab } from 'd3-color';
import { interpolateLab } from 'd3-interpolate';
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import { select } from 'd3-selection';
import type { Selection } from 'd3-selection';
import { line as d3Line } from 'd3-shape';

import { cssVar } from '../map/cssColors';
import { hideTooltip, showTooltip } from '../map/tooltip';
import { formatSignedDelta } from '../data/changelog';
import {
  CONFIDENCE_LEVELS,
  DELTA_STEP,
  DIMENSIONS,
  WARN_WITHIN_ONE,
  binDeltas,
  dimensionLabel,
  percent,
  snakeDimensionLabel,
} from '../data/drift';
import type {
  BlocDrift,
  ConfidenceCohort,
  DriftCheck,
  WeekChanges,
} from '../data/drift';

// ---------------------------------------------------------------------------
// Palette: read once per render from the live tokens.

export interface Palette {
  dark: boolean;
  bg: string;
  surface: string;
  border: string;
  borderSubtle: string;
  noData: string;
  high: string;
  /** Single-hue ordinal ramp, darkest/most saturated first. */
  ramp: (n: number) => string[];
  /** Sequential fill for a magnitude in [0, 1]: neutral tint -> high pole. */
  sequential: (t: number) => string;
}

// Mix fraction toward the light neutral at the palest ramp step. Tuned so
// every step keeps a visible lightness gap and the pale end still clears
// 2:1 against the page in each theme (validated with the dataviz palette
// checker on the token values).
const RAMP_REACH_DARK = 0.85;
const RAMP_REACH_LIGHT = 0.55;

export function readPalette(): Palette {
  const bg = cssVar('--bg');
  const text = cssVar('--text-primary');
  const dark = lab(bg).l < 50;
  const toward = lab(bg).l > lab(text).l ? bg : text;
  const high = cssVar('--score-high');
  const rampInterp = interpolateLab(high, toward);
  const reach = dark ? RAMP_REACH_DARK : RAMP_REACH_LIGHT;
  const seqInterp = interpolateLab(cssVar('--border-subtle'), high);
  return {
    dark,
    bg,
    surface: cssVar('--surface'),
    border: cssVar('--border'),
    borderSubtle: cssVar('--border-subtle'),
    noData: cssVar('--no-data'),
    high,
    ramp: (n) => Array.from({ length: n }, (_, i) => rampInterp(n === 1 ? 0 : (i / (n - 1)) * reach)),
    sequential: (t) => seqInterp(Math.max(0, Math.min(1, t))),
  };
}

export interface LegendItem {
  label: string;
  color: string;
  /** 'swatch' for a fill, 'line' for a stroke, 'ramp' for a sequential bar. */
  kind: 'swatch' | 'line' | 'ramp';
  /** For 'ramp': the pale end's colour. */
  from?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-06-13' -> '13 Jun 2026' (captions, tooltips, tables). */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Axis label: '13 Jun', with a two-digit year when the axis spans years. */
function axisDate(iso: string, withYear: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const day = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
  return withYear ? `${day} ${m[1].slice(2)}` : day;
}

function spansYears(dates: string[]): boolean {
  return new Set(dates.map(d => d.slice(0, 4))).size > 1;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Svg = Selection<SVGSVGElement, unknown, null, undefined>;
type Group = Selection<SVGGElement, unknown, null, undefined>;

interface Frame {
  svg: Svg;
  plot: Group;
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
}

interface Margin { top: number; right: number; bottom: number; left: number }

const MAX_BAR = 24;
const GAP = 2;

function frame(host: HTMLElement, height: number, margin: Margin, label: string): Frame {
  host.replaceChildren();
  const width = Math.max(280, Math.floor(host.getBoundingClientRect().width) || 560);
  const svg = select(host).append<SVGSVGElement>('svg')
    .attr('class', 'chart-svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', label);
  const plot = svg.append<SVGGElement>('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  return {
    svg,
    plot,
    width,
    height,
    innerWidth: Math.max(10, width - margin.left - margin.right),
    innerHeight: Math.max(10, height - margin.top - margin.bottom),
  };
}

/** Horizontal hairline gridlines with tick labels on the left. */
function yGrid(
  f: Frame,
  y: (v: number) => number,
  ticks: number[],
  format: (v: number) => string
): void {
  const g = f.plot.append('g').attr('class', 'chart-grid');
  for (const t of ticks) {
    g.append('line')
      .attr('x1', 0).attr('x2', f.innerWidth)
      .attr('y1', y(t)).attr('y2', y(t))
      .attr('class', 'chart-gridline');
    g.append('text')
      .attr('class', 'chart-tick')
      .attr('x', -8).attr('y', y(t))
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(format(t));
  }
}

/** Clean integer ticks for a count axis: 0, step, 2·step … up to max. */
function countTicks(maxValue: number, target = 4): number[] {
  if (maxValue <= 0) return [0];
  const rough = maxValue / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue; v += step) ticks.push(v);
  return ticks;
}

/** Date labels under a band axis; every label when they fit, else thinned. */
function xDateLabels(f: Frame, x: (d: string) => number | undefined, bandwidth: number, dates: string[], marked: Set<string>): void {
  const withYear = spansYears(dates);
  const labelWidth = withYear ? 52 : 40;
  const every = Math.max(1, Math.ceil(labelWidth / Math.max(1, bandwidth + 6)));
  const g = f.plot.append('g').attr('class', 'chart-axis');
  g.append('line')
    .attr('x1', 0).attr('x2', f.innerWidth)
    .attr('y1', f.innerHeight).attr('y2', f.innerHeight)
    .attr('class', 'chart-axisline');
  dates.forEach((d, i) => {
    const cx = (x(d) ?? 0) + bandwidth / 2;
    if (i % every !== 0 && i !== dates.length - 1) return;
    g.append('text')
      .attr('class', 'chart-tick')
      .attr('x', cx).attr('y', f.innerHeight + 16)
      .attr('text-anchor', 'middle')
      .text(axisDate(d, withYear) + (marked.has(d) ? '*' : ''));
  });
}

function hover(sel: Selection<SVGElement, unknown, null, undefined>, html: () => string): void {
  sel
    .on('mouseenter', (event: MouseEvent) => showTooltip(event, html()))
    .on('mousemove', (event: MouseEvent) => showTooltip(event, html()))
    .on('mouseleave', () => hideTooltip());
}

/** A column segment: square at the baseline, 4px rounded top when `top`. */
function segmentPath(x: number, y: number, w: number, h: number, top: boolean): string {
  const r = top ? Math.min(4, w / 2, h) : 0;
  if (r === 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}h${-w}Z`;
}

// ---------------------------------------------------------------------------
// 1. Countries changed per run, stacked by the dimension that moved most.

export function renderChangesChart(host: HTMLElement, weeks: WeekChanges[], palette: Palette): LegendItem[] {
  const colors = palette.ramp(DIMENSIONS.length);
  const legend: LegendItem[] = DIMENSIONS.map((d, i) => ({ label: dimensionLabel(d), color: colors[i], kind: 'swatch' }));
  legend.push({ label: 'First scored', color: palette.noData, kind: 'swatch' });

  const f = frame(host, 260, { top: 18, right: 12, bottom: 36, left: 36 }, 'Countries changed per run, stacked by dimension');
  if (weeks.length === 0) return legend;

  const dates = weeks.map(w => w.date);
  const x = scaleBand<string>().domain(dates).range([0, f.innerWidth]).paddingInner(0.3).paddingOuter(0.15);
  const barWidth = Math.min(MAX_BAR, x.bandwidth());
  const offset = (x.bandwidth() - barWidth) / 2;
  const top = max(weeks, w => w.changed + w.firstScored) ?? 0;
  const y = scaleLinear().domain([0, Math.max(1, top)]).range([f.innerHeight, 0]).nice();

  yGrid(f, y, countTicks(y.domain()[1]), v => String(v));
  xDateLabels(f, x, x.bandwidth(), dates, new Set(weeks.filter(w => w.recalibration).map(w => w.date)));

  for (const week of weeks) {
    const x0 = (x(week.date) ?? 0) + offset;
    const segments: { label: string; count: number; color: string }[] = DIMENSIONS
      .map((d, i) => ({ label: dimensionLabel(d), count: week.byDimension[d], color: colors[i] }))
      .filter(s => s.count > 0);
    if (week.firstScored > 0) segments.push({ label: 'First scored', count: week.firstScored, color: palette.noData });

    let cum = 0;
    segments.forEach((s, i) => {
      const y1 = y(cum);
      const y0 = y(cum + s.count);
      const isTop = i === segments.length - 1;
      const h = Math.max(0, y1 - y0 - (isTop ? 0 : GAP));
      const seg = f.plot.append<SVGElement>('path')
        .attr('class', 'chart-mark')
        .attr('d', segmentPath(x0, y0, barWidth, h, isTop))
        .attr('fill', s.color);
      hover(seg, () =>
        `<strong>${escapeHtml(formatDate(week.date))}</strong>`
        + `${escapeHtml(s.label)}: <b>${s.count}</b> ${s.label === 'First scored' ? 'countries' : 'countries moved most here'}<br>`
        + `${week.changed} changed, ${week.firstScored} first scored`
        + (week.recalibration ? `<br>Recalibration: ${escapeHtml(week.recalibration)}` : ''));
      cum += s.count;
    });

    // The changed count rides the column top; a first-assessment-only run
    // has nothing to label (the grey column and its tooltip say what it is).
    if (x.bandwidth() >= 22 && week.changed > 0) {
      f.plot.append('text')
        .attr('class', 'chart-value')
        .attr('x', x0 + barWidth / 2)
        .attr('y', y(cum) - 5)
        .attr('text-anchor', 'middle')
        .text(week.changed);
    }
  }
  return legend;
}

// ---------------------------------------------------------------------------
// 2. Distribution of score deltas per run: a heat grid (run x quarter-point bin).

export function renderDeltaChart(host: HTMLElement, weeks: WeekChanges[], palette: Palette): LegendItem[] {
  const legend: LegendItem[] = [{ label: 'Moves in the bin', color: palette.high, from: palette.sequential(0.08), kind: 'ramp' }];
  const runs = weeks.filter(w => w.moves.length > 0);
  const bins = runs.map(w => ({ date: w.date, bins: binDeltas(w.moves), total: w.moves.length, recalibration: w.recalibration }));
  const allDeltas = bins.flatMap(b => b.bins.map(bin => bin.delta));
  const rowCount = allDeltas.length
    ? Math.round((Math.max(...allDeltas) - Math.min(...allDeltas)) / DELTA_STEP) + 1
    : 0;
  const rowHeight = rowCount > 14 ? 11 : 14;
  const height = Math.max(160, rowCount * rowHeight + 54);

  const f = frame(host, height, { top: 10, right: 12, bottom: 36, left: 44 }, 'Distribution of score deltas per run');
  if (runs.length === 0) return legend;

  const maxDelta = Math.max(...allDeltas);
  const minDelta = Math.min(...allDeltas);
  const rows: number[] = [];
  for (let v = maxDelta; v >= minDelta - 1e-9; v -= DELTA_STEP) {
    const r = Math.round(v / DELTA_STEP) * DELTA_STEP;
    if (Math.abs(r) > 1e-9) rows.push(r);
  }
  const dates = runs.map(r => r.date);
  const x = scaleBand<string>().domain(dates).range([0, f.innerWidth]).paddingInner(0.12).paddingOuter(0.06);
  const y = scaleBand<string>().domain(rows.map(String)).range([0, f.innerHeight]).paddingInner(0.14);
  const maxCount = max(bins, b => max(b.bins, bin => bin.count) ?? 0) ?? 1;

  // Row labels: every row when there is room, else half points and the extremes.
  const labelAll = rows.length <= 14;
  rows.forEach((r, i) => {
    const halfPoint = Math.abs((r * 2) - Math.round(r * 2)) < 1e-9;
    if (!labelAll && !halfPoint && i !== 0 && i !== rows.length - 1) return;
    f.plot.append('text')
      .attr('class', 'chart-tick')
      .attr('x', -8)
      .attr('y', (y(String(r)) ?? 0) + y.bandwidth() / 2)
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(formatSignedDelta(r));
  });

  // The zero line sits between the smallest positive and the largest negative row.
  const firstNegative = rows.find(r => r < 0);
  if (firstNegative !== undefined && rows.some(r => r > 0)) {
    const zy = (y(String(firstNegative)) ?? 0) - (y.step() - y.bandwidth()) / 2;
    f.plot.append('line')
      .attr('class', 'chart-axisline')
      .attr('x1', 0).attr('x2', f.innerWidth)
      .attr('y1', zy).attr('y2', zy);
  }

  xDateLabels(f, x, x.bandwidth(), dates, new Set(bins.filter(b => b.recalibration).map(b => b.date)));

  for (const run of bins) {
    const counts = new Map(run.bins.map(b => [b.delta, b.count]));
    for (const r of rows) {
      const count = counts.get(r) ?? 0;
      const cell = f.plot.append<SVGElement>('rect')
        .attr('class', 'chart-mark')
        .attr('x', x(run.date) ?? 0)
        .attr('y', y(String(r)) ?? 0)
        .attr('width', x.bandwidth())
        .attr('height', y.bandwidth())
        .attr('rx', 2)
        .attr('fill', count === 0 ? palette.surface : palette.sequential(0.08 + 0.92 * Math.sqrt(count / maxCount)));
      hover(cell, () =>
        `<strong>${escapeHtml(formatDate(run.date))}</strong>`
        + `${formatSignedDelta(r)}: <b>${count}</b> of ${run.total} moves`
        + (run.recalibration ? `<br>Recalibration: ${escapeHtml(run.recalibration)}` : ''));
    }
  }
  return legend;
}

// ---------------------------------------------------------------------------
// 3. Confidence by research vintage: 100% stacked columns.

export function renderConfidenceChart(host: HTMLElement, cohorts: ConfidenceCohort[], palette: Palette): LegendItem[] {
  const colors = palette.ramp(CONFIDENCE_LEVELS.length);
  const legend: LegendItem[] = CONFIDENCE_LEVELS.map((level, i) => ({
    label: `${level[0].toUpperCase()}${level.slice(1)} confidence`, color: colors[i], kind: 'swatch',
  }));

  const f = frame(host, 260, { top: 18, right: 12, bottom: 46, left: 40 }, 'Share of countries at each confidence level, by the run that last updated them');
  if (cohorts.length === 0) return legend;

  const dates = cohorts.map(c => c.date);
  const x = scaleBand<string>().domain(dates).range([0, f.innerWidth]).paddingInner(0.3).paddingOuter(0.15);
  const barWidth = Math.min(MAX_BAR, x.bandwidth());
  const offset = (x.bandwidth() - barWidth) / 2;
  const y = scaleLinear().domain([0, 1]).range([f.innerHeight, 0]);

  yGrid(f, y, [0, 0.25, 0.5, 0.75, 1], v => `${Math.round(v * 100)}%`);
  xDateLabels(f, x, x.bandwidth(), dates, new Set());

  for (const cohort of cohorts) {
    const x0 = (x(cohort.date) ?? 0) + offset;
    const cx = x0 + barWidth / 2;
    const segments = CONFIDENCE_LEVELS
      .map((level, i) => ({ level, count: cohort.counts[level], color: colors[i] }))
      .filter(s => s.count > 0);
    let cum = 0;
    segments.forEach((s, i) => {
      const share = s.count / cohort.total;
      const y1 = y(cum);
      const y0 = y(cum + share);
      const isTop = i === segments.length - 1;
      const h = Math.max(0, y1 - y0 - (isTop ? 0 : GAP));
      const seg = f.plot.append<SVGElement>('path')
        .attr('class', 'chart-mark')
        .attr('d', segmentPath(x0, y0, barWidth, h, isTop))
        .attr('fill', s.color);
      hover(seg, () =>
        `<strong>${escapeHtml(formatDate(cohort.date))}</strong>`
        + CONFIDENCE_LEVELS.map(level =>
          `${level}: <b>${cohort.counts[level]}</b> (${percent(cohort.counts[level], cohort.total)}%)`).join('<br>')
        + `<br>${cohort.total} ${cohort.total === 1 ? 'country' : 'countries'} last updated on this run`);
      cum += share;
    });

    if (x.bandwidth() >= 30) {
      f.plot.append('text')
        .attr('class', 'chart-value')
        .attr('x', cx).attr('y', -6)
        .attr('text-anchor', 'middle')
        .text(`${percent(cohort.counts.high, cohort.total)}% high`);
    }
    if (x.bandwidth() >= 22) {
      f.plot.append('text')
        .attr('class', 'chart-tick')
        .attr('x', cx).attr('y', f.innerHeight + 30)
        .attr('text-anchor', 'middle')
        .text(`n=${cohort.total}`);
    }
  }
  return legend;
}

// ---------------------------------------------------------------------------
// 4. Gold-set agreement per run: within-one share, then MAE per dimension.

const MAE_ROW = 30;

export function renderGoldChart(host: HTMLElement, checks: DriftCheck[], palette: Palette): LegendItem[] {
  const legend: LegendItem[] = [{ label: 'Within one point (share)', color: palette.high, kind: 'line' }];
  const dimensions = DIMENSIONS.map(d => d.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`));
  const topHeight = 150;
  const panelGap = 48;
  const height = 26 + topHeight + panelGap + dimensions.length * MAE_ROW + 8;
  const margin = { top: 26, right: 44, bottom: 8, left: 110 };
  const f = frame(host, height, margin, 'Gold-set agreement per run');
  if (checks.length === 0) return legend;

  const dates = checks.map(c => c.date);
  const x = scalePoint<string>().domain(dates).range([0, f.innerWidth]).padding(0.5);
  const withYear = spansYears(dates);

  // Panel A: within-one share.
  const a = f.plot.append<SVGGElement>('g');
  const yA = scaleLinear().domain([0, 1]).range([topHeight, 0]);
  const gridA = a.append('g');
  for (const t of [0, 0.5, 1]) {
    gridA.append('line').attr('class', 'chart-gridline')
      .attr('x1', 0).attr('x2', f.innerWidth).attr('y1', yA(t)).attr('y2', yA(t));
    gridA.append('text').attr('class', 'chart-tick')
      .attr('x', -8).attr('y', yA(t)).attr('dy', '0.32em').attr('text-anchor', 'end')
      .text(`${Math.round(t * 100)}%`);
  }
  a.append('line').attr('class', 'chart-threshold')
    .attr('x1', 0).attr('x2', f.innerWidth)
    .attr('y1', yA(WARN_WITHIN_ONE)).attr('y2', yA(WARN_WITHIN_ONE));
  a.append('text').attr('class', 'chart-tick')
    .attr('x', f.innerWidth + 6).attr('y', yA(WARN_WITHIN_ONE)).attr('dy', '0.32em')
    .text(`${Math.round(WARN_WITHIN_ONE * 100)}% floor`);
  a.append('text').attr('class', 'chart-row-label')
    .attr('x', -margin.left + 4).attr('y', -12)
    .text('Within one point');

  const path = d3Line<DriftCheck>().x(c => x(c.date) ?? 0).y(c => yA(c.withinOne));
  if (checks.length > 1) {
    a.append('path').attr('class', 'chart-line')
      .attr('d', path(checks) ?? '')
      .attr('stroke', palette.high);
  }
  for (const check of checks) {
    const dot = a.append<SVGElement>('circle')
      .attr('class', 'chart-dot')
      .attr('cx', x(check.date) ?? 0).attr('cy', yA(check.withinOne))
      .attr('r', 4)
      .attr('fill', palette.high)
      .attr('stroke', palette.bg);
    hover(dot, () => goldTooltip(check));
  }
  const last = checks[checks.length - 1];
  a.append('text').attr('class', 'chart-value')
    .attr('x', (x(last.date) ?? 0) + 8).attr('y', yA(last.withinOne)).attr('dy', '0.32em')
    .text(`${Math.round(last.withinOne * 100)}%`);

  // Date labels between the panels.
  const labels = f.plot.append('g');
  const every = Math.max(1, Math.ceil((withYear ? 52 : 40) / Math.max(1, x.step())));
  dates.forEach((d, i) => {
    if (i % every !== 0 && i !== dates.length - 1) return;
    labels.append('text').attr('class', 'chart-tick')
      .attr('x', x(d) ?? 0).attr('y', topHeight + 16).attr('text-anchor', 'middle')
      .text(axisDate(d, withYear));
  });

  // Panel B: MAE per dimension, one sparkline row each on a shared scale.
  const b = f.plot.append<SVGGElement>('g').attr('transform', `translate(0,${topHeight + panelGap})`);
  const maeMax = max(checks, c => max(Object.values(c.maeByDimension)) ?? 0) ?? 0;
  const yB = scaleLinear().domain([0, Math.max(0.5, maeMax)]).range([MAE_ROW - 6, 4]);
  b.append('text').attr('class', 'chart-row-label')
    .attr('x', -margin.left + 4).attr('y', -10)
    .text('Mean absolute error');
  dimensions.forEach((dim, i) => {
    const row = b.append<SVGGElement>('g').attr('transform', `translate(0,${i * MAE_ROW})`);
    row.append('line').attr('class', 'chart-gridline')
      .attr('x1', 0).attr('x2', f.innerWidth).attr('y1', MAE_ROW - 6).attr('y2', MAE_ROW - 6);
    row.append('text').attr('class', 'chart-tick')
      .attr('x', -8).attr('y', MAE_ROW / 2 - 1).attr('dy', '0.32em').attr('text-anchor', 'end')
      .text(snakeDimensionLabel(dim));
    const points = checks.filter(c => dim in c.maeByDimension);
    if (points.length > 1) {
      const rowLine = d3Line<DriftCheck>().x(c => x(c.date) ?? 0).y(c => yB(c.maeByDimension[dim]));
      row.append('path').attr('class', 'chart-line')
        .attr('d', rowLine(points) ?? '')
        .attr('stroke', palette.high);
    }
    for (const c of points) {
      const dot = row.append<SVGElement>('circle')
        .attr('class', 'chart-dot')
        .attr('cx', x(c.date) ?? 0).attr('cy', yB(c.maeByDimension[dim]))
        .attr('r', 4)
        .attr('fill', palette.high)
        .attr('stroke', palette.bg);
      hover(dot, () => `<strong>${escapeHtml(formatDate(c.date))}</strong>${escapeHtml(snakeDimensionLabel(dim))} MAE: <b>${c.maeByDimension[dim].toFixed(2)}</b>`);
    }
    const end = points[points.length - 1];
    if (end) {
      row.append('text').attr('class', 'chart-value')
        .attr('x', (x(end.date) ?? 0) + 8).attr('y', yB(end.maeByDimension[dim])).attr('dy', '0.32em')
        .text(end.maeByDimension[dim].toFixed(2));
    }
  });
  return legend;
}

// Tooltips are HTML: every value from a data file goes through escapeHtml
// (drift.json dates, models and dimension keys are free text, and
// formatDate passes an unparseable date through unchanged).
export function goldTooltip(check: DriftCheck): string {
  const parts = [
    `<strong>${escapeHtml(formatDate(check.date))}</strong>`,
    `within one point: <b>${Math.round(check.withinOne * 100)}%</b>`,
  ];
  if (check.model) parts.push(`${escapeHtml(check.model)}${check.promptVersion ? `, prompt ${escapeHtml(check.promptVersion)}` : ''}`);
  if (check.maxDev != null) {
    const where = check.maxDevAt
      ? [check.maxDevAt.country, check.maxDevAt.dimension && snakeDimensionLabel(check.maxDevAt.dimension)]
        .filter(Boolean).map(part => escapeHtml(String(part)))
      : [];
    const at = where.length ? ` (${where.join(', ')})` : '';
    parts.push(`largest deviation: ${check.maxDev}${at}`);
  }
  parts.push(`${check.countriesCompared} countries compared`);
  return parts.join('<br>');
}

// ---------------------------------------------------------------------------
// 5. Per-bloc drift: share of members changed per run, one row per bloc.

export function renderBlocChart(host: HTMLElement, blocs: BlocDrift[], palette: Palette): LegendItem[] {
  const legend: LegendItem[] = [{ label: 'Share of members changed', color: palette.high, from: palette.sequential(0.08), kind: 'ramp' }];
  const rowHeight = 18;
  const height = Math.max(120, blocs.length * rowHeight + 46);
  const f = frame(host, height, { top: 6, right: 12, bottom: 36, left: 56 }, 'Share of bloc members changed per run');
  if (blocs.length === 0) return legend;

  const dates = blocs[0].weeks.map(w => w.date);
  const x = scaleBand<string>().domain(dates).range([0, f.innerWidth]).paddingInner(0.12).paddingOuter(0.06);
  const y = scaleBand<string>().domain(blocs.map(b => b.code)).range([0, f.innerHeight]).paddingInner(0.16);

  for (const bloc of blocs) {
    f.plot.append('text').attr('class', 'chart-tick')
      .attr('x', -8).attr('y', (y(bloc.code) ?? 0) + y.bandwidth() / 2).attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(bloc.name.length <= 8 ? bloc.name : bloc.code);
    for (const week of bloc.weeks) {
      const cell = f.plot.append<SVGElement>('rect')
        .attr('class', 'chart-mark')
        .attr('x', x(week.date) ?? 0).attr('y', y(bloc.code) ?? 0)
        .attr('width', x.bandwidth()).attr('height', y.bandwidth())
        .attr('rx', 2)
        .attr('fill', week.changed === 0 ? palette.surface : palette.sequential(0.08 + 0.92 * week.share));
      hover(cell, () =>
        `<strong>${escapeHtml(bloc.name)}</strong>${escapeHtml(formatDate(week.date))}: <b>${week.changed}</b> of ${bloc.members} members changed (${percent(week.changed, bloc.members)}%)`);
    }
  }
  xDateLabels(f, x, x.bandwidth(), dates, new Set());
  return legend;
}
