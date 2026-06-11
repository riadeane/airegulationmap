import { select } from 'd3-selection';
import type { Selection } from 'd3-selection';
import 'd3-transition';

let tooltipEl: Selection<HTMLDivElement, unknown, HTMLElement, unknown> | undefined;

// Idempotent — the map and the scatter plot share one tooltip element.
export function createTooltip(): void {
  if (tooltipEl && document.body.contains(tooltipEl.node())) return;
  select('body').selectAll('div.tooltip').remove();
  tooltipEl = select('body').append<HTMLDivElement>('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);
}

export function showTooltip(event: MouseEvent, html: string): void {
  if (!tooltipEl) createTooltip();
  tooltipEl!.transition().duration(200).style('opacity', 0.9);
  tooltipEl!.html(html)
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 28) + 'px');
}

export function hideTooltip(): void {
  if (!tooltipEl) return;
  tooltipEl.transition().duration(500).style('opacity', 0);
}
