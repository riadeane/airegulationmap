import { select } from 'd3-selection';
import { scaleSequential, scaleLinear } from 'd3-scale';
import { interpolateRgb } from 'd3-interpolate';
import { range } from 'd3-array';

import { WIDTH, HEIGHT, LEGEND_ENDPOINTS } from '../constants.js';
import { getState } from '../state/store.js';

export function makeColorScale() {
  return scaleSequential()
    .domain([1, 5])
    .interpolator(interpolateRgb('#3a3f52', '#d4a04a'));
}

export function addLegend(svg, colorScale) {
  const legendWidth = 300;
  const legendHeight = 30;
  const legendMargin = { top: 10, right: 20, bottom: 10, left: 20 };

  const legend = svg.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${WIDTH - legendWidth - legendMargin.right}, ${HEIGHT - legendHeight - legendMargin.bottom})`);

  const gradientData = range(0, 1, 0.01).map(d => ({
    offset: d,
    color: colorScale(1 + d * 4),
  }));

  const gradient = legend.append('defs')
    .append('linearGradient')
    .attr('id', 'legend-gradient')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '0%');

  gradient.selectAll('stop')
    .data(gradientData)
    .enter().append('stop')
    .attr('offset', d => `${d.offset * 100}%`)
    .attr('stop-color', d => d.color);

  legend.append('rect')
    .attr('width', legendWidth)
    .attr('height', legendHeight - legendMargin.bottom - legendMargin.top)
    .attr('rx', 2)
    .style('fill', 'url(#legend-gradient)');

  const { currentAttribute } = getState();
  const endpoints = LEGEND_ENDPOINTS[currentAttribute] || ['Low', 'High'];

  legend.append('text')
    .attr('class', 'legend-label legend-label-low')
    .attr('x', 0)
    .attr('y', legendHeight - legendMargin.bottom + 4)
    .attr('text-anchor', 'start')
    .text(endpoints[0]);

  legend.append('text')
    .attr('class', 'legend-label legend-label-high')
    .attr('x', legendWidth)
    .attr('y', legendHeight - legendMargin.bottom + 4)
    .attr('text-anchor', 'end')
    .text(endpoints[1]);
}

export function updateLegendLabels() {
  const { currentAttribute } = getState();
  const endpoints = LEGEND_ENDPOINTS[currentAttribute] || ['Low', 'High'];
  select('.legend-label-low').text(endpoints[0]);
  select('.legend-label-high').text(endpoints[1]);
}
