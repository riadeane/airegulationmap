import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Exercises the mainView FSM end to end: exactly one overlay owns the main
// area, switching to one leaves the other, and Escape backs out to the map.
// These are the paths the interactions-orchestrator refactor touched.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
});

async function addToComparison(page: Page, name: string) {
  await page.fill('#country-search', name);
  await page.waitForSelector('#search-suggestions li[role="option"]');
  await page.keyboard.press('Enter');
  await page.click('#compare-btn');
}

test('scatter opens and Escape returns to the map', async ({ page }) => {
  await page.click('#scatter-btn');
  await expect(page.locator('body')).toHaveClass(/view-scatter/);
  await expect(page.locator('#scatter-container')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/view-scatter/);
});

test('opening comparison leaves scatter - never both at once', async ({ page }) => {
  await page.click('#scatter-btn');
  await expect(page.locator('body')).toHaveClass(/view-scatter/);

  await addToComparison(page, 'Germany');
  await addToComparison(page, 'France');
  await page.click('#tray-view-btn');

  // The FSM guarantees mutual exclusion: comparison is on, scatter is off.
  await expect(page.locator('body')).toHaveClass(/view-compare/);
  await expect(page.locator('body')).not.toHaveClass(/view-scatter/);
  await expect(page.locator('#comparison-panel')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/view-compare/);
});

test('comparison colours are stable when a middle country is removed', async ({ page }) => {
  await addToComparison(page, 'Germany');
  await addToComparison(page, 'France');
  await addToComparison(page, 'Japan');
  await page.click('#tray-view-btn');

  const colOf = async (name: string) =>
    page.locator(`#comparison-table [data-country="${name}"], #comparison-table th`, { hasText: name })
      .first().evaluate(el => getComputedStyle(el as HTMLElement).color);

  const japanBefore = await colOf('Japan');
  // Remove the middle country (France) via its chip.
  await page.locator('#comparison-chips').getByRole('button', { name: /France/ }).click();
  const japanAfter = await colOf('Japan');
  // Japan keeps its colour slot - removal must not reshuffle the others.
  expect(japanAfter).toBe(japanBefore);
});

// Regression: a country selected while the comparison view owned the
// screen was rendered but left hidden, so the panel came back blank.
test('a country picked in the comparison view shows once back on the map', async ({ page }) => {
  await page.goto('/?compare=France,Japan');
  await expect(page.locator('#comparison-panel')).toBeVisible({ timeout: 15_000 });
  await page.fill('#country-search', 'germ');
  await page.waitForSelector('#search-suggestions li[role="option"]');
  await page.keyboard.press('Enter');
  await page.click('#comparison-back-btn');
  await expect(page.locator('#panel-content')).toBeVisible();
  await expect(page.locator('#country-name')).toHaveText('Germany');
});

test('arrow-stepping in the comparison view, then Esc, shows the stepped country', async ({ page }) => {
  await page.goto('/?compare=France,Japan');
  await expect(page.locator('#comparison-panel')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/view-compare/);
  await expect(page.locator('#panel-content')).toBeVisible();
  await expect(page.locator('#country-name')).not.toHaveText('');
});

// Regression (phones): closing an overlay dropped the bottom sheet, and
// re-selecting the still-selected country is a store no-op, so there was
// no way back to the sheet short of picking another country.
test.describe('bottom sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('returns with the selection when an overlay closes', async ({ page }) => {
    await page.goto('/?country=Germany&scatter=1');
    await expect(page.locator('body')).toHaveClass(/view-scatter/, { timeout: 15_000 });
    await expect(page.locator('body')).not.toHaveClass(/sheet-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/view-scatter/);
    await expect(page.locator('body')).toHaveClass(/sheet-open/);
    await expect(page.locator('#country-name')).toHaveText('Germany');
  });
});
