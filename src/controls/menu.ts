// Header menu. Owns the "This week's changes" link to the digest page
// and the mobile-only ☰ toggle that folds the secondary header controls
// (filter, scatter, export, the changes link) away so the map keeps the
// screen; tapping it reveals them. The theme toggle and the freshness
// metadata stay OUT of the menu (persistent theme + trust signal). On
// desktop the button is hidden and the full toolbar shows inline, so the
// toggled `controls-open` class has no effect there.

import { on } from '../state/store';

const CHANGES_HREF = '/changes.html';

// Rendered here rather than in index.html so the menu module owns every
// secondary header entry; the link sits before the theme toggle.
function addChangesLink(header: HTMLElement): void {
  if (header.querySelector('.header-changes-link')) return;
  const link = document.createElement('a');
  link.className = 'header-changes-link';
  link.href = CHANGES_HREF;
  link.textContent = "This week's changes";
  link.title = 'What moved after the latest research run, with sources';
  const right = header.querySelector('.header-right') ?? header;
  const themeToggle = right.querySelector(':scope > #theme-toggle');
  if (themeToggle) right.insertBefore(link, themeToggle);
  else right.append(link);
}

export function initMenu(): void {
  const btn = document.getElementById('menu-toggle');
  const header = document.getElementById('app-header');
  if (header) addChangesLink(header);
  if (!btn) return;

  const setOpen = (open: boolean): void => {
    document.body.classList.toggle('controls-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Hide controls' : 'Show controls');
  };

  btn.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('controls-open'));
  });

  // Auto-close when the user taps outside the header (map, sheet,
  // timeline) - otherwise the expanded toolbar stays pinned over the map
  // for the rest of the session. Clicks on the toolbar popovers count as
  // inside, since they're anchored within #app-header.
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('controls-open')) return;
    if (header && header.contains(e.target as Node)) return;
    setOpen(false);
  });

  // Selecting a country (sheet) or opening a full view takes over the
  // screen, so collapse the menu rather than leave it hanging.
  on('selectedCountry', (name) => { if (name) setOpen(false); });
  on('mainView', (view) => { if (view !== 'map') setOpen(false); });
}
