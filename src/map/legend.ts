import { select } from 'd3-selection';
import type { Selection } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import type { ScaleLinear } from 'd3-scale';
import { interpolateLab } from 'd3-interpolate';
import { range } from 'd3-array';

import { LEGEND_ENDPOINTS } from '../constants';
import { getState } from '../state/store';
import { cssVar } from './cssColors';

export type ColorScale = ScaleLinear<string, string>;

export function makeColorScale(): ColorScale {
  return scaleLinear<string>()
    .domain([1, 5])
    .range([cssVar('--score-low'), cssVar('--score-high')])
    .interpolate(interpolateLab)
    .clamp(true);
}

export function addLegend(
  svg: Selection<SVGSVGElement, unknown, HTMLElement, unknown>,
  colorScale: ColorScale,
  size?: { w: number; h: number }
): void {
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

  // "No data" key — countries with no score render in --no-data grey,
  // and without this the reader can't tell "no information" from a low
  // score (or from a country filtered out of the current view).
  const noData = legend.append('g')
    .attr('class', 'legend-nodata')
    .attr('transform', 'translate(0, -11)');

  // A filled dot (no outline) reads as a colour key; the old bordered
  // square read as an unchecked checkbox.
  noData.append('circle')
    .attr('cx', 4)
    .attr('cy', -4)
    .attr('r', 4.5)
    .style('fill', cssVar('--no-data'));

  noData.append('text')
    .attr('class', 'legend-label')
    .attr('x', 14)
    .attr('y', 0)
    .attr('text-anchor', 'start')
    .text('No data');
}

export function updateLegendLabels(): void {
  const { currentAttribute } = getState();
  const endpoints = LEGEND_ENDPOINTS[currentAttribute] || ['Low', 'High'];
  select('.legend-label-low').text(endpoints[0]);
  select('.legend-label-high').text(endpoints[1]);
}
