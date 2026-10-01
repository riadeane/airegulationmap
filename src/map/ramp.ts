import { scaleLinear } from 'd3-scale';
import type { ScaleLinear } from 'd3-scale';
import { interpolateLab } from 'd3-interpolate';

import { ATTRIBUTES } from '../constants';
import type { AttributeGroup, AttributeKey } from '../constants';
import { cssVar } from './cssColors';

// The three choropleth ramps (PRD 16), resolved from the theme tokens in
// _tokens.css: implementation (single blue hue, light = less in force),
// governance style (neutral stone) and frontier risk governance (plum,
// light = nothing observable, dark = meets the stated standard). None uses
// red, and none is ever applied to "no data" or "insufficient evidence"
// (fill.ts).

export type ColorScale = ScaleLinear<string, string>;

const RAMP_TOKENS: Record<AttributeGroup, [string, string]> = {
  implementation: ['--ramp-impl-low', '--ramp-impl-high'],
  style: ['--ramp-style-low', '--ramp-style-high'],
  frontier: ['--ramp-frontier-low', '--ramp-frontier-high'],
};

/** The 1-5 colour scale for a lens. Read again after a theme change. */
export function rampFor(group: AttributeGroup): ColorScale {
  const [low, high] = RAMP_TOKENS[group];
  return scaleLinear<string>()
    .domain([1, 5])
    .range([cssVar(low), cssVar(high)])
    .interpolate(interpolateLab)
    .clamp(true);
}

/** The colour scale an attribute is drawn in (its lens's ramp). */
export function makeColorScale(attr: AttributeKey = 'averageScore'): ColorScale {
  return rampFor(ATTRIBUTES[attr].group);
}
