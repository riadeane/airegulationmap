// Theme toggle.
//
// The effective theme is a `?theme=` URL parameter (this visit only),
// else the user's stored preference, else `prefers-color-scheme`. The
// inline script in index.html sets `data-theme` from the first two before
// paint (to avoid FOUC); this module handles the runtime toggle, the only
// thing that persists a choice, and label updates.

const STORAGE_KEY = 'theme';

function systemPrefersLight(): boolean {
  return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return systemPrefersLight() ? 'light' : 'dark';
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* storage blocked */ }
  updateToggleLabel(theme);
}

function updateToggleLabel(theme: 'light' | 'dark'): void {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const next = theme === 'light' ? 'dark' : 'light';
  btn.setAttribute('aria-label', `Switch to ${next} theme`);
  btn.dataset.theme = theme;
}

export function initTheme(): void {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  updateToggleLabel(currentTheme());

  btn.addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });

  // Follow system changes live. `currentTheme()` reads `data-theme` first,
  // so an explicit theme (URL, stored or toggled) keeps its label, and no
  // storage read can throw here.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => updateToggleLabel(currentTheme());
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }
}
