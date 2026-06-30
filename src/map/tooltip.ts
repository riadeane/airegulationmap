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
  const el = tooltipEl!;
  // Set content first so the box is measured at its real size, then
  // position it. Default is down-right of the cursor; flip toward the
  // cursor when the box would overflow the right or bottom edge.
  el.html(html);
  const node = el.node()!;
  const { width, height } = node.getBoundingClientRect();
  const pad = 12;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let left = event.pageX + pad;
  if (event.clientX + pad + width > vw) left = event.pageX - width - pad;
  if (left < window.scrollX + 2) left = window.scrollX + 2;

  let top = event.pageY - 28;
  if (event.clientY - 28 + height > vh) top = event.pageY - height - pad;
  if (top < window.scrollY + 2) top = window.scrollY + 2;

  el.transition().duration(200).style('opacity', 0.9);
  el.style('left', left + 'px').style('top', top + 'px');
}

export function hideTooltip(): void {
  if (!tooltipEl) return;
  tooltipEl.transition().duration(500).style('opacity', 0);
}
