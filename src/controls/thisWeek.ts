// "This week" strip: a one-line band under the header that lists the
// countries whose scores moved in the last seven days, largest move first.
// A returning visitor reads what changed without opening countries one by
// one. Click selects the country; hover or focus previews it on the map.
//
// The close control hides the strip for the session (sessionStorage) and a
// header button, "Show this week's changes", brings it back. Both live here
// so the strip owns its own visibility; nothing goes through the store or
// the URL. The strip only shows in the map view and never shows empty.

import { getState, on } from '../state/store';
import { selectCountry } from '../state/interactions';
import { recentScoreChanges } from '../state/selectors';
import { formatSignedDelta } from '../data/changelog';
import type { RecentChange } from '../data/changelog';
import { highlightCountry, clearHighlight } from '../map/index';

const MAX_ITEMS = 8;
const STORAGE_KEY = 'thisWeekDismissed';
const MORE_HREF = '/changes.html';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function readDismissed(): boolean {
  try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function writeDismissed(dismissed: boolean): void {
  try {
    if (dismissed) sessionStorage.setItem(STORAGE_KEY, '1');
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* storage blocked */ }
}

// Leaving an item returns the map to what the selection owns: the selected
// country's outline, or nothing.
function restoreHighlight(): void {
  const { selectedCountry } = getState();
  if (selectedCountry) highlightCountry(selectedCountry);
  else clearHighlight();
}

function buildItem(change: RecentChange): HTMLLIElement {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'this-week-item';
  btn.dataset.country = change.country;

  const up = change.delta > 0;
  const delta = formatSignedDelta(change.delta);
  const when = dateFormat.format(new Date(`${change.date}T00:00:00`));
  btn.title = `${change.country}: ${change.label} ${delta} on ${when}. Select to read more.`;
  btn.setAttribute(
    'aria-label',
    `${change.country}, ${change.label} ${up ? 'up' : 'down'} ${Math.abs(change.delta)}`
  );

  const name = document.createElement('span');
  name.className = 'this-week-country';
  name.textContent = change.country;

  const dim = document.createElement('span');
  dim.className = 'this-week-dim';
  dim.textContent = change.label;

  const move = document.createElement('span');
  move.className = `this-week-delta ${up ? 'up' : 'down'}`;
  move.textContent = delta;

  btn.append(name, dim, move);

  btn.addEventListener('click', () => selectCountry(change.country));
  btn.addEventListener('mouseenter', () => highlightCountry(change.country));
  btn.addEventListener('focus', () => highlightCountry(change.country));
  btn.addEventListener('mouseleave', restoreHighlight);
  btn.addEventListener('blur', restoreHighlight);

  li.appendChild(btn);
  return li;
}

// Static markup, no data-derived strings.
const TREND_ICON =
  '<svg class="this-week-restore-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 17l6-6 4 4 8-8"></path><path d="M14 7h7v7"></path></svg>';

// Rendered into the header toolbar next to the digest link, so it folds
// behind the mobile menu with the other secondary controls. The header is
// already full on desktop, so there it is an icon the size of the theme
// toggle; the text label shows only in the mobile menu, where the toolbar
// wraps. The accessible name is the same in both.
function buildRestoreButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'this-week-restore';
  btn.className = 'this-week-restore';
  btn.innerHTML = TREND_ICON;
  const text = document.createElement('span');
  text.className = 'this-week-restore-text';
  text.textContent = "Show this week's changes";
  btn.append(text);
  btn.setAttribute('aria-label', "Show this week's changes");
  btn.title = "Show this week's changes";
  btn.hidden = true;
  return btn;
}

export function initThisWeek(): void {
  const strip = document.getElementById('this-week-strip');
  const list = document.getElementById('this-week-list');
  const more = document.getElementById('this-week-more') as HTMLAnchorElement | null;
  const close = document.getElementById('this-week-close');
  if (!strip || !list || !more || !close) return;

  const restore = buildRestoreButton();
  const headerRight = document.querySelector('#app-header .header-right');
  if (headerRight) {
    const themeToggle = headerRight.querySelector(':scope > #theme-toggle');
    if (themeToggle) headerRight.insertBefore(restore, themeToggle);
    else headerRight.append(restore);
  }

  let dismissed = readDismissed();
  let changes: readonly RecentChange[] = [];

  const sync = (): void => {
    const onMap = getState().mainView === 'map';
    const hasChanges = changes.length > 0;
    strip.hidden = !(hasChanges && onMap && !dismissed);
    restore.hidden = !(hasChanges && onMap && dismissed);
  };

  const markSelected = (name: string | null): void => {
    for (const btn of list.querySelectorAll<HTMLButtonElement>('.this-week-item')) {
      const current = btn.dataset.country === name;
      if (current) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
  };

  const render = (): void => {
    changes = recentScoreChanges();
    list.replaceChildren(...changes.slice(0, MAX_ITEMS).map(buildItem));
    const rest = changes.length - MAX_ITEMS;
    more.hidden = rest <= 0;
    more.href = MORE_HREF;
    more.textContent = `+${rest} more`;
    markSelected(getState().selectedCountry);
    sync();
  };

  close.addEventListener('click', () => {
    dismissed = true;
    writeDismissed(true);
    restoreHighlight();
    sync();
    // Keep keyboard focus somewhere sensible after the strip vanishes.
    if (!restore.hidden) restore.focus();
  });

  restore.addEventListener('click', () => {
    dismissed = false;
    writeDismissed(false);
    sync();
    list.querySelector<HTMLButtonElement>('.this-week-item')?.focus();
  });

  on('history', render);
  on('mainView', sync);
  on('selectedCountry', markSelected);
  render();
}
