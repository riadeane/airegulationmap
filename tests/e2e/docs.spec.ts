import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The researcher-facing docs: the Data & API page's live query explorer and
// the self-hosted Swagger UI reference. All API traffic is route-mocked —
// hermetic in CI, and the explorer's failure copy is covered too.

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

test('api-docs.html renders Swagger UI from the live OpenAPI spec', async ({ page }) => {
  await page.route('**/rest/v1/', route =>
    route.fulfill({
      json: {
        swagger: '2.0',
        info: { title: 'AI Regulation Map API', version: '1' },
        host: 'wlakioilvvuuizxdhsdf.supabase.co',
        basePath: '/rest/v1',
        paths: {
          '/countries': {
            get: { summary: 'Canonical country registry', responses: { '200': { description: 'OK' } } },
          },
        },
      },
    })
  );

  await page.goto('/api-docs.html');
  await expect(page.locator('#swagger-ui .info .title')).toContainText('AI Regulation Map API');
  await expect(page.locator('#swagger-ui .opblock-summary-path')).toContainText('/countries');
});
