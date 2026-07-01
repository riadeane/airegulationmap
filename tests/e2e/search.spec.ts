import { test, expect } from '@playwright/test';

// The committed-search flow: dropdown preview → "See all N results" →
// persistent results list → jump-to-matched-field → back — with map
// dimming surviving the whole journey. Plus the header Share popover,
// which makes any view linkable without selecting a country.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
});

test('committing a search opens a persistent, navigable results list', async ({ page }) => {
  // "regulation" appears in essentially every country's prose — a stable query.
  await page.fill('#country-search', 'regulation');
  await page.waitForSelector('#search-suggestions li.search-see-all');
  await page.click('#search-suggestions li.search-see-all');

  // Results list with a count; map dimmed to the match set.
  await expect(page.locator('#search-results')).toBeVisible();
  await expect(page.locator('#search-results .results-count')).toContainText('match');
  expect(await page.locator('#map .country.search-highlighted').count()).toBeGreaterThan(0);

  // Jump to a mention: the panel opens on that country with the matched
  // field marked, the back bar appears, and the dimming persists.
  const firstMention = page.locator('#search-results .result-row:not(.result-row-country)').first();
  await firstMention.click();
  await expect(page.locator('#panel-content')).toBeVisible();
  await expect(page.locator('#panel-content mark.panel-field-mark').first()).toBeVisible();
  await expect(page.locator('#search-back-bar')).toBeVisible();
  expect(await page.locator('#map .country.search-highlighted').count()).toBeGreaterThan(0);

  // Esc peels one layer: country → results list (still dimmed) → clear.
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-results')).toBeVisible();
  expect(await page.locator('#map .country.search-highlighted').count()).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-results')).toBeHidden();
  expect(await page.locator('#map .country.search-highlighted').count()).toBe(0);
});

test('search results deep-link via ?q=', async ({ page }) => {
  await page.goto('/?q=regulation');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await expect(page.locator('#search-results')).toBeVisible();
  await expect(page.locator('#search-results .results-count')).toContainText('“regulation”');
});

test('header Share popover offers a permalink for a view with no selection', async ({ page }) => {
  // Compose a view a researcher would cite: a dimension + a filter range.
  await page.goto('/?mode=enforcementLevel&min=3');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  await page.click('#share-btn');
  await expect(page.locator('#share-popover')).toBeVisible();
  const link = await page.locator('#share-link-input').inputValue();
  expect(link).toContain('mode=enforcementLevel');
  expect(link).toContain('min=3');
  // Citations render for the same view.
  await expect(page.locator('#share-popover .share-cite-row')).toHaveCount(3);
});

test('comparison export buttons enable with a staged set', async ({ page }) => {
  const csvComparisonBtn = page.locator('#export-popover button[data-scope="comparison"][data-format="csv"]');

  await page.click('#export-btn');
  await expect(csvComparisonBtn).toBeDisabled();
  await page.click('#export-btn'); // close

  for (const name of ['Germany', 'France']) {
    await page.fill('#country-search', name);
    await page.waitForSelector('#search-suggestions li[role="option"]');
    await page.keyboard.press('Enter');
    await page.click('#compare-btn');
  }

  await page.click('#export-btn');
  await expect(csvComparisonBtn).toBeEnabled();
  await expect(csvComparisonBtn).toContainText('comparison (2)');
});
