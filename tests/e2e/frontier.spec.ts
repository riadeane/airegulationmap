import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { csvFormat, csvParse } from 'd3-dsv';

// Frontier Risk Governance (PRD 15 req 17, PRD 16 phase 2). The committed
// data has no frontier scores yet (they ship with the first run on the
// lens), so the served files are rewritten in flight: scores.csv gains the
// "Frontier Risk" and "Frontier Track" columns, regulation_data.csv the
// frontier text and sources, and subscores.json a `frontier` block for four
// countries, one per state:
// - United States of America: frontier host, scored 3;
// - Germany: frontier host, insufficient evidence (an empty score with a
//   track), developer obligations at EU level;
// - Kenya: global track, scored 3.5, two sub-indicators "na";
// - Japan: compute or chokepoint, scored 3.
// Every other country has no frontier data.

const REST = '**/rest/v1/**';

type CountryPath = { __data__?: { properties?: { name?: string } } };

const SCORES: Record<string, [string, string]> = {
  'United States of America': ['3', 'H'],
  Germany: ['', 'H'],
  Kenya: ['3.5', 'G'],
  Japan: ['3', 'C'],
};

const cell = (score: number | null | 'na', rationale: string, extra: Record<string, boolean> = {}) =>
  ({ score, rationale, ...extra });

const FRONTIER: Record<string, Record<string, unknown>> = {
  'United States of America': {
    date: '2026-10-05', track: 'H', rubric: 'f1',
    developer_obligations: cell(3, 'Federal duties touch frontier risk through an executive order only.'),
    evaluation_oversight: cell(4, 'CAISI tests unreleased models under voluntary agreements.'),
    incident_emergency_preparedness: cell(2, 'Federal incident reporting is recommended only.'),
    international_coordination: cell(4, 'Network member; signed Bletchley and Seoul.', { computed: true }),
  },
  Germany: {
    date: '2026-10-05', track: 'H', rubric: 'f1',
    developer_obligations: cell(4, 'EU AI Act obligations for general-purpose AI models apply.', { eu_level: true }),
    evaluation_oversight: cell(3, 'The AI Office has an evaluation mandate.'),
    incident_emergency_preparedness: cell(null, 'No source on an AI emergency plan was found.'),
    international_coordination: cell(4, 'Signed Bletchley and Seoul through the EU.', { computed: true }),
  },
  Kenya: {
    date: '2026-10-05', track: 'G', rubric: 'f1',
    developer_obligations: cell('na', 'Does not apply on the global track.'),
    evaluation_oversight: cell('na', 'Does not apply on the global track.'),
    incident_emergency_preparedness: cell(3, 'A national emergency plan names AI risk.'),
    international_coordination: cell(4, 'Network member; signed the Seoul text.', { computed: true }),
  },
  Japan: {
    date: '2026-10-05', track: 'C', rubric: 'f1',
    developer_obligations: cell('na', 'Does not apply on the compute track.'),
    evaluation_oversight: cell(3, 'The AI Safety Institute tests some models.'),
    incident_emergency_preparedness: cell(2, 'Guidance only.'),
    international_coordination: cell(4, 'Network member; signed Bletchley and Seoul.', { computed: true }),
  },
};

const US_TEXT = 'Frontier developers face voluntary commitments; CAISI evaluates models before release.';

async function serveFrontier(page: Page): Promise<void> {
  await page.route('**/scores.csv', async route => {
    const response = await route.fetch();
    const rows = csvParse(await response.text());
    const columns = [...rows.columns, 'Frontier Risk', 'Frontier Track'];
    const out: Record<string, string>[] = rows.map(row => {
      const [score, track] = SCORES[row.Country ?? ''] ?? ['', ''];
      return { ...row, 'Frontier Risk': score, 'Frontier Track': track };
    });
    await route.fulfill({ response, body: csvFormat(out, columns) });
  });
  await page.route('**/regulation_data.csv', async route => {
    const response = await route.fetch();
    const rows = csvParse(await response.text());
    const columns = [...rows.columns, 'Frontier Risk', 'Frontier Sources'];
    const out: Record<string, string>[] = rows.map(row => row.Country === 'United States of America'
      ? { ...row, 'Frontier Risk': US_TEXT, 'Frontier Sources': 'https://www.nist.gov/caisi|https://example.org/frontier' }
      : { ...row, 'Frontier Risk': '', 'Frontier Sources': '' });
    await route.fulfill({ response, body: csvFormat(out, columns) });
  });
  await page.route('**/data/subscores.json', async route => {
    const response = await route.fetch();
    const json = await response.json() as { countries: Record<string, Record<string, unknown>> };
    for (const [name, frontier] of Object.entries(FRONTIER)) {
      json.countries[name] = { ...(json.countries[name] ?? { date: '2026-10-05' }), frontier };
    }
    await route.fulfill({ response, json });
  });
}

async function ready(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('#map svg path.country', { state: 'attached', timeout: 15_000 });
}

async function fillOf(page: Page, name: string): Promise<string | null> {
  return page.evaluate(country => {
    const path = Array.from(document.querySelectorAll('#map path.country')).find(
      el => (el as unknown as CountryPath).__data__?.properties?.name === country
    );
    return path ? getComputedStyle(path).fill : null;
  }, name);
}

// A token resolved to the rgb() form getComputedStyle reports for fills.
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate(name => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, token);
}

async function hover(page: Page, name: string): Promise<void> {
  await page.evaluate(country => {
    const path = Array.from(document.querySelectorAll('#map path.country')).find(
      el => (el as unknown as CountryPath).__data__?.properties?.name === country
    )!;
    const box = path.getBoundingClientRect();
    path.dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
    }));
  }, name);
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.id} (${v.nodes.length})`);
}

test.describe('with frontier data', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(REST, route => route.abort());
    await serveFrontier(page);
  });

  test('the selector offers the lens as its own group, and the legend explains it', async ({ page }) => {
    await ready(page);
    await page.click('#score-btn');
    const groups = page.locator('#score-dropdown [role="group"]');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(2)).toHaveAccessibleName('Frontier risk governance');
    const option = page.locator('#score-option-frontierRisk');
    await expect(option).toHaveAccessibleName('Frontier Risk Governance');
    await expect(option).toHaveAccessibleDescription(
      'How close is governance of catastrophic frontier-AI risk to the standard stated in the methodology?'
    );
    await option.click();
    await expect(page.locator('#score-btn-label')).toHaveText('Frontier Risk Governance');
    await expect(page).toHaveURL(/mode=frontierRisk/);

    const legend = page.locator('#map-legend');
    await expect(legend.locator('.legend-label-low')).toHaveText('1 Nothing observable');
    await expect(legend.locator('.legend-label-high')).toHaveText('Meets the stated standard 5');
    await expect(legend).toContainText('not a measure of how safe a country is');
    await expect(legend.locator('.legend-frontier-note')).toHaveText('Scored by track; capped at the weakest element.');
    await expect(legend.locator('.legend-explain')).toBeVisible();
    // Germany is insufficient evidence on this lens, so the key shows.
    await expect(legend.locator('.legend-insufficient')).toBeVisible();
    await expect(page.locator('#map-live-region')).toContainText('Map now showing Frontier Risk Governance.');

    // Back on the implementation index the frontier note goes away.
    await page.click('#score-btn');
    await page.click('#score-option-averageScore');
    await expect(legend.locator('.legend-frontier-note')).toBeHidden();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the map paints scores in the frontier ramp, insufficient evidence apart from the colour for 1 (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, `/?mode=frontierRisk&theme=${theme}`);
      const insufficient = await tokenColor(page, '--score-insufficient');
      const noData = await tokenColor(page, '--no-data');
      const colourForOne = await tokenColor(page, '--ramp-frontier-low');
      const colourForFive = await tokenColor(page, '--ramp-frontier-high');

      await expect.poll(() => fillOf(page, 'Germany')).toBe(insufficient);
      expect(insufficient).not.toBe(colourForOne);
      expect(insufficient).not.toBe(noData);
      // A scored country takes a ramp colour; one never scored on the lens is "no data".
      await expect.poll(() => fillOf(page, 'France')).toBe(noData);
      const kenya = await fillOf(page, 'Kenya');
      expect([insufficient, noData, colourForOne, colourForFive]).not.toContain(kenya);
      // The ramp is its own: not the implementation blue.
      expect(colourForFive).not.toBe(await tokenColor(page, '--ramp-impl-high'));

      // The map as a table says the same.
      const table = page.locator('#country-table');
      await expect(table.locator('tr', { hasText: 'Germany' })).toContainText('Insufficient evidence');
      await expect(table.locator('tr', { hasText: 'Kenya' })).toContainText('3.5');
      await expect(table.locator('tr', { hasText: 'France' })).toHaveCount(0);
    });
  }

  test('the tooltip names the score, the lens and the track in words', async ({ page }) => {
    await ready(page, '/?mode=frontierRisk');
    await hover(page, 'United States of America');
    const tooltip = page.locator('div.tooltip');
    await expect(tooltip).toContainText('Frontier Risk Governance: 3 / 5, against a stated standard');
    await expect(tooltip).toContainText('Frontier host track');

    await hover(page, 'Germany');
    await expect(tooltip).toContainText('Frontier Risk Governance: insufficient evidence');
    await expect(tooltip).toContainText('Frontier host track, EU-level developer obligations');

    await hover(page, 'Kenya');
    await expect(tooltip).toContainText('Global track');

    await hover(page, 'France');
    await expect(tooltip).toContainText('No data');
    await expect(tooltip).not.toContainText('track');
  });

  test('the panel shows the score, the track and the four sub-indicators', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page, '/?country=Kenya&mode=frontierRisk');
    const block = page.locator('#frontier-section');
    await expect(block).toBeVisible();
    await expect(block.locator('.panel-group-caption')).toHaveText('distance to a stated standard, not how safe a country is');
    await expect(block.locator('#dots-frontier .dim-score-value')).toHaveText('3.50');
    await expect(block.locator('.dimension-row')).toHaveClass(/active-dimension/);
    await expect(block.locator('#frontier-track')).toContainText('Global track.');
    await expect(block.locator('#frontier-track')).toContainText('capped at one point above the weakest');

    const rows = block.locator('#frontier-subscores .subscore-line');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).locator('.subscore-label')).toHaveText('Developer obligations');
    await expect(rows.nth(0).locator('.subscore-value')).toHaveText('Not applicable');
    await expect(rows.nth(1).locator('.subscore-value')).toHaveText('Not applicable');
    // "Not applicable" is words, never a bar that would read as a 1.
    await expect(rows.nth(0).locator('.subscore-track')).toHaveCount(0);
    await expect(rows.nth(2).locator('.subscore-value')).toHaveText('3');
    await expect(rows.nth(2)).toContainText('3: One of incident reporting');
    await expect(rows.nth(3)).toContainText('Computed from public lists');

    // Germany: insufficient evidence on the score and one sub-indicator, the EU-level flag.
    await page.locator('#country-search').fill('Germany');
    await page.waitForSelector('#search-suggestions li[role="option"]');
    await page.keyboard.press('Enter');
    await expect(page.locator('#country-name')).toHaveText('Germany');
    await expect(block.locator('#dots-frontier')).toHaveText('Insufficient evidence');
    await expect(block.locator('#dots-frontier .dim-dot')).toHaveCount(0);
    await expect(rows.nth(0).locator('.subscore-flag')).toHaveText('EU-level');
    await expect(rows.nth(0)).toContainText('Rests on the EU AI Act, not a national law.');
    await expect(rows.nth(2).locator('.subscore-value')).toHaveText('Insufficient evidence');

    // The United States: the frontier text and its sources.
    await page.locator('#country-search').fill('United States of America');
    await page.waitForSelector('#search-suggestions li[role="option"]');
    await page.keyboard.press('Enter');
    await expect(block.locator('#frontier-details')).toHaveText(US_TEXT);
    await expect(block.locator('#frontier-sources-list li')).toHaveCount(2);

    // France has no frontier data: no block.
    await page.locator('#country-search').fill('France');
    await page.waitForSelector('#search-suggestions li[role="option"]');
    await page.keyboard.press('Enter');
    await expect(page.locator('#country-name')).toHaveText('France');
    await expect(block).toBeHidden();
  });

  test('the comparison lists the lens under its own heading; the radar stays implementation-only', async ({ page }) => {
    await ready(page, '/?compare=Kenya,Germany');
    const table = page.locator('#comparison-table');
    await expect(table.locator('tr.ct-group[data-group="frontier"]')).toContainText('Frontier risk governance');
    const row = table.locator('tr.ct-row', { hasText: 'Frontier Risk Governance' });
    await expect(row).toContainText('3.50');
    await expect(row).toContainText('Global track');
    await expect(row).toContainText('Insufficient evidence');
    await expect(page.locator('#radar-chart')).not.toContainText('Frontier');
  });

  test('the explainer describes the lens and links to its methodology', async ({ page }) => {
    await ready(page);
    await page.click('#header-help-btn');
    const dialog = page.locator('#help-overlay');
    await expect(dialog).toContainText('one of three lenses');
    await expect(dialog).toContainText('Frontier risk governance');
    await expect(dialog).toContainText('not a measure of how safe a country is');
    await expect(dialog).toContainText('compute or chokepoint');
    await expect(dialog.getByRole('link', { name: 'How the frontier lens is scored' }))
      .toHaveAttribute('href', '/methodology.html#frontier-risk-governance');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious or critical a11y violations on the frontier lens (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await ready(page, `/?country=Germany&mode=frontierRisk&theme=${theme}`);
      await expect(page.locator('#frontier-section')).toBeVisible();
      await expect(page.locator('#frontier-subscores .subscore-line')).toHaveCount(4);
      expect(await seriousViolations(page)).toEqual([]);

      await page.click('#score-btn');
      await expect(page.locator('#score-option-frontierRisk')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});

test.describe('without frontier data', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(REST, route => route.abort());
  });

  test('the lens is not offered, a deep link falls back and the panel has no frontier block', async ({ page }) => {
    await ready(page, '/?mode=frontierRisk&country=Germany');
    await expect(page.locator('#score-btn-label')).toHaveText('Implementation Index');
    await expect(page.locator('#map-legend .legend-label-low')).toHaveText('1 Little in force');
    await expect(page.locator('#frontier-section')).toBeHidden();
    await page.click('#score-btn');
    await expect(page.locator('#score-dropdown [role="group"]')).toHaveCount(2);
    await expect(page.locator('#score-option-frontierRisk')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.click('#header-help-btn');
    await expect(page.locator('#help-overlay')).toContainText('one of two lenses');
    await expect(page.locator('#help-overlay [data-frontier-lens]').first()).toBeHidden();
  });
});
