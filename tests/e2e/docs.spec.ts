import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The researcher-facing docs: the static Data & API overview and the
// self-hosted Swagger UI reference. Neither page needs route mocks: the
// overview's only request on load is release.json (absent until the first
// dataset release, and the section degrades to its static text), and the
// Swagger page reads only the committed spec snapshot (public/openapi.json).

test('data.html is a static overview that routes to the API reference', async ({ page }) => {
  await page.goto('/data.html');

  // Dataset downloads and the endpoint overview render statically.
  await expect(page.locator('a[download]')).toHaveCount(8);
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

  // Cite this dataset: before the first release the section keeps its
  // static placeholders and the generated entry stays hidden.
  await expect(page.locator('#citation')).toHaveText('Cite this dataset');
  await expect(page.locator('#cite-concept-doi')).toContainText('Pending');
  await expect(page.locator('#cite-bibtex')).toBeHidden();

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
