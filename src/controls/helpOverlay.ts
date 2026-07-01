// Help overlay — native <dialog>, showing the keyboard shortcuts that
// already exist in src/controls/search.js. Opens via ? key (wired in
// search.js) or the header ? button (wired here). Esc and backdrop
// click close it for free via <dialog> semantics.

import { maybeEl } from '../dom';

export function openHelpOverlay(): void {
  const dialog = maybeEl<HTMLDialogElement>('help-overlay');
  if (dialog && !dialog.open && typeof dialog.showModal === 'function') {
    dialog.showModal();
  }
}

export function closeHelpOverlay(): void {
  const dialog = maybeEl<HTMLDialogElement>('help-overlay');
  if (dialog && dialog.open) dialog.close();
}

export function initHelpOverlay(): void {
  const dialog = maybeEl<HTMLDialogElement>('help-overlay');
  if (!dialog) return;

  document.getElementById('help-overlay-close')
    ?.addEventListener('click', closeHelpOverlay);

  document.getElementById('header-help-btn')
    ?.addEventListener('click', openHelpOverlay);

  // Backdrop click — <dialog> reports the click target as the dialog
  // itself when the user clicks outside the inner content.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeHelpOverlay();
  });
}
