// First-run hint for touch users. On the sheet layout the desktop intro
// panel is off-screen (it lives inside the not-yet-open sheet), so a
// first-timer gets an unlabelled map. This shows a single dismissible
// hint, once, and retires it on the first real engagement.

import { on, getState } from '../state/store';

const KEY = 'mobileHintDismissed';

function isSheetLayout(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)').matches;
}

export function initOnboarding(): void {
  const hint = document.getElementById('mobile-hint');
  const closeBtn = document.getElementById('mobile-hint-close');
  if (!hint) return;

  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }

  const { selectedCountry, comparisonCountries } = getState();
  const alreadyEngaged = !!selectedCountry || (comparisonCountries?.length ?? 0) > 0;
  if (!dismissed && isSheetLayout() && !alreadyEngaged) {
    hint.hidden = false;
  }

  const dismiss = (): void => {
    hint.hidden = true;
    try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ }
  };

  closeBtn?.addEventListener('click', dismiss);
  // Any real engagement retires the hint (and remembers it).
  on('selectedCountry', (name) => { if (name) dismiss(); });
  on('comparisonCountries', (names) => { if (Array.isArray(names) && names.length) dismiss(); });
}
