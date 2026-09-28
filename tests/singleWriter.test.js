import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// Single writer (#150). Every state write goes through an intent in
// src/state/interactions.ts, the only module outside src/state/ allowed to
// call setState. Three controls once wrote the store directly and so
// skipped whatever the intent did alongside the write. This fails if any
// module outside src/state/ imports setState (or the whole store module,
// which would reach it as a property) or re-exports it.

const SRC = new URL('../src/', import.meta.url);

const modules = readdirSync(SRC, { recursive: true })
  .map(p => String(p).split('\\').join('/'))
  .filter(p => p.endsWith('.ts') && !p.startsWith('state/'));

const STORE_PATH = /(?:^|\/)state\/store$/;
const FROM = /\b(import|export)\s+(?:type\s+)?([^;'"]*?)\s+from\s+['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function storeWrites(path) {
  const src = readFileSync(new URL(path, SRC), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found = [];
  for (const m of src.matchAll(FROM)) {
    const [, kind, clause, from] = m;
    if (!STORE_PATH.test(from)) continue;
    if (/\bsetState\b/.test(clause)) found.push(`${path}: ${kind}s setState`);
    else if (/^\*/.test(clause.trim())) found.push(`${path}: ${kind}s the store as a namespace`);
  }
  for (const m of src.matchAll(DYNAMIC)) {
    if (STORE_PATH.test(m[1])) found.push(`${path}: imports the store dynamically`);
  }
  return found;
}

describe('single writer', () => {
  it('scans the feature, data and entry modules', () => {
    expect(modules).toContain('main.ts');
    expect(modules).toContain('panel/index.ts');
    expect(modules).toContain('data/hydrate.ts');
    expect(modules.some(p => p.startsWith('state/'))).toBe(false);
  });

  it('no module outside src/state/ imports setState', () => {
    expect(modules.flatMap(storeWrites)).toEqual([]);
  });

  it('src/state/interactions.ts is where the writes go', () => {
    const src = readFileSync(new URL('state/interactions.ts', SRC), 'utf8');
    expect(src).toMatch(/import \{[^}]*\bsetState\b[^}]*\} from '\.\/store'/);
  });
});
