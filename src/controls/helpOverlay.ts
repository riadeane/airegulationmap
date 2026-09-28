// "How to read this map" (PRD 16): one native modal <dialog> whose first
// section explains what a score means (the two lenses, what 1 and 5 mean,
// that higher is not better, confidence and the hatch) and whose second
// lists the keyboard shortcuts. It opens from the header ? button, the ?
// key (search.ts), the legend's "What does this mean?", the panel header,
// the empty state, the desktop intro and the mobile hint: every opener
// carries `data-explainer` and one delegated listener handles them all.
//
// showModal() makes the rest of the page inert (the focus trap), Esc and
// the close button and a backdrop click close it, and focus returns to the
// control that opened it.

import { maybeEl } from '../dom';

let opener: HTMLElement | null = null;

export function openHelpOverlay(from: HTMLElement | null = null): void {
  const dialog = maybeEl<HTMLDialogElement>('help-overlay');
  if (!dialog || dialog.open || typeof dialog.showModal !== 'function') return;
  opener = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  dialog.showModal();
  dialog.querySelector<HTMLElement>('.help-overlay-inner')?.scrollTo?.({ top: 0 });
  // Land on the title rather than the close button, so a screen reader
  // starts reading the guide and a sighted reader sees no stray ring.
  const title = dialog.querySelector<HTMLElement>('#help-overlay-title');
  if (title) {
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
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

  const helpBtn = document.getElementById('header-help-btn');
  helpBtn?.addEventListener('click', () => openHelpOverlay(helpBtn));

  // Every "How to read this map" / "What does this mean?" control.
  document.addEventListener('click', (e) => {
    const target = (e.target as Element | null)?.closest<HTMLElement>('[data-explainer]');
    if (target) openHelpOverlay(target);
  });

  // Backdrop click - <dialog> reports the click target as the dialog
  // itself when the user clicks outside the inner content.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeHelpOverlay();
  });

  // However it closed (Esc, button, backdrop), hand focus back to the
  // control that opened it, if that is still on screen.
  dialog.addEventListener('close', () => {
    const back = opener;
    opener = null;
    if (back && document.contains(back) && back.offsetParent !== null) {
      back.focus({ preventScroll: true });
    }
  });
}
