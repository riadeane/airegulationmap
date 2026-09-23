import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// The archived dataset version (public/data/release.json, PRD 10) is
// progressive: absent until the first release, so the app must read the
// same with and without it. The file is mocked here; nothing on the
// preview server carries it.

const RELEASE_JSON = '**/data/release.json';
const PRODUCTION = {
  tag: 'data-2026-W38',
  date: '2026-09-14',
  doi: '10.5281/zenodo.1234567',
  concept_doi: '10.5281/zenodo.1234566',
  sandbox: false,
};

async function mockRelease(page: Page, release: object | null) {
  await page.route(RELEASE_JSON, route => release
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(release) })
    : route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
}

async function openCitePopover(page: Page) {
  await page.goto('/?country=Chile');
  await expect(page.locator('#country-name')).toHaveText('Chile');
  await page.click('#cite-btn');
  await expect(page.locator('#cite-popover')).toBeVisible();
}

test('the Cite popover names the archived version and links its DOI', async ({ page }) => {
  await mockRelease(page, PRODUCTION);
  await openCitePopover(page);
  const version = page.locator('#cite-popover .cite-version');
  await expect(version).toContainText('Dataset version data-2026-W38 (2026-09-14)');
  await expect(version.locator('a')).toHaveAttribute('href', 'https://doi.org/10.5281/zenodo.1234567');
  const apa = page.locator('#cite-popover .cite-block').first();
  await expect(apa).toContainText('AI Regulation Map: Chile (Version data-2026-W38) [Data visualization]. https://doi.org/10.5281/zenodo.1234567. Retrieved');
});

test('a sandbox release names the version but never quotes its DOI', async ({ page }) => {
  await mockRelease(page, { ...PRODUCTION, doi: '10.5072/zenodo.42', concept_doi: '10.5072/zenodo.41', sandbox: true });
  await openCitePopover(page);
  await expect(page.locator('#cite-popover .cite-version')).toContainText('DOI pending');
  const apa = page.locator('#cite-popover .cite-block').first();
  await expect(apa).toContainText('(Version data-2026-W38)');
  await expect(apa).not.toContainText('doi.org');
});

test('without release.json the citation keeps the plain format', async ({ page }) => {
  await mockRelease(page, null);
  await openCitePopover(page);
  await expect(page.locator('#cite-popover .cite-version')).toHaveCount(0);
  const apa = page.locator('#cite-popover .cite-block').first();
  await expect(apa).toContainText('AI Regulation Map: Chile [Data visualization]. Retrieved');
  await expect(apa).not.toContainText('Version');
});

test('data.html fills the Cite this dataset section from release.json', async ({ page }) => {
  await mockRelease(page, PRODUCTION);
  await page.goto('/data.html');
  await expect(page.locator('#cite-concept-doi a')).toHaveAttribute('href', 'https://doi.org/10.5281/zenodo.1234566');
  const version = page.locator('#cite-version');
  await expect(version.locator('a').first()).toHaveAttribute('href', 'https://github.com/riadeane/airegulationmap/releases/tag/data-2026-W38');
  await expect(version).toContainText('(2026-09-14)');
  await expect(version.locator('a').nth(1)).toHaveAttribute('href', 'https://doi.org/10.5281/zenodo.1234567');
  await expect(page.locator('#cite-text')).toHaveText(
    'Deane, R. (2026). AI Regulation Map: dataset (Version data-2026-W38) [Data set]. Zenodo. https://doi.org/10.5281/zenodo.1234567'
  );
  const bibtex = page.locator('#cite-bibtex');
  await expect(bibtex).toBeVisible();
  await expect(bibtex).toContainText('@dataset{deane_airegulationmap_2026_W38,');
  await expect(bibtex).toContainText('version   = {data-2026-W38},');
  await expect(bibtex).toContainText('doi       = {10.5281/zenodo.1234567},');
});
