// Cross-dimension scatter plot ("dimension explorer"). Plots every
// country on two chosen score dimensions to reveal governance
// clusters. Overlays the map; clicking a dot selects the country.
//
// Shows LATEST scores only — the timeline scrubber drives the map, not
// this panel (history snapshots are score-only and axis pairs would
// silently mix vintages).

import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { axisBottom, axisLeft } from 'd3-axis';
import { format } from 'd3-format';
import 'd3-transition';

import { getState, setState, on } from '../state/store.js';
import { ATTRIBUTE_LABELS, SCORE_OPTIONS } from '../constants.js';
import { makeColorScale } from '../map/legend.js';
import { cssVar, onThemeChange } from '../map/cssColors.js';
import { createTooltip, showTooltip, hideTooltip } from '../map/tooltip.js';
import { jitterFor } from './jitter.js';

const WIDTH = 480;
const HEIGHT = 380;
const MARGIN = { top: 16, right: 16, bottom: 44, left: 44 };

const AXIS_DIMENSIONS = SCORE_OPTIONS.filter(o => o.value !== 'averageScore');

let svg = null;
let xScale, yScale;

function populateAxisSelects() {
  const { scatterX, scatterY } = getState();
  for (const [id, current] of [['scatter-x', scatterX], ['scatter-y', scatterY]]) {
    const sel = document.getElementById(id);
    for (const dim of AXIS_DIMENSIONS) {
      const opt = document.createElement('option');
      opt.value = dim.value;
      opt.textContent = dim.text;
      sel.appendChild(opt);
    }
    sel.value = current;
    sel.addEventListener('change', () => {
      setState(id === 'scatter-x' ? { scatterX: sel.value } : { scatterY: sel.value });
    });
  }
}

function createChart() {
  const chart = select('#scatter-chart');
  svg = chart.append('svg')
    .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', 'Scatter plot of countries across two score dimensions');

  xScale = scaleLinear().domain([0.5, 5.5]).range([MARGIN.left, WIDTH - MARGIN.right]);
  yScale = scaleLinear().domain([0.5, 5.5]).range([HEIGHT - MARGIN.bottom, MARGIN.top]);

  // Axes inherit currentColor from CSS so theme switches restyle them
  // for free; only the dot fills need explicit recoloring.
  svg.append('g')
    .attr('class', 'scatter-axis scatter-axis-x')
    .attr('transform', `translate(0,${HEIGHT - MARGIN.bottom})`)
    .call(axisBottom(xScale).tickValues([1, 2, 3, 4, 5]).tickFormat(format('d')));

  svg.append('g')
    .attr('class', 'scatter-axis scatter-axis-y')
    .attr('transform', `translate(${MARGIN.left},0)`)
    .call(axisLeft(yScale).tickValues([1, 2, 3, 4, 5]).tickFormat(format('d')));

  svg.append('text')
    .attr('class', 'scatter-axis-label')
    .attr('id', 'scatter-x-label')
    .attr('x', MARGIN.left + (WIDTH - MARGIN.left - MARGIN.right) / 2)
    .attr('y', HEIGHT - 8)
    .attr('text-anchor', 'middle');

  svg.append('text')
    .attr('class', 'scatter-axis-label')
    .attr('id', 'scatter-y-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) / 2))
    .attr('y', 13)
    .attr('text-anchor', 'middle');
}

function dotTooltipHtml(d, xKey, yKey) {
  return `<strong>${d.name}</strong><br>` +
    `${ATTRIBUTE_LABELS[xKey]}: ${d.x}<br>` +
    `${ATTRIBUTE_LABELS[yKey]}: ${d.y}`;
}

function updateChart() {
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
    .map(([name, scores]) => {
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
    .filter(d => d.x != null && d.y != null);

  const colorScale = makeColorScale();
  const noData = cssVar('--no-data');
  const strokeColor = cssVar('--surface');

  svg.selectAll('circle.scatter-dot')
    .data(countries, d => d.name)
    .join(
      enter => enter.append('circle')
        .attr('class', 'scatter-dot')
        .attr('cx', d => xScale(d.x + jitterFor(d.name).dx))
        .attr('cy', d => yScale(d.y + jitterFor(d.name).dy))
        .on('click', (e, d) => setState({ selectedCountry: d.name }))
        .on('mouseenter', (e, d) => showTooltip(e, dotTooltipHtml(d, getState().scatterX, getState().scatterY)))
        .on('mouseleave', hideTooltip),
      update => update,
      exit => exit.remove()
    )
    .transition().duration(300)
    .attr('cx', d => xScale(d.x + jitterFor(d.name).dx))
    .attr('cy', d => yScale(d.y + jitterFor(d.name).dy))
    .attr('r', d => d.name === selectedCountry ? 7 : 4.5)
    .attr('fill', d => d.avg != null ? colorScale(d.avg) : noData)
    .attr('stroke', strokeColor)
    .attr('stroke-width', d => d.name === selectedCountry ? 2 : 0.6)
    .style('opacity', d => d.visible ? 0.85 : 0.15);
}

function setVisible(open) {
  const container = document.getElementById('scatter-container');
  const btn = document.getElementById('scatter-btn');
  container.hidden = !open;
  btn.classList.toggle('active', open);
  btn.setAttribute('aria-pressed', String(open));
  if (open) {
    if (!svg) {
      createTooltip();
      createChart();
    }
    updateChart();
  }
}

export function initScatter() {
  const btn = document.getElementById('scatter-btn');
  const closeBtn = document.getElementById('scatter-close');
  if (!btn || !closeBtn) return;

  populateAxisSelects();

  btn.addEventListener('click', () => {
    setState({ scatterOpen: !getState().scatterOpen });
  });
  closeBtn.addEventListener('click', () => setState({ scatterOpen: false }));

  on('scatterOpen', setVisible);

  const refreshIfOpen = () => { if (getState().scatterOpen) updateChart(); };
  on('scatterX', () => {
    const sel = document.getElementById('scatter-x');
    sel.value = getState().scatterX;
    refreshIfOpen();
  });
  on('scatterY', () => {
    const sel = document.getElementById('scatter-y');
    sel.value = getState().scatterY;
    refreshIfOpen();
  });
  on('selectedCountry', refreshIfOpen);
  on('currentAttribute', refreshIfOpen);
  on('filterMin', refreshIfOpen);
  on('filterMax', refreshIfOpen);
  on('selectedBloc', refreshIfOpen);
  onThemeChange(refreshIfOpen);

  setVisible(getState().scatterOpen);
}
