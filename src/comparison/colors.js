// Comparison palette sourced from CSS tokens so it swaps with theme.
// Index stability (country → slot) still lives in comparison/index.js.

import { cssVar } from '../map/cssColors.js';

const TOKENS = ['--comparison-1', '--comparison-2', '--comparison-3', '--comparison-4'];

export function comparisonColor(index) {
  return cssVar(TOKENS[index % TOKENS.length]);
}
