import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The Supabase layer is progressive enhancement: these specs prove both
// halves — (1) with every REST request failing, the app is byte-for-byte
// the static experience; (2) with mocked responses, the initiatives
// section and source-title upgrades render. Requires the build to carry
// VITE_SUPABASE_* (CI uses dummy values; requests never leave the browser
// because page.route intercepts them).

const REST = '**/rest/v1/**';

/** First source URL in Germany's regulation_data.csv row (fetched from the
 * served static file) — used to mock a title for a URL the panel will
 * actually render. */
async function germanySourceUrl(request: APIRequestContext): Promise<string | null> {
  const csv = await (await request.get('/regulation_data.csv')).text();
  const line = csv.split(/\r?\n/).find(row => row.startsWith('Germany,'));
  const match = line?.match(/https?:\/\/[^|,"\s]+/);
  return match ? match[0] : null;
}

async function selectGermany(page: import('@playwright/test').Page) {
  await page.fill('#country-search', 'Germany');
  await page.waitForSelector('#search-suggestions li[role="option"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#country-name')).toHaveText('Germany');
}

test('with Supabase unreachable the app is fully functional and static', async ({ page }) => {
  await page.route(REST, route => route.abort());
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  await selectGermany(page);
  await expect(page.locator('#panel-content')).toBeVisible();
  // No initiatives section, hostnames (not titles) in sources.
  await expect(page.locator('#initiatives-section')).toBeHidden();
  const firstSource = page.locator('#sources-list a').first();
  await expect(firstSource).not.toHaveText(/Test Title/);
});

test('mocked Supabase responses light up initiatives and source titles', async ({ page, request }) => {
  const sourceUrl = await germanySourceUrl(request);

  await page.route('**/rest/v1/public_export*', route =>
    route.fulfill({ json: [] })
  );
  await page.route('**/rest/v1/sources*', route =>
    route.fulfill({
      json: sourceUrl
        ? [{ url: sourceUrl, title: 'Test Title — Official Gazette', source_type: 'official' }]
        : [],
    })
  );
  await page.route('**/rest/v1/policy_initiatives*', route =>
    route.fulfill({
      json: [
        {
          name: 'AI Governance Act', start_year: 2025, initiative_type: 'Law',
          binding: 'Binding', status: 'Active',
          source_url: 'https://example.gov/ai-act', first_synced: '2026-07-02T00:00:00Z',
          countries: { name: 'Germany' },
        },
        {
          name: 'National AI Strategy', start_year: 2020, initiative_type: 'Strategy',
          binding: 'Non-binding', status: 'Active',
          source_url: null, first_synced: '2026-07-02T00:00:00Z',
          countries: { name: 'Germany' },
        },
      ],
    })
  );

  // Reduced motion: the panel's staggered entrance animations would
  // otherwise leave text semi-transparent when axe measures contrast.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await selectGermany(page);

  // Initiatives section renders with rows + the OECD attribution.
  await expect(page.locator('#initiatives-section')).toBeVisible();
  await expect(page.locator('#initiatives-list li')).toHaveCount(2);
  await expect(page.locator('#initiatives-list a.initiative-name').first())
    .toHaveAttribute('href', 'https://example.gov/ai-act');
  await expect(page.locator('#initiatives-attribution')).toContainText('OECD.AI Policy Observatory');

  // Source list upgraded from hostname to the supplied title.
  if (sourceUrl) {
    await expect(page.locator('#sources-list')).toContainText('Test Title — Official Gazette');
  }

  // The enriched panel stays accessible.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('#country-panel')
    .analyze();
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => v.id))).toEqual([]);
});
