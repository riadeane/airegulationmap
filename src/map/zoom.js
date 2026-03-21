import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition';

import { WIDTH, HEIGHT } from '../constants.js';

export function setupZoom(svg, mapGroup) {
  const zoom = d3Zoom()
    .scaleExtent([1, 8])
    .extent([[0, 0], [WIDTH, HEIGHT]])
    .translateExtent([[0, 0], [WIDTH, HEIGHT]])
    .on('zoom', (event) => {
      mapGroup.attr('transform', event.transform);
    });

  svg.call(zoom);

  select('#zoom-controls').append('button')
    .text('+')
    .on('click', () => zoom.scaleBy(svg.transition().duration(750), 1.5));

  select('#zoom-controls').append('button')
    .text('-')
    .on('click', () => zoom.scaleBy(svg.transition().duration(750), 0.67));

  select('#zoom-controls').append('button')
    .html('&#x21BA;')
    .on('click', () => {
      svg.transition().duration(750).call(zoom.transform, zoomIdentity);
    });
}
