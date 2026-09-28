import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// #166: PRD 16 replaced the red-to-blue score ramp with --ramp-impl-* and
// --ramp-style-* in _tokens.css, but drift.html kept its own copy of the
// old --score-low (red) / --score-high tokens and the drift charts read
// --score-high, so the dashboard's blue was not the map's. The charts now
// read --ramp-impl-high from the shared token file, which the page's entry
// imports; drift.html's inline mirror keeps only the page tokens.

const driftHtml = readFileSync('drift.html', 'utf8');
const tokensCss = readFileSync('src/styles/_tokens.css', 'utf8');
const chartSource = readFileSync('src/charts/drift.ts', 'utf8');
const entrySource = readFileSync('src/drift.ts', 'utf8');

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The body of the first rule whose selector starts at `selector` (searched
// from `from`), braces balanced so a nested block stays whole.
function ruleBody(css, selector, from = 0) {
  const at = css.indexOf(selector, from);
  if (at < 0) throw new Error(`no rule ${selector}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced rule ${selector}`);
}

function declarations(body) {
  const tokens = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim().replace(/\s+/g, ' ');
  }
  return tokens;
}

// The three theme blocks both files share: the dark default, light by
// system preference (no explicit choice), and the explicit light theme.
function themeBlocks(source) {
  const css = stripComments(source);
  const media = ruleBody(css, '@media (prefers-color-scheme: light)');
  return {
    dark: declarations(ruleBody(css, ':root {')),
    systemLight: declarations(ruleBody(media, ':root:not([data-theme])')),
    light: declarations(ruleBody(css, ":root[data-theme='light']")),
  };
}

describe('drift dashboard tokens', () => {
  it('drift.html defines no old score tokens', () => {
    expect(driftHtml).not.toMatch(/--score-(low|high)\s*:/);
    expect(driftHtml).not.toMatch(/--score-(low|high)\b/);
  });

  it('the charts read the map ramp from the shared token file', () => {
    expect(chartSource).toContain("cssVar('--ramp-impl-high')");
    expect(chartSource).not.toMatch(/--score-(low|high)\b/);
    expect(entrySource).toMatch(/^import '\.\/styles\/_tokens\.css';$/m);
  });

  it('the shared token file defines the ramp in every theme block', () => {
    for (const [theme, tokens] of Object.entries(themeBlocks(tokensCss))) {
      expect(tokens['--ramp-impl-high'], theme).toMatch(/^oklch\(/);
    }
  });

  it("drift.html's inline mirror matches _tokens.css in every theme block", () => {
    // Both apply on the page, so a value that drifted would make the prose
    // and the charts disagree depending on which stylesheet loads last.
    const shared = themeBlocks(tokensCss);
    const inline = themeBlocks(driftHtml);
    for (const theme of Object.keys(shared)) {
      expect(Object.keys(inline[theme]).length, theme).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(inline[theme])) {
        expect(shared[theme][name], `${theme} ${name}`).toBe(value);
      }
    }
  });
});
