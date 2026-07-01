import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Smoke coverage for the paths unit tests can't reach: the map actually
// renders, a country selects into the panel, and the built page has no
// serious/critical accessibility violations in either theme. This is the
// net that catches a regression in the choropleth render, the search →
// select flow, or a contrast/ARIA breakage before it ships.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The choropleth is drawn client-side after the CSV + topojson load.
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
});

test('map renders every country as a choropleth path', async ({ page }) => {
  const paths = page.locator('#map svg path.country');
  // world-atlas 110m has ~170+ country geometries; assert the map isn't empty.
  expect(await paths.count()).toBeGreaterThan(150);
  await expect(page.locator('#map svg')).toHaveAttribute('role', 'img');
});

test('search → Enter selects a country into the panel', async ({ page }) => {
  await page.fill('#country-search', 'Germany');
  await page.waitForSelector('#search-suggestions li[role="option"]');
  // Enter with no arrow-highlight must commit the top match (regression guard).
  await page.keyboard.press('Enter');
  await expect(page.locator('#country-name')).toHaveText(/Germany/);
  await expect(page.locator('#panel-content')).toBeVisible();
});

test('Escape before any selection does not stack two empty states', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-intro')).toBeVisible();
  // The "select a country" fallback must stay hidden while the intro shows.
  await expect(page.locator('#no-selection-message')).toBeHidden();
});

for (const theme of ['light', 'dark'] as const) {
  test(`no serious/critical a11y violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const serious = results.violations.filter(
      v => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })), null, 2))
      .toEqual([]);
  });
}
