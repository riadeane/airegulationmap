import { select, selectAll } from 'd3-selection';
import { json } from 'd3-fetch';
import { geoEquirectangular, geoPath, geoGraticule } from 'd3-geo';
import { feature } from 'topojson-client';
import 'd3-transition';

import { ATTRIBUTE_LABELS } from '../constants.js';
import { getState, setState } from '../state/store.js';
import { makeColorScale, addLegend } from './legend.js';
import { createTooltip, showTooltip, hideTooltip } from './tooltip.js';
import { setupZoom } from './zoom.js';
import { toggleComparison, getColorIndex } from '../comparison/index.js';
import { cssVar, onThemeChange } from './cssColors.js';

// Module-level refs so resize and theme-change handlers can redraw
// without re-running the whole generateMap async flow.
let svgRef = null;
let mapGroupRef = null;
let projectionRef = null;
let pathRef = null;
let graticuleRef = null;
let currentSize = { w: 1000, h: 500 };
let zoomHandle = null;

function readContainerSize() {
  const wrapper = document.getElementById('map-wrapper');
  if (!wrapper) return { w: 1000, h: 500 };
  // Use clientWidth/Height so an in-flight CSS transform on the wrapper
  // (e.g. the mount scaleIn animation) doesn't feed us a transformed
  // rect. clientWidth/Height are laid-out box dims, untouched by
  // transforms.
  const w = Math.max(320, wrapper.clientWidth);
  const h = Math.max(240, wrapper.clientHeight);
  return { w, h };
}

// Fit the projection so the map fills as much of the container as it
// reasonably can without lopping off whole regions.
//
// Strategy: start with a "contain" fit, then scale up partway toward a
// "cover" fit. The blend factor controls how much dead space we accept
// vs. how much of the world we're willing to crop. 0 = pure contain
// (letterbox, no crop), 1 = pure cover (fills, crops aggressively).
// 0.75 feels right for a policy map: most of the world stays visible
// and the vertical black bars shrink dramatically on tall viewports.
//
// We also rotate the projection so the center sits over Europe rather
// than the 0° meridian. That way whatever horizontal crop does happen
// eats into the Pacific Ocean first, not into populated continents.
const FILL_BLEND = 0.75;
const MAP_ROTATION = [-15, 0];

function fitProjectionToFill(projection, w, h) {
  projection.rotate(MAP_ROTATION).fitSize([w, h], { type: 'Sphere' });
  const tmpPath = geoPath().projection(projection);
  const [[x0, y0], [x1, y1]] = tmpPath.bounds({ type: 'Sphere' });
  const mapW = x1 - x0 || 1;
  const mapH = y1 - y0 || 1;
  const coverScale = Math.max(w / mapW, h / mapH);
  const containScale = Math.min(w / mapW, h / mapH);
  const blendScale = containScale + (coverScale - containScale) * FILL_BLEND;
  projection.scale(projection.scale() * blendScale).translate([w / 2, h / 2]);
}

function fitToSize({ w, h }) {
  if (!svgRef || !projectionRef) return;

  currentSize = { w, h };

  svgRef
    .attr('width', w)
    .attr('height', h)
    .attr('viewBox', [0, 0, w, h]);

  select('#clip rect')
    .attr('width', w)
    .attr('height', h);

  fitProjectionToFill(projectionRef, w, h);

  select('#map .sphere').attr('d', pathRef);
  select('#map .graticule').attr('d', pathRef(graticuleRef));
  mapGroupRef.selectAll('.country').attr('d', pathRef);

  if (zoomHandle) zoomHandle.updateBounds({ w, h });

  select('#map .legend').remove();
  addLegend(svgRef, makeColorScale(), { w, h });
}

export async function generateMap() {
  const { scoreData, currentAttribute } = getState();

  const size = readContainerSize();
  currentSize = size;

  const svg = select('#map')
    .append('svg')
    .attr('role', 'img')
    .attr('aria-label', 'World map showing AI regulation scores by country. Click a country for details; Shift+click to compare.')
    .attr('width', size.w)
    .attr('height', size.h)
    .attr('viewBox', [0, 0, size.w, size.h])
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Some screen readers prefer <title> to aria-label on SVG, so set
  // both. The title must be the first child to be announced correctly.
  svg.append('title').text('World map showing AI regulation scores by country');

  svg.append('defs')
    .append('clipPath')
    .attr('id', 'clip')
    .append('rect')
    .attr('width', size.w)
    .attr('height', size.h)
    .attr('rx', 20)
    .attr('ry', 20);

  const g = svg.append('g')
    .attr('clip-path', 'url(#clip)');

  const projection = geoEquirectangular();
  fitProjectionToFill(projection, size.w, size.h);

  const path = geoPath().projection(projection);
  const colorScale = makeColorScale();

  svgRef = svg;
  projectionRef = projection;
  pathRef = path;

  createTooltip();

  // Self-hosted from /public/data so there's no third-party request on
  // page load and offline dev works. Source: world-atlas@2 (Natural Earth).
  const world = await json('/data/countries-110m.json');
  const countries = feature(world, world.objects.countries).features;

  const mapGroup = g.append('g').attr('class', 'map-group');
  mapGroupRef = mapGroup;

  mapGroup.append('path')
    .datum({ type: 'Sphere' })
    .attr('class', 'sphere')
    .attr('fill', cssVar('--ocean'))
    .attr('d', path);

  const graticule = geoGraticule().step([20, 20]);
  graticuleRef = graticule();
  mapGroup.append('path')
    .datum(graticuleRef)
    .attr('class', 'graticule')
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', cssVar('--text-tertiary'))
    .attr('stroke-opacity', 0.08)
    .attr('stroke-width', 0.4)
    .attr('stroke-dasharray', '2,3');

  mapGroup.selectAll('.country')
    .data(countries)
    .enter().append('path')
    .attr('class', 'country')
    .attr('d', path)
    .attr('fill', d => {
      const entry = scoreData[d.properties.name];
      return entry ? colorScale(entry[currentAttribute]) : cssVar('--no-data');
    })
    .attr('stroke', cssVar('--map-stroke'))
    .attr('stroke-width', 0.3)
    .on('mouseover', function (event, d) {
      const countryName = d.properties.name;
      const { currentAttribute: attr, comparisonCountries } = getState();
      const entry = getState().scoreData[countryName];
      const score = entry ? entry[attr] : null;
      const label = ATTRIBUTE_LABELS[attr] || attr;
      const inComparison = comparisonCountries.includes(countryName);
      const hint = inComparison
        ? '<br><em>Shift+click to remove from comparison</em>'
        : '<br><em>Shift+click to add to comparison</em>';
      showTooltip(event,
        `<strong>${countryName}</strong>` +
        (score != null ? `<br>${label}: ${score} / 5` : '<br>No data') +
        hint
      );
    })
    .on('mouseout', hideTooltip)
    .on('click', function (event, d) {
      const name = d.properties.name;
      if (event.shiftKey) {
        toggleComparison(name);
        event.preventDefault();
      } else {
        setState({ selectedCountry: name });
      }
    });

  zoomHandle = setupZoom(svg, mapGroup, () => currentSize);
  addLegend(svg, colorScale, size);

  onThemeChange(() => {
    const refreshed = makeColorScale();
    const { scoreData: sd, currentAttribute: attr } = getState();
    selectAll('#map .country')
      .transition().duration(220)
      .attr('fill', d => {
        const entry = sd[d.properties.name];
        return entry ? refreshed(entry[attr]) : cssVar('--no-data');
      })
      .attr('stroke', cssVar('--map-stroke'));
    select('#map .sphere').attr('fill', cssVar('--ocean'));
    select('#map .graticule').attr('stroke', cssVar('--text-tertiary'));
    select('#map .legend').remove();
    addLegend(svgRef, refreshed, currentSize);
  });

  // Observe the wrapper so the map grows/shrinks with the viewport.
  // rAF-debounce because ResizeObserver can fire many times per frame.
  const wrapper = document.getElementById('map-wrapper');
  if (wrapper && typeof ResizeObserver !== 'undefined') {
    let pending = false;
    const ro = new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        fitToSize(readContainerSize());
      });
    });
    ro.observe(wrapper);
  }
}

export function updateMap(overrideScoreData) {
  const { currentAttribute, filterMin, filterMax, scoreData } = getState();
  const data = overrideScoreData || scoreData;
  const colorScale = makeColorScale();

  select('#map')
    .selectAll('.country')
    .transition()
    .duration(500)
    .attr('fill', d => {
      const entry = data[d.properties.name];
      return entry ? colorScale(entry[currentAttribute]) : cssVar('--no-data');
    })
    .style('opacity', d => {
      const entry = data[d.properties.name];
      if (!entry) return 0.4;
      const score = entry[currentAttribute];
      if (score == null) return 0.4;
      return (score >= filterMin && score <= filterMax) ? 1 : 0.15;
    });
}

export function highlightCountry(countryName) {
  selectAll('.country').classed('selected', false).attr('stroke-width', 0.3);
  selectAll('.country')
    .filter(d => d.properties.name === countryName)
    .classed('selected', true)
    .attr('stroke-width', 2);
}

export function clearHighlight() {
  selectAll('.country').classed('selected', false).attr('stroke-width', 0.3);
}

export function markComparisonCountries(names) {
  selectAll('.country')
    .classed('in-comparison', false)
    .attr('data-comparison-index', null);
  if (!names || names.length === 0) return;
  const namesSet = new Set(names);
  selectAll('.country')
    .filter(d => namesSet.has(d.properties.name))
    .classed('in-comparison', true)
    .attr('data-comparison-index', d => getColorIndex(d.properties.name));
}

export function updateSearchHighlight(query) {
  if (query.length < 2) {
    selectAll('.country')
      .classed('search-dimmed', false)
      .classed('search-highlighted', false);
    return;
  }
  const lq = query.toLowerCase();
  selectAll('.country').each(function (d) {
    const name = (d.properties.name || '').toLowerCase();
    const matches = name.includes(lq);
    select(this)
      .classed('search-dimmed', !matches)
      .classed('search-highlighted', matches);
  });
}
