import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Evidence coverage (PRD 14): the panel's line under "Data as of" states how
// the latest research pass was grounded. The committed subscores.json has no
// run records yet, so the served file is rewritten in flight: Germany
// grounded, France search only, Japan without a record. The words "verified
// policy initiatives" link to the Policy Initiatives section only while that
// section (Supabase progressive enhancement) is showing.

const REST = '**/rest/v1/**';

const EVIDENCE: Record<string, Record<string, unknown>> = {
  Germany: { grounded: true, initiatives_used: 7, search: true, model: 'claude-opus-5-5', run_id: 'e2e-run' },
  France: { grounded: false, initiatives_used: 0, search: true, model: 'claude-opus-5-5', run_id: 'e2e-run' },
};

async function serveEvidence(page: Page): Promise<void> {
  await page.route('**/data/subscores.json', async route => {
    const response = await route.fetch();
    const body = await response.json() as { countries: Record<string, Record<string, unknown>> };
    for (const [country, evidence] of Object.entries(EVIDENCE)) {
      body.countries[country] = { ...(body.countries[country] ?? { date: '2026-09-21' }), evidence };
    }
    if (body.countries.Japan) delete body.countries.Japan.evidence;
    await route.fulfill({ response, json: body });
  });
}

// The map path's computed opacity; d3 keeps each feature on __data__.
async function opacityOf(page: Page, name: string): Promise<number> {
  return page.evaluate(country => {
    const path = Array.from(document.querySelectorAll<SVGPathElement>('#map path.country')).find(
      p => (p as unknown as { __data__?: { properties?: { name?: string } } }).__data__?.properties?.name === country
    );
    return path ? Number(getComputedStyle(path).opacity) : Number.NaN;
  }, name);
}

async function selectCountry(page: Page, name: string): Promise<void> {
  await page.fill('#country-search', name);
  await page.waitForSelector('#search-suggestions li[role="option"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#country-name')).toHaveText(name);
}

test('the panel states each entry\'s evidence coverage, and nothing without a run record', async ({ page }) => {
  await page.route(REST, route => route.abort());
  await serveEvidence(page);
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  const line = page.locator('#evidence-coverage');

  await selectCountry(page, 'Germany');
  await expect(line).toBeVisible();
  await expect(line).toHaveText('Grounded in 7 verified policy initiatives and web search');
  await expect(line).toHaveAttribute('title', 'Researched with claude-opus-5-5');
  // No initiatives section without Supabase, so no link into it.
  await expect(page.locator('#initiatives-section')).toBeHidden();
  await expect(line.locator('a.evidence-initiatives-link')).toHaveCount(0);

  await selectCountry(page, 'France');
  await expect(line).toHaveText('Web search only; no verified initiatives on record');
  await expect(line.locator('a')).toHaveCount(0);

  await selectCountry(page, 'Japan');
  await expect(line).toBeHidden();
  await expect(line).toHaveText('');
});

test('with the initiatives section showing, the count links to it', async ({ page }) => {
  await page.route('**/rest/v1/public_export*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/sources*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/policy_initiatives*', route =>
    route.fulfill({
      json: [
        {
          name: 'AI Governance Act', start_year: 2025, initiative_type: 'Law',
          binding: 'Binding', status: 'Active',
          source_url: 'https://example.gov/ai-act', first_synced: '2026-07-02T00:00:00Z',
          countries: { name: 'Germany' },
        },
      ],
    })
  );
  await serveEvidence(page);
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await selectCountry(page, 'Germany');

  const section = page.locator('#initiatives-section');
  await expect(section).toBeVisible();
  const link = page.locator('#evidence-coverage a.evidence-initiatives-link');
  await expect(link).toHaveText('verified policy initiatives');
  await expect(page.locator('#evidence-coverage'))
    .toHaveText('Grounded in 7 verified policy initiatives and web search');

  await link.click();
  await expect(section).toBeInViewport();
  await expect(section).toBeFocused();
  // The click scrolls in place; url.ts keeps ownership of the URL.
  expect(new URL(page.url()).hash).toBe('');
});

test('the Evidence facet deep-links, narrows the map and the bloc card states the grounded share', async ({ page }) => {
  await page.route(REST, route => route.abort());
  await serveEvidence(page);
  await page.goto('/?bloc=G7&evidence=grounded');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  await expect(page.locator('#filter-btn')).toHaveClass(/has-filter/);
  // Germany and France have run records; the other five G7 members do not.
  await expect(page.locator('#bloc-summary .bloc-summary-evidence'))
    .toHaveText('Grounded in verified initiatives: 1 of 2 members with a run record (50%)');
  // Germany is the only grounded member; France (search only) and Japan
  // (no run record) recede with the rest.
  await expect.poll(() => opacityOf(page, 'Germany')).toBe(1);
  await expect.poll(() => opacityOf(page, 'France')).toBeCloseTo(0.15, 2);
  await expect.poll(() => opacityOf(page, 'Japan')).toBeCloseTo(0.15, 2);

  await page.click('#filter-btn');
  await expect(page.locator('#filter-evidence input[value="grounded"]')).toBeChecked();
  await page.check('#filter-evidence input[value="search"]');
  await expect.poll(() => new URL(page.url()).searchParams.get('evidence')).toBe('search');
  await expect.poll(() => opacityOf(page, 'France')).toBe(1);
  await expect.poll(() => opacityOf(page, 'Germany')).toBeCloseTo(0.15, 2);

  // Reset clears the facet from the radios and the URL.
  await page.click('.filter-reset');
  await expect(page.locator('#filter-btn')).not.toHaveClass(/has-filter/);
  await expect(page.locator('#filter-evidence input[value="any"]')).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.has('evidence')).toBe(false);
});

// Regression: until the first research run records evidence, "Grounded"
// and "Search only" emptied the map. Options that would keep no country
// are disabled with the reason as a tooltip; a deep link still applies.
test('Evidence options that match no country are disabled, and a deep link still applies', async ({ page }) => {
  await page.route(REST, route => route.abort());
  await page.route('**/data/subscores.json', async route => {
    const response = await route.fetch();
    const body = await response.json() as { countries: Record<string, Record<string, unknown>> };
    for (const entry of Object.values(body.countries)) delete entry.evidence;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/?evidence=grounded');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await page.click('#filter-btn');

  const grounded = page.locator('#filter-evidence input[value="grounded"]');
  const search = page.locator('#filter-evidence input[value="search"]');
  await expect(grounded).toBeDisabled();
  await expect(search).toBeDisabled();
  await expect(page.locator('#filter-evidence input[value="any"]')).toBeEnabled();
  await expect(page.locator('#filter-evidence label', { has: page.locator('input[value="grounded"]') }))
    .toHaveAttribute('title', /No country has a research record grounded/);
  await expect(page.locator('#filter-evidence label', { has: page.locator('input[value="search"]') }))
    .toHaveAttribute('title', /No country has a search-only research record/);

  // The deep-linked facet is still the active filter; "Any" clears it.
  await expect(grounded).toBeChecked();
  await expect(page.locator('#filter-btn')).toHaveClass(/has-filter/);
  await page.check('#filter-evidence input[value="any"]');
  await expect.poll(() => new URL(page.url()).searchParams.has('evidence')).toBe(false);
});

