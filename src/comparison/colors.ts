// Comparison palette sourced from CSS tokens so it swaps with theme.
// Index stability (country → slot) lives in comparison/colorSlots.ts.
//
// Colours are handed out as var() references, not resolved values: the
// chips, the table header and the radar keep them in inline styles, so a
// theme switch recolours them with no re-render. (Resolving once at render
// time left the dark theme's amber at ~2:1 contrast on the light theme.)

const TOKENS = ['--comparison-1', '--comparison-2', '--comparison-3', '--comparison-4'];

export function comparisonColor(index: number): string {
  return `var(${TOKENS[index % TOKENS.length]})`;
}
