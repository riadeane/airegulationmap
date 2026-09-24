import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// PRD 13: low-confidence countries carry a diagonal hatch over their score
// fill. Runs against the real data the preview build serves, so the
// expected set is derived from regulation_data.csv and scores.csv at test
// time rather than hard-coded.

async function hatchedNames(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(
    document.querySelectorAll<SVGPathElement>('#map path.country-hatch'),
    p => (p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name,
  ).sort());
}

// Countries on the map whose current record is low confidence and whose
// Maturity Index is scored - the set the default view must hatch.
async function expectedHatched(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const parse = (text: string) => {
      // Minimal CSV reader (quoted fields may hold commas and newlines).
      const rows: string[][] = [];
      let row: string[] = [];
      let field = '';
      let quoted = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
          if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
          else if (c === '"') quoted = false;
          else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
      }
      if (field || row.length) { row.push(field); rows.push(row); }
      const [header, ...body] = rows;
      return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
    };
    const [reg, scores] = await Promise.all([
      fetch('/regulation_data.csv').then(r => r.text()).then(parse),
      fetch('/scores.csv').then(r => r.text()).then(parse),
    ]);
    const scored = new Set(scores.filter(r => r['Average Score'] !== '').map(r => r.Country));
    const low = new Set(reg
      .filter(r => r.Confidence.trim().toLowerCase() === 'low' && scored.has(r.Country))
      .map(r => r.Country));
    const onMap = Array.from(
      document.querySelectorAll<SVGPathElement>('#map path.country'),
      p => (p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name,
    );
    return onMap.filter(name => low.has(name)).sort();
  });
}

// Hover a point that hit-tests to the country itself (a bbox centre can
// fall in a neighbour or the sea for concave shapes).
async function hover(page: Page, name: string): Promise<void> {
  const point = await page.evaluate((name) => {
    for (const p of document.querySelectorAll<SVGPathElement>('#map path.country')) {
      const d = (p as unknown as { __data__: { properties: { name: string } } }).__data__;
      if (d.properties.name !== name) continue;
      const r = p.getBoundingClientRect();
      for (let fy = 0.5; fy < 1; fy += 0.1) {
        for (const sy of [fy, 1 - fy]) {
          for (let fx = 0.1; fx < 1; fx += 0.1) {
            const x = r.x + r.width * fx;
            const y = r.y + r.height * sy;
            if (document.elementFromPoint(x, y) === p) return { x, y };
          }
        }
      }
    }
    return null;
  }, name);
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
});

test('hatches exactly the scored low-confidence countries, from one pattern', async ({ page }) => {
  const expected = await expectedHatched(page);
  expect(expected.length).toBeGreaterThan(0);
  await expect.poll(() => hatchedNames(page)).toEqual(expected);

  // One pattern for every hatched path, none per country, and no stroke on
  // the second layer (borders stay as the country paths draw them).
  await expect(page.locator('#map pattern#hatch-low')).toHaveCount(1);
  const fills = await page.$$eval('#map path.country-hatch', ps => [...new Set(ps.map(p => p.getAttribute('fill')))]);
  expect(fills).toEqual(['url(#hatch-low)']);
  const strokes = await page.$$eval('#map path.country-hatch', ps => [...new Set(ps.map(p => getComputedStyle(p).stroke))]);
  expect(strokes).toEqual(['none']);
  expect(await page.locator('#map .hatch-layer').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');

  await expect(page.locator('#map .legend-uncertainty')).toBeVisible();
  await expect(page.locator('#map .legend-uncertainty')).toContainText('Hatched: low confidence');
});

test('the tooltip flags a hatched country in its title line', async ({ page }) => {
  const expected = await expectedHatched(page);
  // A large country hovers reliably; any hatched one would do.
  const hatched = ['Chad', 'Niger', 'Mali', 'Libya'].find(n => expected.includes(n)) ?? expected[0];
  await expect.poll(() => hatchedNames(page)).toContain(hatched);
  await hover(page, hatched);
  await expect(page.locator('.tooltip strong')).toContainText(`${hatched} low confidence`);
  await expect(page.locator('.tooltip')).toContainText('Confidence: low');
});

test('"Show uncertainty" turns the hatch off, persists, and stays out of the URL', async ({ page }) => {
  await page.click('#filter-btn');
  const box = page.locator('#show-uncertainty');
  await expect(box).toBeChecked();

  await box.uncheck();
  await expect(page.locator('#map path.country-hatch')).toHaveCount(0);
  await expect(page.locator('#map .legend-uncertainty')).toBeHidden();
  // A display preference, not a filter.
  await expect(page.locator('#filter-btn')).not.toHaveClass(/has-filter/);
  expect(new URL(page.url()).search).toBe('');

  await page.reload();
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await expect(page.locator('#map path.country-hatch')).toHaveCount(0);
  await page.click('#filter-btn');
  await expect(page.locator('#show-uncertainty')).not.toBeChecked();

  await page.locator('#show-uncertainty').check();
  await expect.poll(async () => (await hatchedNames(page)).length).toBeGreaterThan(0);
  await expect(page.locator('#map .legend-uncertainty')).toBeVisible();
});

test('the hatch keeps its on-screen spacing as the map zooms', async ({ page }) => {
  await expect(page.locator('#hatch-low')).toHaveAttribute('patternTransform', 'rotate(45)');
  await page.click('#zoom-controls button[aria-label="Zoom in"]');
  await expect(page.locator('#hatch-low')).toHaveAttribute('patternTransform', /^rotate\(45\) scale\(0\.66/, { timeout: 5_000 });
  await page.click('#zoom-controls button[aria-label="Reset zoom"]');
  await expect(page.locator('#hatch-low')).toHaveAttribute('patternTransform', 'rotate(45)', { timeout: 5_000 });
});

test('on a past date without recorded confidence the legend says it uses current ratings', async ({ page }) => {
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });
  const historyHasConfidence = await page.evaluate(async () => {
    const history = await fetch('/history.json').then(r => r.json());
    return Object.values(history.countries as Record<string, { confidence?: string }[]>)
      .every(snaps => snaps.every(s => !!s.confidence));
  });
  const note = page.locator('#map .legend-uncertainty-note');
  await expect(note).toBeHidden();

  await page.locator('#timeline-slider').evaluate((el: HTMLInputElement) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (historyHasConfidence) await expect(note).toBeHidden();
  else await expect(note).toBeVisible();

  await page.click('#timeline-reset');
  await expect(note).toBeHidden();
});
