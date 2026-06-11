import { select } from 'd3-selection';
import 'd3-transition';

let tooltipEl;

// Idempotent — the map and the scatter plot share one tooltip element.
export function createTooltip() {
  if (tooltipEl && document.body.contains(tooltipEl.node())) return;
  select('body').selectAll('div.tooltip').remove();
  tooltipEl = select('body').append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);
}

export function showTooltip(event, html) {
  if (!tooltipEl) createTooltip();
  tooltipEl.transition().duration(200).style('opacity', 0.9);
  tooltipEl.html(html)
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 28) + 'px');
}

export function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.transition().duration(500).style('opacity', 0);
}
