import { select } from 'd3-selection';
import type { Selection } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import type { ScaleLinear } from 'd3-scale';
import { interpolateLab } from 'd3-interpolate';
import { range } from 'd3-array';

import { LEGEND_ENDPOINTS } from '../constants';
import { getState } from '../state/store';
import { confidenceFallsBackAtDate } from '../state/selectors';
import { cssVar } from './cssColors';
import { appendHatchPattern } from './hatch';

// The legend's own copy of the hatch: the map's pattern counter-scales with
// the zoom, and the legend sits outside the zoomed group.
const LEGEND_HATCH_ID = 'hatch-low-legend';

const FALLBACK_NOTE_TITLE =
  'History records no confidence for this date, so the hatch shows each '
  + "country's current confidence.";

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

  // "No data" key - countries with no score render in --no-data grey,
  // and without this the reader can't tell "no information" from a low
  // score (or from a country filtered out of the current view).
  const noData = legend.append('g')
    .attr('class', 'legend-nodata')
    .attr('transform', 'translate(0, -11)');

  // A filled dot reads as a colour key; the old bordered square read as
  // an unchecked checkbox. The thin ring keeps the dot visible in the
  // light theme, where --no-data is nearly the ocean colour and the
  // legend sits over Antarctica (itself no data).
  noData.append('circle')
    .attr('cx', 4)
    .attr('cy', -4)
    .attr('r', 4.5)
    .style('fill', cssVar('--no-data'))
    .style('stroke', cssVar('--text-tertiary'))
    .style('stroke-width', 1);

  noData.append('text')
    .attr('class', 'legend-label')
    .attr('x', 14)
    .attr('y', 0)
    .attr('text-anchor', 'start')
    .text('No data');

  // Uncertainty key (PRD 13) - a mid-ramp swatch under the same hatch the
  // map draws. Its row sits above "No data"; updateLegendUncertainty shows
  // it only while "Show uncertainty" is on, and adds the fallback note
  // when a past date is shown without recorded confidence.
  appendHatchPattern(legend.select<SVGDefsElement>('defs'), LEGEND_HATCH_ID);
  const uncertainty = legend.append('g')
    .attr('class', 'legend-uncertainty');

  for (const fill of [colorScale(3), `url(#${LEGEND_HATCH_ID})`]) {
    uncertainty.append('rect')
      .attr('x', -0.5)
      .attr('y', -8.5)
      .attr('width', 9)
      .attr('height', 9)
      .attr('rx', 1.5)
      .style('fill', fill);
  }

  uncertainty.append('text')
    .attr('class', 'legend-label')
    .attr('x', 14)
    .attr('y', 0)
    .attr('text-anchor', 'start')
    .text('Hatched: low confidence');

  const note = uncertainty.append('text')
    .attr('class', 'legend-label legend-uncertainty-note')
    .attr('x', 14)
    .attr('y', 11)
    .attr('text-anchor', 'start')
    .text('(current rating)');
  note.append('title').text(FALLBACK_NOTE_TITLE);

  updateLegendUncertainty();
}

/**
 * Show the uncertainty key while "Show uncertainty" is on. While a past
 * date is shown and history records no confidence for it, the hatch uses
 * current confidence and a second line says so; the row moves up a line
 * to make room above "No data".
 */
export function updateLegendUncertainty(): void {
  const key = select('#map .legend-uncertainty');
  if (key.empty()) return;
  const { showUncertainty } = getState();
  const fallback = showUncertainty && confidenceFallsBackAtDate();
  key
    .attr('display', showUncertainty ? null : 'none')
    .attr('transform', `translate(0, ${fallback ? -36 : -25})`);
  key.select('.legend-uncertainty-note').attr('display', fallback ? null : 'none');
}

export function updateLegendLabels(): void {
  const { currentAttribute } = getState();
  const endpoints = LEGEND_ENDPOINTS[currentAttribute] || ['Low', 'High'];
  select('.legend-label-low').text(endpoints[0]);
  select('.legend-label-high').text(endpoints[1]);
}
