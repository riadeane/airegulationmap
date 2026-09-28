import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Insufficient evidence (rubric v3.1, issue #162): a scores.csv row with an
// empty cell. The committed data has none yet, so the served file is
// rewritten in flight: Germany's Enforcement Level and Maturity Index are
// blanked. The map must paint it in the neutral --score-insufficient fill
// (never the colour for 1, never the no-data fill), the legend must show
// the key only while such a country is on the map, and the panel must say
// "Insufficient evidence" instead of dots or a number.

const REST = '**/rest/v1/**';

type CountryPath = { __data__?: { properties?: { name?: string } } };

async function serveInsufficient(page: Page): Promise<void> {
  await page.route('**/scores.csv', async route => {
    const response = await route.fetch();
    const lines = (await response.text()).split('\n');
    const header = lines[0].replace(/\r$/, '').split(',');
    const blank = new Set([header.indexOf('Average Score'), header.indexOf('Enforcement Level')]);
    const body = lines.map(line => {
      if (!line.startsWith('Germany,')) return line;
      const cr = line.endsWith('\r') ? '\r' : '';
      const cells = line.replace(/\r$/, '').split(',').map((cell, i) => (blank.has(i) ? '' : cell));
      return cells.join(',') + cr;
    }).join('\n');
    await route.fulfill({ response, body });
  });
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

test.beforeEach(async ({ page }) => {
  await page.route(REST, route => route.abort());
  await serveInsufficient(page);
});

test('a country with insufficient evidence gets the neutral fill and a legend key', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });

  const insufficient = await tokenColor(page, '--score-insufficient');
  const noData = await tokenColor(page, '--no-data');
  const lowest = await fillOf(page, 'Afghanistan'); // scored 1.0 on every dimension
  await expect.poll(() => fillOf(page, 'Germany')).toBe(insufficient);
  expect(insufficient).not.toBe(noData);
  expect(insufficient).not.toBe(lowest);

  const key = page.locator('#map .legend-insufficient');
  await expect(key).toBeVisible();
  await expect(key).toContainText('Insufficient evidence');

  // Policy Lever: Germany has a score there, and nobody is insufficient,
  // so the key goes away.
  await page.goto('/?mode=policyLever');
  await page.waitForSelector('#map svg path.country', { timeout: 15_000 });
  await expect(page.locator('#map .legend-insufficient')).toBeHidden();
});

test('the panel says "Insufficient evidence" instead of dots or a number', async ({ page }) => {
  await page.goto('/?country=Germany');
  await expect(page.locator('#average-score')).toHaveText('Insufficient evidence');
  await expect(page.locator('#dots-enforcement')).toHaveText('Insufficient evidence');
  await expect(page.locator('#dots-enforcement .dim-dot')).toHaveCount(0);
  await expect(page.locator('#dots-policy .dim-dot')).toHaveCount(5);
});
