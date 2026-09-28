import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// PRD 16, phase 1: what a score means, where it is read. The explainer and
// its openers, the grouped score selector, the legend's line, no rank
// anywhere, the keyboard route into the map (#139) and the header layout
// (#73).

async function ready(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('#map svg path.country', { state: 'attached', timeout: 15_000 });
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.id} (${v.nodes.length})`);
}

test.describe('"How to read this map"', () => {
  test('opens from the legend, traps focus, closes on Esc and returns focus', async ({ page }) => {
    await ready(page);
    const opener = page.locator('#map-legend .legend-explain');
    await expect(opener).toHaveText('What does this mean?');
    await opener.click();

    const dialog = page.locator('#help-overlay');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'How to read this map' })).toBeVisible();
    await expect(dialog).toContainText('A higher score is not a better score.');
    await expect(dialog).toContainText('Neither end is better.');
    await expect(dialog).toContainText('hatched on the map');
    await expect(dialog.getByRole('link', { name: 'Read the methodology' })).toHaveAttribute('href', '/methodology.html');
    // The guide comes first; the keyboard shortcuts are the second section.
    const titles = await dialog.locator('h2').allTextContents();
    expect(titles).toEqual(['How to read this map', 'Keyboard shortcuts']);
    // Focus starts on the title, so reading starts at the top.
    await expect(page.locator('#help-overlay-title')).toBeFocused();

    // Modal: the page behind is inert, so focus moves among the dialog's
    // own controls.
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('link', { name: 'Read the methodology' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#help-overlay-close')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('opens from the help button, the panel header, the empty state and the intro', async ({ page }) => {
    await ready(page);
    const dialog = page.locator('#help-overlay');

    await page.click('#header-help-btn');
    await expect(dialog).toBeVisible();
    await page.click('#help-overlay-close');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#header-help-btn')).toBeFocused();

    await page.locator('#panel-intro .panel-intro-explain').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');

    await ready(page, '/?country=Germany');
    await page.locator('#panel-content .panel-explain-btn').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');

    // The empty state appears once the intro is gone and nothing is selected.
    await page.keyboard.press('Escape');
    await expect(page.locator('#no-selection-message')).toBeVisible();
    await page.locator('#no-selection-message .panel-explain-btn').click();
    await expect(dialog).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious or critical a11y violations when open (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, `/?theme=${theme}`);
      await page.click('#header-help-btn');
      await expect(page.locator('#help-overlay')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

    test('fits the screen and opens from the first-run hint', async ({ page }) => {
      await ready(page);
      const hint = page.locator('#mobile-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('Higher means more in force, not better.');
      await hint.getByRole('button', { name: 'How to read this map' }).click();
      const dialog = page.locator('#help-overlay');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(360);
      // No keyboard shortcuts on a touchscreen.
      await expect(dialog.locator('.help-shortcuts')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    });
  });
});

test('the score selector groups its options and says what each answers', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#score-btn-label')).toHaveText('Implementation Index');
  await page.click('#score-btn');
  const listbox = page.locator('#score-dropdown');
  const groups = listbox.locator('[role="group"]');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAccessibleName('Implementation');
  await expect(groups.nth(1)).toHaveAccessibleName('Governance style');
  await expect(groups.nth(0).locator('[role="option"]')).toHaveCount(4);
  await expect(groups.nth(1).locator('[role="option"]')).toHaveCount(2);
  const option = page.locator('#score-option-averageScore');
  await expect(option).toHaveAccessibleName('Implementation Index');
  await expect(option).toHaveAccessibleDescription('How much AI governance is in force and operating?');
  await expect(page.locator('#score-option-governanceType')).toContainText('Is authority over AI held by one body or spread across many?');
});

test('the legend says what the lens asks and what it does not claim', async ({ page }) => {
  await ready(page);
  const legend = page.locator('#map-legend');
  await expect(legend.locator('.legend-label-low')).toHaveText('1 Little in force');
  await expect(legend.locator('.legend-label-high')).toHaveText('Extensively in force 5');
  await expect(legend).toContainText('How much AI governance is in force and operating?');
  await expect(legend).toContainText('Higher means more in force, not better regulation.');

  await page.goto('/?mode=governanceType');
  await expect(legend.locator('.legend-label-low')).toHaveText('1 Centralised');
  await expect(legend).toContainText('Neither end is better');
  // The live region speaks the same line when the lens changes.
  await page.click('#score-btn');
  await page.click('#score-option-actorInvolvement');
  await expect(page.locator('#map-live-region')).toContainText('Map now showing Actor Involvement.');
  await expect(page.locator('#map-live-region')).toContainText('Neither end is better');
});

test('no surface shows a rank', async ({ page }) => {
  await ready(page, '/?country=Germany');
  await expect(page.locator('#panel-content')).toBeVisible();
  await expect(page.locator('#panel-content')).not.toContainText(/\brank\b/i);
  await expect(page.locator('#panel-content')).toContainText('how much is in force, not how good it is');
  await expect(page.locator('#panel-content')).toContainText('how, not how well');
  await expect(page.locator('#maturity-rank')).toHaveCount(0);

  const res = await page.request.get('/country/germany/');
  const html = await res.text();
  expect(html).not.toMatch(/\brank\b/i);
  expect(html).toContain('Implementation index <strong>');
});

test('an expanded dimension says what each sub-indicator level means', async ({ page }) => {
  await ready(page, '/?country=Germany');
  await page.click('.dimension-row[data-dimension="regulationStatus"] .dim-expand');
  const meanings = page.locator('.subscore-meaning[data-group="implementation"]');
  await expect(meanings.first()).toBeVisible();
  await expect(meanings.first()).toHaveText(/^[1-5]: (No observable activity|Non-binding or preparatory only|Exists in part|In place, one element incomplete or not yet exercised|In place and operating)$/);
});

test('where nothing is in force, governance type says so instead of a 1 (#96)', async ({ page }) => {
  await ready(page);
  const country = await page.evaluate(async () => {
    const text = await (await fetch('/scores.csv')).text();
    const [head, ...rows] = text.trim().split('\n');
    const cols = head.split(',');
    const at = (name: string) => cols.indexOf(name);
    for (const row of rows) {
      const cells = row.split(',');
      if (cells.length !== cols.length) continue;
      if (['Regulation Status', 'Policy Lever', 'Enforcement Level'].every(c => Number(cells[at(c)]) === 1)) {
        return cells[0];
      }
    }
    return null;
  });
  test.skip(!country, 'no country with every implementation dimension at 1 in this dataset');
  await ready(page, `/?country=${encodeURIComponent(country!)}`);
  await expect(page.locator('#dots-governance')).toHaveText('No AI governance activity observed');
});

test('keyboard users reach every country through the table under the map (#139)', async ({ page }) => {
  await ready(page);
  const table = page.locator('#country-table');
  // In the accessibility tree, visually hidden until focused.
  await expect(table.getByRole('heading', { name: 'Countries on the map' })).toBeAttached();
  const box = await table.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);

  // Tab from the zoom controls lands in the table, which then shows.
  await page.focus('#zoom-controls button:last-child');
  let guard = 0;
  while (!(await page.evaluate(() => document.getElementById('country-table')!.contains(document.activeElement))) && guard++ < 10) {
    await page.keyboard.press('Tab');
  }
  await expect(table).toBeVisible();
  expect((await table.boundingBox())!.width).toBeGreaterThan(200);

  // Tab reaches the roving row; arrows move between countries; Enter selects.
  const rows = table.locator('.country-table-pick');
  expect(await rows.count()).toBeGreaterThan(150);
  while (!(await page.evaluate(() => document.activeElement?.classList.contains('country-table-pick'))) && guard++ < 15) {
    await page.keyboard.press('Tab');
  }
  const first = await page.evaluate(() => document.activeElement!.textContent);
  await page.keyboard.press('ArrowDown');
  const second = await page.evaluate(() => document.activeElement!.textContent);
  expect(second).not.toBe(first);
  await page.keyboard.press('Enter');
  await expect(page.locator('#country-name')).toHaveText(second!);
  await expect(page.locator('#map-live-region')).toContainText(`Selected ${second}.`);
  // Only one row is in the Tab order.
  await expect(table.locator('.country-table-pick[tabindex="0"]')).toHaveCount(1);

  // Sorting by score keeps focus on the sort control.
  const sortScore = table.locator('[data-sort="score"]');
  await sortScore.focus();
  await page.keyboard.press('Enter');
  await expect(table.locator('[data-sort="score"]')).toBeFocused();
  await expect(table.locator('th:has([data-sort="score"])')).toHaveAttribute('aria-sort', 'descending');
});

test.describe('header layout (#73)', () => {
  for (const width of [800, 1041, 1280]) {
    test(`the toolbar never covers the title or the country count at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await ready(page);
      const layout = await page.evaluate(() => {
        const rect = (sel: string) => {
          const el = document.querySelector(sel);
          const r = el?.getBoundingClientRect();
          return r && r.width > 0 ? r : null;
        };
        const left = ['#app-header h1', '#header-help-btn', '#menu-toggle', '#country-count']
          .map(rect).filter((r): r is DOMRect => r != null);
        return {
          toolbar: rect('.header-right')!.left,
          leftEnd: Math.max(...left.map(r => r.right)),
          scroll: document.documentElement.scrollWidth,
        };
      });
      expect(layout.toolbar).toBeGreaterThan(layout.leftEnd);
      expect(layout.scroll).toBeLessThanOrEqual(width);
    });
  }

  test('folded entries open as a second toolbar row', async ({ page }) => {
    await page.setViewportSize({ width: 1041, height: 800 });
    await ready(page);
    const drift = page.locator('#app-header .header-changes-link[href="/drift.html"]');
    await expect(page.locator('#export-btn')).toBeVisible();
    await expect(drift).toBeHidden();
    await page.click('#menu-toggle');
    await expect(drift).toBeVisible();

    // The narrowest tablets fold Export and Share as well.
    await page.setViewportSize({ width: 800, height: 800 });
    await page.click('#menu-toggle');
    await expect(page.locator('#export-btn')).toBeHidden();
    await page.click('#menu-toggle');
    await expect(page.locator('#export-btn')).toBeVisible();
  });
});

test('the comparison radar plots implementation only; governance style is a strip', async ({ page }) => {
  await page.goto('/?compare=France,Japan');
  await expect(page.locator('#comparison-panel')).toBeVisible({ timeout: 15_000 });
  // Side labels break over two tspans; join them back with a space.
  const labels = await page.locator('#radar-chart .radar-axis-label').evaluateAll(els =>
    els.map(el => (el.children.length ? [...el.children].map(t => t.textContent).join(' ') : el.textContent)));
  expect(labels).toEqual(['Implementation Index', 'Regulation Status', 'Policy Lever', 'Enforcement Level']);
  await expect(page.locator('#radar-chart .style-strip')).toContainText('Governance style');
  await expect(page.locator('#radar-chart .style-strip-row')).toHaveCount(2);
  const groups = await page.locator('#comparison-table tr.ct-group').allTextContents();
  expect(groups.map(g => g.trim())).toEqual([
    'Implementation: how much is in force, not how good it is',
    'Governance style: how, not how well',
    'Legislation',
  ]);
});
