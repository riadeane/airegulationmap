// Theme toggle.
//
// Respects the user's stored preference if one exists, otherwise falls
// back to `prefers-color-scheme`. The initial attribute is set by a
// tiny inline script in index.html (before paint, to avoid FOUC); this
// module handles the runtime toggle and label updates.

const STORAGE_KEY = 'theme';

function systemPrefersLight() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function currentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return systemPrefersLight() ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* storage blocked */ }
  updateToggleLabel(theme);
}

function updateToggleLabel(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const next = theme === 'light' ? 'dark' : 'light';
  btn.setAttribute('aria-label', `Switch to ${next} theme`);
  btn.dataset.theme = theme;
}

export function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  updateToggleLabel(currentTheme());

  btn.addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });

  // If the user hasn't set an explicit preference, follow system changes live.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => {
      if (!localStorage.getItem(STORAGE_KEY)) updateToggleLabel(currentTheme());
    };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }
}
