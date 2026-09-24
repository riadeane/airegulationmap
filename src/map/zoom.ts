import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import type { Selection } from 'd3-selection';
import 'd3-transition';

export interface ZoomHandle {
  updateBounds(size: { w: number; h: number }): void;
}

// d3-zoom accepts a function for .extent() (evaluated lazily) but NOT
// for .translateExtent() - the latter must be a concrete 2x2 array.
// We therefore expose an updateBounds hook the renderer can call after
// a resize to keep the pan bounds in sync with the new viewport size.
//
// `onScale` hears the zoom factor whenever it changes (not on pure pans),
// for artwork that must hold a constant on-screen size inside the zoomed
// group - the low-confidence hatch counter-scales its pattern with it.
export function setupZoom(
  svg: Selection<SVGSVGElement, unknown, HTMLElement, unknown>,
  mapGroup: Selection<SVGGElement, unknown, HTMLElement, unknown>,
  getSize: () => { w: number; h: number },
  onScale?: (k: number) => void
): ZoomHandle {
  let lastK = 1;
  const zoom = d3Zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 8])
    .extent((): [[number, number], [number, number]] => {
      const { w, h } = getSize();
      return [[0, 0], [w, h]];
    })
    .on('zoom', (event) => {
      mapGroup.attr('transform', event.transform);
      const { k } = event.transform;
      if (onScale && k !== lastK) {
        lastK = k;
        onScale(k);
      }
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
