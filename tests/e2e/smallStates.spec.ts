import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Small states (#104): scored countries the 1:110m atlas has no shape for
// are drawn as point markers from public/data/small_states.json. Each
// marker is a `.country` path, so it takes the same fill, pointer handlers
// and filter opacity as a country shape.

type Marked = { __data__?: { properties?: { name?: string } } };

// The marker's on-screen centre and radius, once it hit-tests to itself.
async function marker(page: Page, name: string): Promise<{ x: number; y: number; r: number } | null> {
  return page.evaluate((name) => {
    const path = Array.from(document.querySelectorAll('#map path.country.small-state'))
      .find(el => (el as unknown as Marked).__data__?.properties?.name === name);
    if (!path) return null;
    const box = path.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return document.elementFromPoint(x, y) === path ? { x, y, r: box.width / 2 } : null;
  }, name);
}

async function opacityOf(page: Page, name: string): Promise<number> {
  return page.evaluate((name) => {
    const path = Array.from(document.querySelectorAll('#map path.country'))
      .find(el => (el as unknown as Marked).__data__?.properties?.name === name);
    return path ? Number(getComputedStyle(path).opacity) : NaN;
  }, name);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country.small-state', { timeout: 15_000 });
});

test('every small state in the points file has a marker', async ({ page }) => {
  const expected = await page.evaluate(async () => {
    const file = await (await fetch('/data/small_states.json')).json() as { countries: { name: string }[] };
    return file.countries.map(c => c.name).sort();
  });
  expect(expected).toContain('Singapore');
  const drawn = await page.$$eval('#map path.country.small-state',
    ps => ps.map(p => (p as unknown as Marked).__data__!.properties!.name!).sort());
  expect(drawn).toEqual(expected);
  // Above the country hatch, so a hatched neighbour never stripes them.
  const order = await page.$$eval('#map .map-group > g', gs => gs.map(g => g.getAttribute('class')));
  expect(order).toEqual(['hatch-layer', 'small-state-layer', 'small-state-hatch-layer']);
  // Keyboard and screen-reader users reach them through the country table.
  await expect(page.locator('#country-table .country-table-pick[data-country="Singapore"]')).toHaveCount(1);
});

test("Singapore's marker hovers, opens its panel and outlines as selected", async ({ page }) => {
  await expect.poll(() => marker(page, 'Singapore')).not.toBeNull();
  const point = (await marker(page, 'Singapore'))!;

  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.tooltip strong')).toContainText('Singapore');

  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#country-name')).toHaveText('Singapore');
  await expect(page.locator('#map path.country.small-state.selected')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('country')).toBe('Singapore');
  // Drawn above the other markers, so an overlapping neighbour never hides
  // part of its outline.
  expect(await page.locator('#map .small-state-layer').evaluate(
    layer => (layer.lastElementChild as unknown as Marked).__data__?.properties?.name,
  )).toBe('Singapore');
});

test('a marker keeps its screen size as the map zooms', async ({ page }) => {
  await expect.poll(() => marker(page, 'Malta')).not.toBeNull();
  const before = (await marker(page, 'Malta'))!;
  await page.click('#zoom-controls button[aria-label="Zoom in"]');
  await page.click('#zoom-controls button[aria-label="Zoom in"]');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const path = Array.from(document.querySelectorAll('#map path.country.small-state'))
      .find(el => (el as unknown as Marked).__data__?.properties?.name === 'Malta')!;
    return path.getBoundingClientRect().width / 2;
  });
  expect(after).toBeCloseTo(before.r, 0);
});

test('the bloc filter dims markers outside the bloc', async ({ page }) => {
  await page.goto('/?bloc=EU');
  await page.waitForSelector('#map svg path.country.small-state', { timeout: 15_000 });
  await expect.poll(() => opacityOf(page, 'Malta')).toBe(1);
  await expect.poll(() => opacityOf(page, 'Singapore')).toBeCloseTo(0.15, 2);
});
