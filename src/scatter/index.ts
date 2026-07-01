// Cross-dimension scatter plot ("dimension explorer"). Plots every
// country on two chosen score dimensions to reveal governance
// clusters. Opens as a full view in the map's slot (body.view-scatter
// hides the map layer); the country panel stays alongside, so clicking
// a dot reads exactly like clicking a country on the map.
//
// Shows LATEST scores only — the timeline scrubber drives the map, not
// this view (history snapshots are score-only and axis pairs would
// silently mix vintages).

import { select } from 'd3-selection';
import type { Selection } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import type { ScaleLinear } from 'd3-scale';
import { axisBottom, axisLeft } from 'd3-axis';
import { format } from 'd3-format';
import 'd3-transition';

import { getState, setState, on } from '../state/store';
import { ATTRIBUTE_LABELS, SCORE_OPTIONS } from '../constants';
import type { AttributeKey } from '../constants';
import { makeColorScale } from '../map/legend';
import { cssVar, onThemeChange } from '../map/cssColors';
import { createTooltip, showTooltip, hideTooltip } from '../map/tooltip';
import { jitterFor } from './jitter';

// The viewBox tracks the container's real pixel box (see layout()) so the
// plot fills the tall portrait slot instead of letterboxing into a small
// centered rectangle. These are the fallback/last-measured dimensions.
let WIDTH = 760;
let HEIGHT = 540;
const MARGIN = { top: 24, right: 28, bottom: 52, left: 52 };

const AXIS_DIMENSIONS = SCORE_OPTIONS.filter(o => o.value !== 'averageScore');

function isCoarse(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

// Touch has no hover to identify a dot, and dots overlap in dense score
// clusters, so a single tap could open the wrong country. On coarse
// pointers the first tap "previews" a dot (pins its name); a second tap
// on the same dot commits the selection.
let previewedName: string | null = null;

/** One country positioned on the two chosen score dimensions. */
interface ScatterDot {
  name: string;
  x: number | null;
  y: number | null;
  avg: number | null;
  visible: boolean;
}

/** A dot that survived the null-coordinate filter below. */
type PlottedDot = ScatterDot & { x: number; y: number };

let svg: Selection<SVGSVGElement, unknown, HTMLElement, unknown> | null = null;
let xScale: ScaleLinear<number, number>, yScale: ScaleLinear<number, number>;

function populateAxisSelects(): void {
  const { scatterX, scatterY } = getState();
  for (const [id, current] of [['scatter-x', scatterX], ['scatter-y', scatterY]]) {
    const sel = document.getElementById(id) as HTMLSelectElement;
    for (const dim of AXIS_DIMENSIONS) {
      const opt = document.createElement('option');
      opt.value = dim.value;
      opt.textContent = dim.text;
      sel.appendChild(opt);
    }
    sel.value = current;
    sel.addEventListener('change', () => {
      setState(id === 'scatter-x' ? { scatterX: sel.value as AttributeKey } : { scatterY: sel.value as AttributeKey });
    });
  }
}

function createChart(): void {
  const chart = select('#scatter-chart');
  svg = chart.append<SVGSVGElement>('svg')
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', 'Scatter plot of countries across two score dimensions');

  xScale = scaleLinear().domain([0.5, 5.5]);
  yScale = scaleLinear().domain([0.5, 5.5]);

  // Axes inherit currentColor from CSS so theme switches restyle them
  // for free; only the dot fills need explicit recoloring.
  svg.append('g').attr('class', 'scatter-axis scatter-axis-x');
  svg.append('g').attr('class', 'scatter-axis scatter-axis-y');

  svg.append('text')
    .attr('class', 'scatter-axis-label')
    .attr('id', 'scatter-x-label')
    .attr('text-anchor', 'middle');

  svg.append('text')
    .attr('class', 'scatter-axis-label')
    .attr('id', 'scatter-y-label')
    .attr('transform', 'rotate(-90)')
    .attr('text-anchor', 'middle');

  layout();

  // Re-fit whenever the chart box changes size — the container settles
  // after open, the menu collapsing lengthens it, and rotation resizes
  // it. A ResizeObserver catches all of these (a one-time measure and a
  // window-resize listener both miss the header-height changes).
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (getState().scatterOpen) { layout(); updateChart(); }
    });
    ro.observe(document.getElementById('scatter-chart')!);
  }
}

// Fit the chart to the container's actual box and (re)position the axes
// and labels. Called on creation and on resize/orientation change so a
// rotated phone re-lays-out instead of staying letterboxed.
function layout(): void {
  if (!svg) return;
  const box = document.getElementById('scatter-chart');
  WIDTH = Math.max(280, box?.clientWidth || WIDTH);
  HEIGHT = Math.max(240, box?.clientHeight || HEIGHT);
  svg.attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  xScale.range([MARGIN.left, WIDTH - MARGIN.right]);
  yScale.range([HEIGHT - MARGIN.bottom, MARGIN.top]);

  svg.select<SVGGElement>('.scatter-axis-x')
    .attr('transform', `translate(0,${HEIGHT - MARGIN.bottom})`)
    .call(axisBottom(xScale).tickValues([1, 2, 3, 4, 5]).tickFormat(format('d')));
  svg.select<SVGGElement>('.scatter-axis-y')
    .attr('transform', `translate(${MARGIN.left},0)`)
    .call(axisLeft(yScale).tickValues([1, 2, 3, 4, 5]).tickFormat(format('d')));

  svg.select('#scatter-x-label')
    .attr('x', MARGIN.left + (WIDTH - MARGIN.left - MARGIN.right) / 2)
    .attr('y', HEIGHT - 8);
  svg.select('#scatter-y-label')
    .attr('x', -(MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) / 2))
    .attr('y', 13);
}

function dotTooltipHtml(d: PlottedDot, xKey: AttributeKey, yKey: AttributeKey): string {
  return `<strong>${d.name}</strong><br>` +
    `${ATTRIBUTE_LABELS[xKey]}: ${d.x}<br>` +
    `${ATTRIBUTE_LABELS[yKey]}: ${d.y}`;
}

function updateChart(): void {
  if (!svg) return;
  const {
    scoreData, scatterX, scatterY, selectedCountry,
    currentAttribute, filterMin, filterMax, selectedBloc, blocsData,
  } = getState();

  svg.select('#scatter-x-label').text(ATTRIBUTE_LABELS[scatterX]);
  svg.select('#scatter-y-label').text(ATTRIBUTE_LABELS[scatterY]);

  const blocSet = selectedBloc && blocsData?.[selectedBloc]
    ? new Set(blocsData[selectedBloc].members)
    : null;

  const countries = Object.entries(scoreData)
    .map(([name, scores]): ScatterDot => {
      const filterScore = scores[currentAttribute];
      const inRange = filterScore != null
        && filterScore >= filterMin && filterScore <= filterMax;
      const inBloc = !blocSet || blocSet.has(name);
      return {
        name,
        x: scores[scatterX],
        y: scores[scatterY],
        avg: scores.averageScore,
        visible: inRange && inBloc,
      };
    })
    .filter((d): d is PlottedDot => d.x != null && d.y != null);

  const colorScale = makeColorScale();
  const noData = cssVar('--no-data');
  const strokeColor = cssVar('--surface');
  const coarse = isCoarse();
  const baseR = coarse ? 6 : 4.5;      // easier to hit on touch
  const bigR = coarse ? 9.5 : 7;       // selected / previewed
  const isMarked = (name: string) => name === selectedCountry || name === previewedName;

  svg.selectAll<SVGCircleElement, PlottedDot>('circle.scatter-dot')
    .data(countries, d => d.name)
    .join(
      enter => enter.append('circle')
        .attr('class', 'scatter-dot')
        .attr('cx', d => xScale(d.x + jitterFor(d.name).dx))
        .attr('cy', d => yScale(d.y + jitterFor(d.name).dy))
        .on('click', (e, d) => onDotClick(d.name))
        .on('mouseenter', (e, d) => showTooltip(e, dotTooltipHtml(d, getState().scatterX, getState().scatterY)))
        .on('mouseleave', hideTooltip),
      update => update,
      exit => exit.remove()
    )
    .transition().duration(300)
    .attr('cx', d => xScale(d.x + jitterFor(d.name).dx))
    .attr('cy', d => yScale(d.y + jitterFor(d.name).dy))
    .attr('r', d => isMarked(d.name) ? bigR : baseR)
    .attr('fill', d => d.avg != null ? colorScale(d.avg) : noData)
    .attr('stroke', strokeColor)
    .attr('stroke-width', d => isMarked(d.name) ? 2 : 0.6)
    .style('opacity', d => d.visible ? 0.85 : 0.15);

  // Name labels pinned to the selected dot AND (on touch) the previewed
  // dot — in a 196-dot field the highlight ring alone is easy to lose,
  // and the preview needs to say which country you're about to open.
  const labelled = countries.filter(d => isMarked(d.name));
  svg.selectAll<SVGTextElement, PlottedDot>('text.scatter-dot-label')
    .data(labelled, d => d.name)
    .join('text')
    .attr('class', 'scatter-dot-label')
    .classed('is-preview', d => d.name === previewedName && d.name !== selectedCountry)
    .attr('x', d => xScale(d.x + jitterFor(d.name).dx) + 11)
    .attr('y', d => yScale(d.y + jitterFor(d.name).dy) + 4)
    .text(d => d.name);
}

// Touch: first tap previews (names) the dot, second tap on the same dot
// selects it. Mouse (fine pointer): tap selects immediately — hover
// already reveals identity.
function onDotClick(name: string): void {
  if (isCoarse() && previewedName !== name) {
    previewedName = name;
    updateChart();
  } else {
    previewedName = null;
    setState({ selectedCountry: name });
  }
}

function setVisible(open: boolean): void {
  const container = document.getElementById('scatter-container')!;
  const btn = document.getElementById('scatter-btn')!;
  container.hidden = !open;
  // The explorer takes over the map's slot; the map layer (svg, zoom,
  // bloc card, timeline) hides via this class but keeps its DOM and
  // layout so switching back is instant.
  document.body.classList.toggle('view-scatter', open);
  btn.classList.toggle('active', open);
  btn.setAttribute('aria-pressed', String(open));
  if (open) {
    previewedName = null;
    if (!svg) {
      createTooltip();
      createChart();
    } else {
      // Re-measure: the container may have resized (or the phone rotated)
      // while the explorer was closed.
      layout();
    }
    updateChart();
  }
}

export function initScatter(): void {
  const btn = document.getElementById('scatter-btn');
  const closeBtn = document.getElementById('scatter-close');
  if (!btn || !closeBtn) return;

  populateAxisSelects();

  btn.addEventListener('click', () => {
    const opening = !getState().scatterOpen;
    // Explorer and the comparison view are mutually exclusive — both
    // own the main area.
    if (opening && getState().comparisonViewOpen) setState({ comparisonViewOpen: false });
    setState({ scatterOpen: opening });
    // Move focus into the explorer so keyboard users land in the new
    // view (and back to the trigger when it closes). Only on explicit
    // toggles — not on load / URL restore, which call setVisible directly.
    if (opening) closeBtn.focus();
  });
  closeBtn.addEventListener('click', () => {
    setState({ scatterOpen: false });
    btn.focus();
  });

  on('scatterOpen', setVisible);

  const refreshIfOpen = () => { if (getState().scatterOpen) updateChart(); };
  on('scatterX', () => {
    const sel = document.getElementById('scatter-x') as HTMLSelectElement;
    sel.value = getState().scatterX;
    refreshIfOpen();
  });
  on('scatterY', () => {
    const sel = document.getElementById('scatter-y') as HTMLSelectElement;
    sel.value = getState().scatterY;
    refreshIfOpen();
  });
  // A selection made elsewhere (search, keyboard) clears a stale preview.
  on('selectedCountry', () => { previewedName = null; refreshIfOpen(); });
  on('currentAttribute', refreshIfOpen);
  on('filterMin', refreshIfOpen);
  on('filterMax', refreshIfOpen);
  on('selectedBloc', refreshIfOpen);
  onThemeChange(refreshIfOpen);

  setVisible(getState().scatterOpen);
}
