import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// The panel must show the same score vintage the map is painting while the
// timeline is scrubbed - and say so. Uses the real history.json served by
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
  // Rank is a latest-data derivation - it hides for historical vintages.
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

// Snapshot helpers over the served history.json: the scores a country
// carries on `date` (the latest snapshot on or before it, else its
// earliest), as buildScoresAtDate resolves them.
type Snapshot = { date: string; averageScore: number | null };

async function historyFacts(page: Page): Promise<{ countries: Record<string, Snapshot[]>; dates: string[] }> {
  return page.evaluate(async () => {
    const history = await (await fetch('/history.json')).json() as {
      countries: Record<string, { date: string; averageScore: number | null }[]>;
    };
    const dates = [...new Set(Object.values(history.countries).flat().map(s => s.date))].sort();
    return { countries: history.countries, dates };
  });
}

function scoreAt(snapshots: Snapshot[], date: string): number | null {
  const ordered = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  return (ordered.filter(s => s.date <= date).pop() ?? ordered[0]).averageScore;
}

// Regression: with ?country=&date=, the panel rendered before history.json
// arrived and only re-rendered on blocs.json - so when history landed
// last, the panel kept the LATEST scores under a past-dated map.
test('a ?date= deep link re-vintages the panel when history lands last', async ({ page }) => {
  const { countries, dates } = await historyFacts(page);
  const date = dates[0];
  const expected = scoreAt(countries.Germany, date);

  await page.route('**/history.json', async route => {
    // Hold history until blocs.json has been applied (the bloc selector
    // mounts from it), the order that used to leave the panel stale.
    await page.waitForSelector('#bloc-select', { state: 'attached' });
    await route.continue();
  });
  await page.goto(`/?country=Germany&date=${date}`);
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });

  await expect(page.locator('#average-score')).toHaveText(`${expected} / 5`);
  await expect(page.locator('#panel-history-notice')).toBeVisible();
  await expect(page.locator('#maturity-rank')).toHaveText('');
  await expect(page.locator('#map-live-region')).toContainText(`as of ${date}`);
});

// Regression: ?date=<the latest snapshot date> left a mixed state - the
// slider read "Latest" but the panel stayed historical and date= stayed.
test('the latest snapshot date deep-links as Latest', async ({ page }) => {
  const { dates } = await historyFacts(page);
  const latest = dates[dates.length - 1];
  await page.goto(`/?country=Germany&date=${latest}`);
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });

  await expect(page.locator('#timeline-date-label')).toHaveText('Latest');
  await expect(page.locator('#panel-history-notice')).toBeHidden();
  await expect(page.locator('.dim-expand').first()).toBeEnabled();
  await expect.poll(() => new URL(page.url()).searchParams.has('date')).toBe(false);
});

// Regression: the slider had no aria-valuetext, so screen readers spoke
// the index ("2") instead of the date.
test('the timeline slider speaks the date, not its index', async ({ page }) => {
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });
  const slider = page.locator('#timeline-slider');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Latest');

  const { dates } = await historyFacts(page);
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(slider).toHaveAttribute('aria-valuetext', dates[0]);

  await page.click('#timeline-reset');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Latest');
});

// Regression: the bloc card averaged the latest scores whatever date the
// map was painting.
test('the bloc summary follows the timeline vintage', async ({ page }) => {
  const { countries, dates } = await historyFacts(page);
  const date = dates[0];
  const members = await page.evaluate(async () =>
    ((await (await fetch('/data/blocs.json')).json()) as Record<string, { members: string[] }>).G7.members);
  const scores = members
    .map(name => (countries[name] ? scoreAt(countries[name], date) : null))
    .filter((v): v is number => v != null);
  const expected = +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

  await page.goto(`/?bloc=G7&date=${date}`);
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });
  const average = page.locator('#bloc-summary .bloc-stat-value').first();
  await expect(average).toHaveText(String(expected));
  await expect(page.locator('#bloc-summary .bloc-summary-dim')).toContainText(`as of ${date}`);

  await page.click('#timeline-reset');
  await expect(page.locator('#bloc-summary .bloc-summary-dim')).not.toContainText('as of');
});
