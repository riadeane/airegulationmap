import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Keyboard regressions: the score-type listbox, keys behind the help
// dialog, form controls that own the arrow keys, and Esc inside a header
// popover.

async function ready(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  // Attached, not visible: the scatter view hides the map layer.
  await page.waitForSelector('#map svg path.country', { state: 'attached', timeout: 15_000 });
}

test('the score-type listbox works from the keyboard', async ({ page }) => {
  await ready(page);
  const listbox = page.locator('#score-dropdown');
  await expect(listbox.locator('[role="option"]')).toHaveCount(6);

  // Enter on the button opens the list on the selected option.
  await page.focus('#score-btn');
  await page.keyboard.press('Enter');
  await expect(listbox).toHaveClass(/open/);
  await expect(page.locator('#score-btn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#score-option-averageScore')).toBeFocused();
  await expect(page.locator('#score-option-averageScore')).toHaveAttribute('aria-selected', 'true');

  // Arrows rove, Enter picks and hands focus back to the button.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#score-option-regulationStatus')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(listbox).not.toHaveClass(/open/);
  await expect(page.locator('#score-btn')).toBeFocused();
  await expect(page.locator('#score-btn-label')).toHaveText('Regulation Status');
  await expect(page.locator('#score-option-regulationStatus')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#score-option-averageScore')).toHaveAttribute('aria-selected', 'false');
  await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('regulationStatus');

  // ArrowDown on the button opens it too; Left/Right inside the list do not
  // step the selected country; Esc closes without a change.
  await page.keyboard.press('ArrowDown');
  await expect(listbox).toHaveClass(/open/);
  await page.keyboard.press('End');
  await expect(page.locator('#score-option-enforcementLevel')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#panel-content')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(listbox).not.toHaveClass(/open/);
  await expect(page.locator('#score-btn')).toBeFocused();
  await expect(page.locator('#score-btn-label')).toHaveText('Regulation Status');
});

test('keys do nothing behind the open help dialog', async ({ page }) => {
  await ready(page, '/?country=Germany&scatter=1');
  await expect(page.locator('body')).toHaveClass(/view-scatter/);

  await page.keyboard.press('?');
  await expect(page.locator('#help-overlay')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#country-name')).toHaveText('Germany');

  // Esc closes the dialog only - scatter and the selection stay.
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-overlay')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/view-scatter/);
  await expect(page.locator('#country-name')).toHaveText('Germany');
});

test('arrow keys on a select change the select, not the country', async ({ page }) => {
  await ready(page, '/?scatter=1&country=Germany');
  await page.focus('#scatter-x');
  // One key only: Right then Left would step the country and back.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#country-name')).toHaveText('Germany');
});

test('Esc inside the filter popover closes it and returns focus to its button', async ({ page }) => {
  await ready(page);
  await page.click('#filter-btn');
  await expect(page.locator('#filter-popover')).toHaveClass(/open/);
  await page.focus('#filter-min');
  await page.keyboard.press('Escape');
  await expect(page.locator('#filter-popover')).not.toHaveClass(/open/);
  await expect(page.locator('#filter-btn')).toBeFocused();
  await expect(page.locator('#filter-btn')).toHaveAttribute('aria-expanded', 'false');
});
