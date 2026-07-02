import { test, expect } from '@playwright/test';

// Discovery bundle: confidence / official-source filter axes and the
// scatter trend overlay.

test('confidence + official filters deep-link and mark the filter button', async ({ page }) => {
  await page.goto('/?conf=high&official=1');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  await expect(page.locator('#filter-btn')).toHaveClass(/has-filter/);
  await page.click('#filter-btn');
  await expect(page.locator('#filter-confidence input[value="high"]')).toBeChecked();
  await expect(page.locator('#filter-confidence input[value="medium"]')).not.toBeChecked();
  await expect(page.locator('#filter-confidence input[value="low"]')).not.toBeChecked();
  await expect(page.locator('#filter-official')).toBeChecked();

  // Reset clears every axis at once.
  await page.click('.filter-reset');
  await expect(page.locator('#filter-btn')).not.toHaveClass(/has-filter/);
  await expect(page.locator('#filter-confidence input[value="medium"]')).toBeChecked();
});

test('scatter trend checkbox draws the fit line and Pearson annotation', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  await page.click('#scatter-btn');
  await expect(page.locator('#scatter-chart svg')).toBeVisible();
  await expect(page.locator('line.scatter-trend')).toHaveCount(0);

  await page.check('#scatter-trend');
  await expect(page.locator('line.scatter-trend')).toHaveCount(1);
  await expect(page.locator('text.scatter-trend-stats')).toContainText(/r = -?\d\.\d{2} · n = \d+/);

  await page.uncheck('#scatter-trend');
  await expect(page.locator('line.scatter-trend')).toHaveCount(0);
});

test('panel keeps a methodology link after the intro card is consumed', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  await page.fill('#country-search', 'Germany');
  await page.waitForSelector('#search-suggestions li[role="option"]');
  await page.keyboard.press('Enter');

  // The intro card is gone (consumed), but the header link remains.
  await expect(page.locator('#panel-intro')).toHaveCount(0);
  await expect(page.locator('.panel-country-header .panel-methodology-link')).toBeVisible();
});
