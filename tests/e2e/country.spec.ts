import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The static country pages written at build time by scripts/build_pages.ts.
// No route mocks: a page fetches nothing, so it must read fully with
// JavaScript off, pass the same accessibility bar as the docs pages, and
// share the theme toggle with the app.

test('a country page reads fully without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/country/chile/');
  await expect(page.locator('h1')).toHaveText('Chile');
  await expect(page.locator('a.btn[href="/?country=Chile"]')).toBeVisible();
  await expect(page.locator('ol.sources li').first()).toBeVisible();
  await expect(page.locator('table.subscores').first()).toBeVisible();
  await expect(page.locator('nav.entry-nav a[rel="prev"]')).toHaveAttribute('href', '/country/chad/');
  await expect(page.locator('nav.entry-nav a[rel="next"]')).toHaveAttribute('href', '/country/china/');
  await context.close();
});

test('country pages pass accessibility checks and share the theme toggle', async ({ page }) => {
  await page.goto('/country/chile/');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => v.id))).toEqual([]);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The choice persists to the docs pages (shared localStorage key).
  await page.goto('/methodology.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the country index links every page in the sitemap', async ({ page, request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const countryPaths = [...sitemap.matchAll(/<loc>https:\/\/airegulationmap\.org(\/country\/[a-z0-9-]+\/)<\/loc>/g)]
    .map(m => m[1]);
  expect(countryPaths.length).toBeGreaterThan(190);
  await page.goto('/country/');
  const hrefs = await page.locator('ul.country-list a').evaluateAll(list => list.map(a => a.getAttribute('href')));
  expect(hrefs).toEqual(countryPaths);
});

test('the panel copies a permanent link to the country page', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?country=Chile');
  await expect(page.locator('#country-name')).toHaveText('Chile');
  await page.click('#permalink-btn');
  await expect(page.locator('#permalink-btn')).toHaveText('Copied ✓');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/country/chile/`);
});

test('the panel opens a pre-filled GitHub issue for the country', async ({ page, context }) => {
  // Nothing leaves the runner: the popup's GitHub request is answered here.
  await context.route('https://github.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' })
  );
  await page.goto('/?country=Chile');
  await expect(page.locator('#country-name')).toHaveText('Chile');
  const [popup] = await Promise.all([context.waitForEvent('page'), page.click('#report-btn')]);
  await popup.waitForLoadState();
  const url = new URL(popup.url());
  expect(url.origin + url.pathname).toBe('https://github.com/riadeane/airegulationmap/issues/new');
  expect(url.searchParams.get('template')).toBe('data-error.yml');
  expect(url.searchParams.get('title')).toBe('Data: Chile');
  expect(url.searchParams.get('labels')).toBe('data');
  expect(url.searchParams.get('country')).toBe('Chile');
  const entry = url.searchParams.get('entry') ?? '';
  expect(entry).toContain('**Country:** Chile');
  expect(entry).toContain('**Confidence:** Medium');
  expect(entry).toMatch(/\*\*Data version:\*\* \d+/);
  expect(entry).toMatch(/\| Regulation Status \| \d/);
  expect(entry).toContain('**App URL:** http://localhost:4173/?country=Chile');
  expect(entry).toMatch(/\*\*Sources \(\d+\):\*\*\n\n1\. https?:\/\//);
  expect(entry.length).toBeLessThanOrEqual(6000);
  await popup.close();
});
