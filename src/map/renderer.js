import { select, selectAll } from 'd3-selection';
import { json } from 'd3-fetch';
import { geoEquirectangular, geoPath, geoGraticule } from 'd3-geo';
import { feature } from 'topojson-client';
import 'd3-transition';

import { WIDTH, HEIGHT, ATTRIBUTE_LABELS } from '../constants.js';
import { getState, setState } from '../state/store.js';
import { makeColorScale, addLegend } from './legend.js';
import { createTooltip, showTooltip, hideTooltip } from './tooltip.js';
import { setupZoom } from './zoom.js';
import { toggleComparison } from '../comparison/index.js';

export async function generateMap() {
  const { scoreData, currentAttribute } = getState();

  const svg = select('#map')
    .append('svg')
    .attr('width', WIDTH)
    .attr('height', HEIGHT)
    .attr('viewBox', [0, 0, WIDTH, HEIGHT]);

  svg.append('defs')
    .append('clipPath')
    .attr('id', 'clip')
    .append('rect')
    .attr('width', WIDTH)
    .attr('height', HEIGHT)
    .attr('rx', 20)
    .attr('ry', 20);

  const g = svg.append('g')
    .attr('clip-path', 'url(#clip)');

  const projection = geoEquirectangular()
    .fitSize([WIDTH, HEIGHT], { type: 'Sphere' });

  const path = geoPath().projection(projection);
  const colorScale = makeColorScale();

  createTooltip();

  const world = await json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
  const countries = feature(world, world.objects.countries).features;

  const mapGroup = g.append('g').attr('class', 'map-group');

  mapGroup.append('path')
    .datum({ type: 'Sphere' })
    .attr('fill', '#0d1018')
    .attr('d', path);

  // Graticule
  const graticule = geoGraticule().step([20, 20]);
  mapGroup.append('path')
    .datum(graticule())
    .attr('class', 'graticule')
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', 'rgba(255,255,255,0.04)')
    .attr('stroke-width', 0.4)
    .attr('stroke-dasharray', '2,3');

  mapGroup.selectAll('.country')
    .data(countries)
    .enter().append('path')
    .attr('class', 'country')
    .attr('d', path)
    .attr('fill', d => {
      const entry = scoreData[d.properties.name];
      return entry ? colorScale(entry[currentAttribute]) : '#1a1b24';
    })
    .attr('stroke', '#0a0b0f')
    .attr('stroke-width', 0.3)
    .on('mouseover', function (event, d) {
      const countryName = d.properties.name;
      const { currentAttribute: attr } = getState();
      const entry = getState().scoreData[countryName];
      const score = entry ? entry[attr] : null;
      const label = ATTRIBUTE_LABELS[attr] || attr;
      showTooltip(event,
        `<strong>${countryName}</strong>` +
        (score != null ? `<br>${label}: ${score} / 5` : '<br>No data')
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

  setupZoom(svg, mapGroup);
  addLegend(svg, colorScale);
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
      return entry ? colorScale(entry[currentAttribute]) : '#1a1b24';
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
  const indexByName = new Map(names.map((n, i) => [n, i]));
  selectAll('.country')
    .filter(d => indexByName.has(d.properties.name))
    .classed('in-comparison', true)
    .attr('data-comparison-index', d => indexByName.get(d.properties.name));
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
