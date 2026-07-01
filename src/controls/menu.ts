// Mobile-only "controls" menu. The ☰ toggle folds the secondary header
// controls (filter, scatter, export, theme) and the freshness metadata
// away so the map keeps the screen; tapping it reveals them. On desktop
// the button is hidden and the full toolbar shows inline, so the toggled
// `controls-open` class has no effect there (the hide rules live inside
// the mobile media query).

export function initMenu(): void {
  const btn = document.getElementById('menu-toggle');
  if (!btn) return;

  const setOpen = (open: boolean): void => {
    document.body.classList.toggle('controls-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Hide controls' : 'Show controls');
  };

  btn.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('controls-open'));
  });
}
