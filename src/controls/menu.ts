// Mobile-only "controls" menu. The ☰ toggle folds the secondary header
// controls (filter, scatter, export) away so the map keeps the screen;
// tapping it reveals them. The theme toggle and the freshness metadata
// stay OUT of the menu (persistent theme + trust signal). On desktop the
// button is hidden and the full toolbar shows inline, so the toggled
// `controls-open` class has no effect there.

import { on } from '../state/store';

export function initMenu(): void {
  const btn = document.getElementById('menu-toggle');
  const header = document.getElementById('app-header');
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
  // timeline) — otherwise the expanded toolbar stays pinned over the map
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
