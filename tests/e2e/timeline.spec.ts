import { test, expect } from '@playwright/test';

// The panel must show the same score vintage the map is painting while the
// timeline is scrubbed — and say so. Uses the real history.json served by
// the preview build, so we only assert vintage-agnostic facts (notice
// visibility, rank hiding, expander locking), not specific score values.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
});

test('scrubbing the timeline re-vintages the open panel and shows the notice', async ({ page }) => {
  // Timeline only mounts when history.json has >1 snapshot date.
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });

  await page.fill('#country-search', 'Germany');
  await page.waitForSelector('#search-suggestions li[role="option"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#country-name')).toHaveText('Germany');
  await expect(page.locator('#panel-history-notice')).toBeHidden();
  await expect(page.locator('#maturity-rank')).not.toHaveText('');

  // Scrub to the earliest snapshot date.
  const slider = page.locator('#timeline-slider');
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await expect(page.locator('#panel-history-notice')).toBeVisible();
  await expect(page.locator('#panel-history-date')).not.toHaveText('');
  // Rank is a latest-data derivation — it hides for historical vintages.
  await expect(page.locator('#maturity-rank')).toHaveText('');
  // Sub-indicator disclosures lock (they cover the latest research only).
  const firstExpander = page.locator('.dim-expand').first();
  await expect(firstExpander).toBeDisabled();

  // Reset to Latest restores the live rendering.
  await page.click('#timeline-reset');
  await expect(page.locator('#panel-history-notice')).toBeHidden();
  await expect(page.locator('#maturity-rank')).not.toHaveText('');
  await expect(firstExpander).toBeEnabled();
});

test('the filter range deep-links and syncs the sliders', async ({ page }) => {
  await page.goto('/?min=3&max=4');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  await expect(page.locator('#filter-min-label')).toHaveText('3');
  await expect(page.locator('#filter-max-label')).toHaveText('4');
  await expect(page.locator('#filter-min')).toHaveValue('3');
  await expect(page.locator('#filter-max')).toHaveValue('4');
  // The filter button carries its active signal.
  await expect(page.locator('#filter-btn')).toHaveClass(/has-filter/);
});
