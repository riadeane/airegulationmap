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

// Scored countries on the map, split by current confidence: `low` is the
// set the default view must hatch; `other` are rated medium or high.
async function mapConfidence(page: Page): Promise<{ low: string[]; other: string[] }> {
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
    const level = new Map(reg.map(r => [r.Country, r.Confidence.trim().toLowerCase()]));
    const onMap = Array.from(
      document.querySelectorAll<SVGPathElement>('#map path.country'),
      p => (p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name,
    ).filter(name => scored.has(name));
    return {
      low: onMap.filter(name => level.get(name) === 'low').sort(),
      other: onMap.filter(name => level.get(name) === 'medium' || level.get(name) === 'high').sort(),
    };
  });
}

async function expectedHatched(page: Page): Promise<string[]> {
  return (await mapConfidence(page)).low;
}

// A large low-confidence country hovers reliably; any hatched one would do.
function pickHatched(low: string[]): string {
  return ['Chad', 'Niger', 'Mali', 'Libya'].find(n => low.includes(n)) ?? low[0];
}

async function scrubToEarliest(page: Page): Promise<void> {
  await page.locator('#timeline-slider').evaluate((el: HTMLInputElement) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
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
  const { low, other } = await mapConfidence(page);
  const hatched = pickHatched(low);
  await expect.poll(() => hatchedNames(page)).toContain(hatched);
  await hover(page, hatched);
  await expect(page.locator('.tooltip strong')).toContainText(`${hatched} low confidence`);
  await expect(page.locator('.tooltip')).toContainText('Confidence: low');

  // A country rated medium or high gets its confidence line but no flag.
  const plain = ['Germany', 'France', 'Brazil', 'Canada'].find(n => other.includes(n)) ?? other[0];
  await hover(page, plain);
  await expect(page.locator('.tooltip strong')).toContainText(plain);
  await expect(page.locator('.tooltip .tooltip-flag')).toHaveCount(0);
  await expect(page.locator('.tooltip')).toContainText(/Confidence: (medium|high)/);

  // With the hatch off, nothing is flagged; the confidence line stays.
  await page.click('#filter-btn');
  await page.locator('#show-uncertainty').uncheck();
  await page.click('#filter-btn');
  await hover(page, hatched);
  await expect(page.locator('.tooltip strong')).toContainText(hatched);
  await expect(page.locator('.tooltip .tooltip-flag')).toHaveCount(0);
  await expect(page.locator('.tooltip')).toContainText('Confidence: low');
});

test('the live region says "Low confidence." for a hatched selection only', async ({ page }) => {
  const { low, other } = await mapConfidence(page);
  const hatched = pickHatched(low);
  await page.goto(`/?country=${encodeURIComponent(hatched)}`);
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await expect(page.locator('#map-live-region')).toContainText(`Selected ${hatched}.`);
  await expect(page.locator('#map-live-region')).toContainText('Low confidence.');

  await page.goto(`/?country=${encodeURIComponent(other[0])}`);
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await expect(page.locator('#map-live-region')).toContainText(`Selected ${other[0]}.`);
  await expect(page.locator('#map-live-region')).not.toContainText('Low confidence.');
});

test('a hatched country keeps its selection outline above the texture', async ({ page }) => {
  const hatched = pickHatched(await expectedHatched(page));
  await page.goto(`/?country=${encodeURIComponent(hatched)}`);
  await page.waitForSelector('#map svg path.country.selected', { timeout: 15_000 });
  const outline = (name: string) => page.evaluate((name) => {
    const find = (sel: string) => Array.from(document.querySelectorAll<SVGPathElement>(sel))
      .find(p => (p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name === name)!;
    const country = find('#map path.country');
    const hatch = find('#map path.country-hatch');
    const others = Array.from(document.querySelectorAll<SVGPathElement>('#map path.country-hatch:not(.selected)'));
    return {
      // The same outline on both paths (stroke + width), once the 0.15s
      // stroke transitions settle.
      sameOutline: getComputedStyle(hatch).stroke === getComputedStyle(country).stroke
        && getComputedStyle(hatch).strokeWidth === getComputedStyle(country).strokeWidth
        && getComputedStyle(hatch).stroke !== 'none',
      hatchIsLast: hatch.parentNode!.lastElementChild === hatch,
      othersStroked: others.filter(p => getComputedStyle(p).stroke !== 'none').length,
    };
  }, name);
  await expect.poll(() => outline(hatched)).toEqual({ sameOutline: true, hatchIsLast: true, othersStroked: 0 });
});

test('a low-confidence country with no score keeps the plain no-data fill', async ({ page }) => {
  const hatched = pickHatched(await expectedHatched(page));
  await page.route('**/scores.csv', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).split('\n').map((line) => {
      const cells = line.split(',');
      if (cells[0] !== hatched) return line;
      cells[5] = ''; // Average Score
      return cells.join(',');
    }).join('\n');
    await route.fulfill({ response: res, body });
  });
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await expect.poll(async () => (await hatchedNames(page)).length).toBeGreaterThan(0);
  expect(await hatchedNames(page)).not.toContain(hatched);
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
  // 1.5x snaps to the 2^(1/2) step: scale(1/1.414...).
  await expect(page.locator('#hatch-low')).toHaveAttribute('patternTransform', /^rotate\(45\) scale\(0\.707/, { timeout: 5_000 });
  await page.click('#zoom-controls button[aria-label="Reset zoom"]');
  await expect(page.locator('#hatch-low')).toHaveAttribute('patternTransform', 'rotate(45)', { timeout: 5_000 });
});

// history.json routed through a rewrite of every snapshot's confidence.
async function routeHistory(page: Page, confidenceFor: (country: string) => string | undefined): Promise<void> {
  await page.route('**/history.json', async (route) => {
    const res = await route.fetch();
    const history = await res.json();
    for (const [country, snaps] of Object.entries(history.countries as Record<string, { confidence?: string }[]>)) {
      for (const snap of snaps) {
        const level = confidenceFor(country);
        if (level) snap.confidence = level;
        else delete snap.confidence;
      }
    }
    await route.fulfill({ response: res, json: history });
  });
}

test('on a past date without recorded confidence the hatch uses current ratings and says so', async ({ page }) => {
  const hatched = pickHatched(await expectedHatched(page));
  await routeHistory(page, () => undefined);
  await page.goto('/');
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });
  const note = page.locator('#map .legend-uncertainty-note');
  await expect(note).toBeHidden();

  await scrubToEarliest(page);
  await expect(note).toBeVisible();
  await expect(note).toContainText('(current rating)');
  await expect.poll(() => hatchedNames(page)).toContain(hatched);

  await page.click('#timeline-reset');
  await expect(note).toBeHidden();
});

test('on a past date with recorded confidence the hatch follows the snapshot', async ({ page }) => {
  // Every snapshot records "medium", except the hatched country, which the
  // history rates "high" although its current record is low.
  const hatched = pickHatched(await expectedHatched(page));
  await routeHistory(page, country => (country === hatched ? 'high' : 'medium'));
  await page.goto('/');
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });
  await expect.poll(() => hatchedNames(page)).toContain(hatched);

  await scrubToEarliest(page);
  // Rated high at that date, so no hatch; and every snapshot recorded a
  // confidence, so the legend needs no fallback note.
  await expect.poll(() => hatchedNames(page)).not.toContain(hatched);
  await expect(page.locator('#map .legend-uncertainty-note')).toBeHidden();
  await hover(page, hatched);
  await expect(page.locator('.tooltip')).toContainText('Confidence: high');
  await expect(page.locator('.tooltip .tooltip-flag')).toHaveCount(0);

  await page.click('#timeline-reset');
  await expect.poll(() => hatchedNames(page)).toContain(hatched);
});

test('hatch geometry tracks the country geometry through a resize', async ({ page }) => {
  const mismatches = () => page.evaluate(() => {
    const byName = new Map<string, string | null>();
    for (const p of document.querySelectorAll<SVGPathElement>('#map path.country')) {
      byName.set((p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name, p.getAttribute('d'));
    }
    return Array.from(document.querySelectorAll<SVGPathElement>('#map path.country-hatch'))
      .filter(p => byName.get((p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name) !== p.getAttribute('d'))
      .length;
  });
  await expect.poll(async () => (await hatchedNames(page)).length).toBeGreaterThan(0);
  expect(await mismatches()).toBe(0);
  const before = await page.locator('#map path.country').first().getAttribute('d');
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(() => page.locator('#map path.country').first().getAttribute('d')).not.toBe(before);
  expect(await mismatches()).toBe(0);
});

test('controls used while the map geometry loads throw nothing and leave the layers in step', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/countries-110m.json', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await page.waitForSelector('#filter-btn');
  // Toggle the hatch and type a search before any country path exists.
  await page.click('#filter-btn');
  await page.locator('#show-uncertainty').uncheck();
  await page.locator('#show-uncertainty').check();
  await page.click('#filter-btn');
  await page.fill('#country-search', 'Niger');
  release();
  await page.waitForSelector('#map svg path.country-hatch', { timeout: 15_000 });
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);

  // Each hatch path carries its country's search dimming.
  const outOfStep = await page.evaluate(() => {
    const dimmed = new Map<string, boolean>();
    for (const p of document.querySelectorAll<SVGPathElement>('#map path.country')) {
      dimmed.set((p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name, p.classList.contains('search-dimmed'));
    }
    return Array.from(document.querySelectorAll<SVGPathElement>('#map path.country-hatch'))
      .filter(p => dimmed.get((p as unknown as { __data__: { properties: { name: string } } }).__data__.properties.name) !== p.classList.contains('search-dimmed'))
      .length;
  });
  expect(outOfStep).toBe(0);
});
