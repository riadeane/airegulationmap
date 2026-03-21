import { select } from 'd3-selection';
import 'd3-transition';

let tooltipEl;

export function createTooltip() {
  tooltipEl = select('body').append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);
}

export function showTooltip(event, html) {
  tooltipEl.transition().duration(200).style('opacity', 0.9);
  tooltipEl.html(html)
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 28) + 'px');
}

export function hideTooltip() {
  tooltipEl.transition().duration(500).style('opacity', 0);
}
