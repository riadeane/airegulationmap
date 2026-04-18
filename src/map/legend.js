import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { interpolateLab } from 'd3-interpolate';
import { range } from 'd3-array';

import { LEGEND_ENDPOINTS } from '../constants.js';
import { getState } from '../state/store.js';
import { cssVar } from './cssColors.js';

export function makeColorScale() {
  return scaleLinear()
    .domain([1, 5])
    .range([cssVar('--score-low'), cssVar('--score-high')])
    .interpolate(interpolateLab)
    .clamp(true);
}

export function addLegend(svg, colorScale, size) {
  const { w, h } = size || { w: 1000, h: 500 };
  // Legend width scales with viewport. Min 190 so endpoint labels like
  // "Comprehensive" / "Centralized" don't crowd the midpoint.
  const legendWidth = Math.round(Math.min(300, Math.max(190, w * 0.28)));
  const legendHeight = 30;
  const legendMargin = { top: 10, right: 16, bottom: 10, left: 16 };

  const legend = svg.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${w - legendWidth - legendMargin.right}, ${h - legendHeight - legendMargin.bottom})`);

  const gradientData = range(0, 1, 0.02).map(d => ({
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
