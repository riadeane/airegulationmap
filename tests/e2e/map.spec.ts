import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Map-level regressions: the geometry-to-data join, filters from a shared
// link on first paint, a theme switch during a filter fade, and the
// tooltip / live region on a past timeline date.

type CountryPath = { __data__?: { properties?: { name?: string } } };

async function pathProp(page: Page, name: string, prop: 'opacity' | 'fill'): Promise<string | null> {
  return page.evaluate(([country, p]) => {
    const path = Array.from(document.querySelectorAll('#map path.country')).find(
      el => (el as unknown as CountryPath).__data__?.properties?.name === country
    );
    return path ? getComputedStyle(path)[p as 'opacity' | 'fill'] : null;
  }, [name, prop]);
}

const opacityOf = async (page: Page, name: string): Promise<number> =>
  Number(await pathProp(page, name, 'opacity'));

async function ready(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
}

test('countries whose atlas name differs from the dataset draw with data', async ({ page }) => {
  await ready(page);
  const noData = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--no-data');
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  for (const name of ['Dominican Republic', 'Equatorial Guinea', 'Solomon Islands', 'East Timor', 'Swaziland']) {
    await expect.poll(() => pathProp(page, name, 'fill'), { message: name }).not.toBeNull();
    await expect.poll(() => pathProp(page, name, 'fill'), { message: name }).not.toBe(noData);
  }
});

test('filters in a shared link apply on first load', async ({ page }) => {
  await ready(page, '/?conf=high');
  await expect.poll(() => opacityOf(page, 'Chad')).toBeCloseTo(0.15, 2);
  await expect.poll(() => opacityOf(page, 'Japan')).toBe(1);

  await ready(page, '/?min=3');
  await expect.poll(() => opacityOf(page, 'Chad')).toBeCloseTo(0.15, 2);
  await expect.poll(() => opacityOf(page, 'Japan')).toBe(1);
});

test('a theme switch during a filter fade still settles the dimmed countries', async ({ page }) => {
  await ready(page);
  await page.click('#filter-btn');
  await page.locator('#filter-confidence input[value="low"]').uncheck();
  await page.click('#theme-toggle');
  await expect.poll(() => opacityOf(page, 'Chad')).toBeCloseTo(0.15, 2);
  await expect.poll(() => opacityOf(page, 'Japan')).toBe(1);
});

test('the tooltip and live region report the vintage the map is painting', async ({ page }) => {
  await ready(page);
  await page.waitForSelector('#timeline-strip', { state: 'visible', timeout: 15_000 });

  const { date, score } = await page.evaluate(async () => {
    const history = await (await fetch('/history.json')).json() as {
      countries: Record<string, { date: string; averageScore: number }[]>;
    };
    const dates = Object.values(history.countries).flat().map(s => s.date).sort();
    const earliest = dates[0];
    const albania = [...history.countries.Albania].sort((a, b) => a.date.localeCompare(b.date));
    const chosen = albania.filter(s => s.date <= earliest).pop() ?? albania[0];
    return { date: earliest, score: chosen.averageScore };
  });

  await page.locator('#timeline-slider').evaluate((el: HTMLInputElement) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.evaluate(() => {
    const path = Array.from(document.querySelectorAll('#map path.country')).find(
      el => (el as unknown as CountryPath).__data__?.properties?.name === 'Albania'
    )!;
    const box = path.getBoundingClientRect();
    path.dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
    }));
  });
  await expect(page.locator('div.tooltip')).toContainText(`${score} / 5 (${date})`);

  await page.fill('#country-search', 'Albania');
  await page.waitForSelector('#search-suggestions li[role="option"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#map-live-region')).toContainText(`${score} of 5 as of ${date}`);
});

// The data-load error boundary (panel/resilience.ts): when scores.csv
// fails, the map area says so and offers Retry and the raw data, instead
// of a loading skeleton that never resolves.
test('a failed scores.csv load shows the error state with Retry', async ({ page }) => {
  await page.route('**/scores.csv', route => route.abort());
  await page.goto('/');

  const error = page.locator('#map .map-error');
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toContainText("Couldn't load the regulation data.");
  await expect(error.getByRole('link', { name: 'View data on GitHub' })).toHaveAttribute('href', /github\.com/);
  await expect(page.locator('#map-skeleton')).toHaveCount(0);

  // Retry reloads; with the fault gone the map draws.
  await page.unroute('**/scores.csv');
  await error.getByRole('button', { name: 'Retry' }).click();
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
});

