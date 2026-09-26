import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The researcher-facing docs: the static Data & API overview and the
// self-hosted Swagger UI reference. Neither page needs route mocks: the
// overview makes no requests on load, and the Swagger page reads only the
// committed spec snapshot (public/openapi.json).

test('data.html is a static overview that routes to the API reference', async ({ page }) => {
  await page.goto('/data.html');

  // Dataset downloads and the endpoint overview render statically.
  await expect(page.locator('a[download]')).toHaveCount(7);
  const endpointLinks = page.locator('a[href^="/api-docs.html#/"]');
  await expect(endpointLinks).toHaveCount(9);

  // The API reference is one click away from header, body CTA, and footer.
  await expect(page.locator('.header-links a[href="/api-docs.html"]')).toBeVisible();
  await expect(page.locator('a.btn[href="/api-docs.html"]')).toBeVisible();
  await expect(page.locator('footer a[href="/api-docs.html"]')).toBeVisible();

  // Recipes are plain links that carry the read-only token, so they open
  // live JSON in the browser with no JS on this page.
  const recipes = page.locator('.recipe-open');
  await expect(recipes).toHaveCount(4);
  for (const href of await recipes.evaluateAll(list => list.map(a => (a as HTMLAnchorElement).href))) {
    expect(href).toContain('/rest/v1/');
    expect(href).toContain('apikey=');
  }

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => v.id))).toEqual([]);
});

test('drift.html renders its figures from the committed files', async ({ page }) => {
  // No route mocks: history.json, regulation_data.csv, data/blocs.json and
  // data/drift.json are served as static assets. The build has no Supabase
  // env here, so the run table falls back to what the files record.
  await page.goto('/drift.html');
  await expect(page.locator('figure.chart')).toHaveCount(5);
  // Score movement, deltas, confidence and the bloc grid plot; the gold-set
  // figure shows its empty state until drift.json carries a check.
  await expect(page.locator('figure#changes svg')).toBeVisible();
  await expect(page.locator('figure#deltas svg')).toBeVisible();
  await expect(page.locator('figure#confidence svg')).toBeVisible();
  await expect(page.locator('figure#blocs svg')).toBeVisible();
  // Every figure carries a caption with its key numbers and a table twin
  // where there is a plot.
  const captions = page.locator('figure.chart figcaption');
  await expect(captions).toHaveCount(5);
  for (const text of await captions.allInnerTexts()) expect(text.trim().length).toBeGreaterThan(20);
  await expect(page.locator('figure.chart details table')).toHaveCount(4);
  // The latest run section lists the largest moves with app deep links.
  await expect(page.locator('#drift-run h2')).toHaveText('Latest run');
  await expect(page.locator('#drift-run table a[href^="/?country="]').first()).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => v.id))).toEqual([]);
});

test('docs pages have a working theme toggle', async ({ page }) => {
  await page.goto('/data.html');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // The choice persists to the API reference page (shared localStorage key).
  await page.click('#theme-toggle');
  await page.goto('/api-docs.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('api-docs.html renders Swagger UI from the committed spec snapshot', async ({ page }) => {
  // No route mocks: the spec is the real public/openapi.json snapshot,
  // served like any other static asset. (Supabase gates the live spec
  // endpoint behind secret keys, so the page must never fetch it.)
  await page.goto('/api-docs.html');
  await expect(page.locator('#swagger-ui .info .title')).toContainText('AI Regulation Map API');
  await expect(page.locator('#swagger-ui .opblock-summary-path').first()).toBeVisible();
  const paths = await page.locator('#swagger-ui .opblock-summary-path').allInnerTexts();
  expect(paths).toContain('/countries');
  expect(paths).toContain('/public_export');
  // Anon access is SELECT-only: the page strips the write verbs PostgREST
  // advertises, and the secret-key-only root path.
  await expect(page.locator('#swagger-ui .opblock-post, #swagger-ui .opblock-patch, #swagger-ui .opblock-delete')).toHaveCount(0);
  expect(paths).not.toContain('/');

  // SQL comments flow through as endpoint summaries, and expanding an
  // endpoint shows each filter parameter prefixed with its real column type
  // (the spec types every filter param "string" because its value is a
  // filter expression).
  const countriesBlock = page.locator('#swagger-ui .opblock', { hasText: '/countries' }).first();
  await expect(countriesBlock).toContainText('Canonical country registry');
  await countriesBlock.locator('.opblock-summary').click();
  await expect(countriesBlock).toContainText('alpha-3');
  await expect(countriesBlock.locator('.parameters-col_description').filter({ hasText: 'filter expression' }).first()).toBeVisible();

  // The schemas section doubles as the column reference: present, collapsed.
  await expect(page.locator('#swagger-ui section.models')).toBeVisible();
});

// Regression: at 360px the latest-run "largest moves" table sat outside a
// scroll box and widened the whole page.
test('drift.html fits a 360px phone without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/drift.html');
  await expect(page.locator('#drift-run table a[href^="/?country="]').first()).toBeAttached();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// Regression: the calibration callout read "Calibration break.This run",
// and "Also changed" listed a confidence-only change as "Germany: ".
test('changes.html spaces the calibration callout and states confidence changes', async ({ page }) => {
  await page.route('**/digest/index.json', route => route.fulfill({
    json: { weeks: [{ week: '2026-W39', date: '2026-09-21', file: '2026-W39.json', change_count: 1 }] },
  }));
  await page.route('**/digest/2026-W39.json', route => route.fulfill({
    json: {
      schema_version: 1,
      week: '2026-W39',
      date: '2026-09-21',
      model: 'claude-opus-5-5',
      lead: 'One country moved.',
      calibration_break: { date: '2026-09-21', model: 'claude-opus-5-5', reason: 'Model switch' },
      items: [],
      changes: [{
        country: 'Germany', scores: {}, laws: null,
        confidence: { old: 'medium', new: 'high' }, sources: [], new_sources: [],
      }],
    },
  }));
  await page.goto('/changes.html');
  await expect(page.locator('.callout')).toContainText('Calibration break. This run re-scored every country');
  await expect(page.locator('.change-uncovered li')).toHaveText('Germany: confidence medium → high');
});

