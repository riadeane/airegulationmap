import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// Design rules (#140). CLAUDE.md and .impeccable.md rule out glassmorphism
// (backdrop-filter), border-left stripes, and pure black or white (neutrals
// are tinted toward the brand hue; shadows use --shadow-color). #10 removed
// the blur once and it came back, so every stylesheet in src/styles/ and
// every inline <style> block in the HTML entries is checked here.

const ROOT = new URL('../', import.meta.url);

function filesIn(dir, ext) {
  return readdirSync(new URL(dir, ROOT)).filter(f => f.endsWith(ext)).map(f => `${dir}${f}`);
}

const SOURCES = [
  ...filesIn('src/styles/', '.css'),
  ...filesIn('', '.html'),
  ...filesIn('public/', '.html'),
];

// Deliberate exceptions, matched on file, rule and selector.
const ALLOWED = [
  // The side panel's and the comparison panel's full-height edges where
  // they meet the map: a pane divider, not a stripe on a block of content.
  { file: 'src/styles/_panel.css', rule: 'border-left stripe', selector: '#country-panel' },
  { file: 'src/styles/_comparison.css', rule: 'border-left stripe', selector: '#comparison-panel' },
  // Swagger UI ships light-only and paints its own pure white; the canvas
  // matches it so the dark theme's invert filter treats both alike.
  { file: 'api-docs.html', rule: 'pure black or white', selector: '#swagger-ui' },
];

const blank = s => s.replace(/[^\n]/g, ' ');

// The CSS of a file with comments (and, in HTML, everything outside
// <style>) blanked to spaces, so offsets still give the file's line numbers.
function cssOf(file, text) {
  let css = text;
  if (file.endsWith('.html')) {
    css = blank(text);
    for (const m of text.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>/g)) {
      const at = m.index + m[1].length;
      css = css.slice(0, at) + m[2] + css.slice(at + m[2].length);
    }
  }
  return css.replace(/\/\*[\s\S]*?\*\//g, blank);
}

// A left border that draws: not none, hidden, zero width or transparent.
const LEFT_BORDER = /\bborder-(?:left|inline-start)(?:-width)?\s*:\s*([^;]+)/g;
const NOT_DRAWN = /^(?:none|hidden|0[a-z%]*)(?:\s|!|$)|\btransparent\b/i;

// rgb(0, 0, 0 ...), rgba(0,0,0 ...) and rgb(0 0 0 / ...), and the same
// for 255 (pure white).
const RGB_BLACK = /\brgba?\(\s*(?:0\s*[,\s]\s*0\s*[,\s]\s*0|255\s*[,\s]\s*255\s*[,\s]\s*255)(?![.\d])/gi;
// oklch(100% 0 0), oklch(0% 0 0), oklch(1 0 0): lightness at an end and no
// chroma, so no hue tint.
const OKLCH_PURE = /\boklch\(\s*(?:100%|0%|1|0)\s+0\s+0(?:\s|\)|\/)/gi;
// #000, #fff, #000000, #ffffff (and their alpha forms).
const HEX = /#([0-9a-f]{3,8})\b/gi;
function isPureHex(hex) {
  if (![3, 4, 6, 8].includes(hex.length)) return false;
  const rgb = hex.length <= 4 ? hex.slice(0, 3) : hex.slice(0, 6);
  return /^(?:0+|f+)$/i.test(rgb);
}

/** Every rule violation in one file's CSS, as `file:line selector: text`. */
function designViolations(file, text) {
  const css = cssOf(file, text);
  const found = [];
  const lineAt = i => css.slice(0, i).split('\n').length;

  // Innermost blocks only, so a rule inside @media reads its own selector:
  // the text back to the previous brace.
  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    const from = Math.max(css.lastIndexOf('{', block.index - 1), css.lastIndexOf('}', block.index - 1)) + 1;
    const selector = css.slice(from, block.index).trim().replace(/\s+/g, ' ');
    const bodyAt = block.index + 1;
    const body = block[1];
    const report = (rule, at, what) => {
      const allowed = ALLOWED.some(a => a.file === file && a.rule === rule && a.selector === selector);
      if (!allowed) found.push(`${rule}: ${file}:${lineAt(bodyAt + at)} ${selector} { ${what.trim()} }`);
    };

    for (const m of body.matchAll(/[-\w]*backdrop-filter\s*:[^;]*/g)) report('backdrop-filter', m.index, m[0]);
    for (const m of body.matchAll(LEFT_BORDER)) {
      if (!NOT_DRAWN.test(m[1].trim())) report('border-left stripe', m.index, m[0]);
    }
    for (const m of body.matchAll(RGB_BLACK)) report('pure black or white', m.index, m[0]);
    for (const m of body.matchAll(OKLCH_PURE)) report('pure black or white', m.index, m[0]);
    for (const m of body.matchAll(HEX)) {
      if (isPureHex(m[1])) report('pure black or white', m.index, m[0]);
    }
  }
  return found;
}

describe('design rules', () => {
  it('finds the stylesheets it is meant to check', () => {
    expect(SOURCES).toContain('src/styles/_tokens.css');
    expect(SOURCES).toContain('index.html');
    expect(SOURCES).toContain('public/methodology.html');
  });

  it('no stylesheet or inline style uses backdrop-filter, a left stripe, or pure black or white', () => {
    const found = SOURCES.flatMap(file => designViolations(file, readFileSync(new URL(file, ROOT), 'utf8')));
    expect(found).toEqual([]);
  });

  it('catches each banned pattern and lets the harmless forms through', () => {
    const css = `
      .a { backdrop-filter: blur(4px); }
      .b { -webkit-backdrop-filter: blur(4px); }
      .c { border-left: 2px solid var(--border); }
      .d { border-left-width: 1px; }
      .e { box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
      .f { background: rgb(0 0 0 / 0.4); }
      .g { color: #000; border-color: #FFF; }
      .h { color: #ffffff; background: #000000; }
      @media print { .i { color: #000; } }
      .j { --surface-raised: oklch(100% 0 0); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07); }
      .k { color: oklch(0% 0 0 / 0.5); }
      .ok { border-left: none; border-left: 0; border-left: 0px solid red; }
      .ok2 { color: #0a0a0a; background: #fefdfc; box-shadow: 0 1px 2px rgba(0, 0, 0.5, 0); }
      .ok3 { color: oklch(99.8% 0.0015 80); background: oklch(100% 0.01 80); }
      /* .commented { backdrop-filter: blur(2px); color: #000; } */
      #add-btn { color: var(--accent); }
    `;
    const found = designViolations('test.css', css);
    expect(found).toHaveLength(14);
    expect(found.filter(f => f.startsWith('backdrop-filter'))).toHaveLength(2);
    expect(found.filter(f => f.startsWith('border-left stripe'))).toHaveLength(2);
    expect(found.filter(f => f.startsWith('pure black or white'))).toHaveLength(10);
    expect(found.some(f => f.includes('.i {'))).toBe(true);
    expect(found.some(f => f.includes('.ok'))).toBe(false);
  });

  it('reads only the <style> blocks of an HTML file, with its line numbers', () => {
    const html = '<p style="color:#000">#fff</p>\n<style>\n  .x { color: #fff; }\n</style>';
    expect(designViolations('page.html', html)).toEqual([
      'pure black or white: page.html:3 .x { #fff }',
    ]);
  });
});
