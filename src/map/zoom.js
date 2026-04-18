import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition';

// d3-zoom accepts a function for .extent() (evaluated lazily) but NOT
// for .translateExtent() — the latter must be a concrete 2x2 array.
// We therefore expose an updateBounds hook the renderer can call after
// a resize to keep the pan bounds in sync with the new viewport size.
export function setupZoom(svg, mapGroup, getSize) {
  const zoom = d3Zoom()
    .scaleExtent([1, 8])
    .extent(() => {
      const { w, h } = getSize();
      return [[0, 0], [w, h]];
    })
    .on('zoom', (event) => {
      mapGroup.attr('transform', event.transform);
    });

  // Seed with the current size; the renderer will call updateZoomBounds
  // on resize to keep this current.
  const initial = getSize();
  zoom.translateExtent([[0, 0], [initial.w, initial.h]]);

  svg.call(zoom);

  select('#zoom-controls').append('button')
    .text('+')
    .attr('type', 'button')
    .attr('aria-label', 'Zoom in')
    .on('click', () => zoom.scaleBy(svg.transition().duration(400), 1.5));

  select('#zoom-controls').append('button')
    .text('\u2212')
    .attr('type', 'button')
    .attr('aria-label', 'Zoom out')
    .on('click', () => zoom.scaleBy(svg.transition().duration(400), 0.67));

  select('#zoom-controls').append('button')
    .html('&#x21BA;')
    .attr('type', 'button')
    .attr('aria-label', 'Reset zoom')
    .on('click', () => {
      svg.transition().duration(400).call(zoom.transform, zoomIdentity);
    });

  return {
    updateBounds({ w, h }) {
      zoom.translateExtent([[0, 0], [w, h]]);
    },
  };
}
