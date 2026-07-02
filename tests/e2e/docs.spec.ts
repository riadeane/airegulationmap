import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The researcher-facing docs: the Data & API page's live query explorer and
// the self-hosted Swagger UI reference. Explorer API traffic is route-mocked
// (hermetic in CI, failure copy covered); the Swagger page reads only the
// committed spec snapshot, so it needs no mocks at all.

test('data.html explorer runs a query and renders the live response', async ({ page }) => {
  await page.route('**/rest/v1/**', route =>
    route.fulfill({
      json: [{ country: 'Testland', iso3: 'TST', avg_score: 3.75 }],
      headers: {
        'content-range': '0-0/196',
        // Production Supabase exposes Content-Range (verified); the mock
        // must too or the cross-origin page can't read it.
        'access-control-expose-headers': 'Content-Range',
      },
    })
  );

  await page.goto('/data.html');
  await expect(page.locator('#ex-endpoint option')).toHaveCount(8);

  await page.click('#ex-run');
  await expect(page.locator('#ex-output')).toContainText('Testland');
  await expect(page.locator('#ex-status')).toContainText('1 row of 196 total');

  // Recipes load into the explorer and run.
  await page.locator('.recipe .btn').first().click();
  await expect(page.locator('#ex-endpoint')).toHaveValue('score_history');
  await expect(page.locator('#ex-output')).toContainText('Testland');

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => v.id))).toEqual([]);
});

test('data.html explorer degrades calmly when the API is unreachable', async ({ page }) => {
  await page.route('**/rest/v1/**', route => route.abort());
  await page.goto('/data.html');
  await page.click('#ex-run');
  await expect(page.locator('#ex-status')).toHaveText('Unreachable');
  await expect(page.locator('#ex-output')).toContainText('static files above always work');
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
});
