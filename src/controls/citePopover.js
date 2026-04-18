// "Cite" popover anchored under the panel's Cite button.
//
// Not a modal — a lightweight dismissable popover that shows three
// formatted citation strings (APA / Chicago / MLA) with per-format
// copy buttons. The permalink embedded in each citation is generated
// fresh every open so scoped views stay citeable.

import { getState, on } from '../state/store.js';
import { citationsFor } from './citation.js';
import { buildPermalink } from './url.js';

const FORMATS = [
  { key: 'apa', label: 'APA' },
  { key: 'chicago', label: 'Chicago' },
  { key: 'mla', label: 'MLA' },
];

let popoverEl;
let buttonEl;
let isOpen = false;

function removeAllChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function copyToClipboard(text, confirmBtn) {
  const original = confirmBtn.textContent;
  let success = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      success = true;
    } else {
      // Fallback for non-HTTPS (e.g. preview servers). Ephemeral
      // textarea + execCommand is deprecated but still broadly
      // supported and works when the Clipboard API isn't available.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      success = document.execCommand('copy');
      document.body.removeChild(ta);
    }
  } catch (e) {
    console.warn('[cite] copy failed', e);
  }

  confirmBtn.textContent = success ? 'Copied \u2713' : 'Copy failed';
  confirmBtn.classList.toggle('copied', success);
  setTimeout(() => {
    confirmBtn.textContent = original;
    confirmBtn.classList.remove('copied');
  }, 1500);
}

function renderRows() {
  const state = getState();
  const url = buildPermalink(state);
  const citations = citationsFor({
    country: state.selectedCountry,
    compareCountries: state.comparisonCountries,
    mode: state.currentAttribute,
    timelineDate: state.timelineDate,
    url,
  });

  removeAllChildren(popoverEl);

  const heading = document.createElement('p');
  heading.className = 'cite-popover-heading';
  heading.textContent = 'Copy a formatted citation for this view';
  popoverEl.appendChild(heading);

  for (const { key, label } of FORMATS) {
    const row = document.createElement('div');
    row.className = 'cite-row';

    const header = document.createElement('div');
    header.className = 'cite-row-header';

    const formatLabel = document.createElement('span');
    formatLabel.className = 'cite-format';
    formatLabel.textContent = label;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cite-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => copyToClipboard(citations[key], copyBtn));

    header.appendChild(formatLabel);
    header.appendChild(copyBtn);

    const block = document.createElement('code');
    block.className = 'cite-block';
    block.textContent = citations[key];

    row.appendChild(header);
    row.appendChild(block);
    popoverEl.appendChild(row);
  }
}

function openPopover() {
  if (!popoverEl || !buttonEl) return;
  renderRows();
  popoverEl.hidden = false;
  buttonEl.setAttribute('aria-expanded', 'true');
  isOpen = true;

  // Dismiss on outside click / Escape. Bound in a microtask so the
  // opening click itself doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
  }, 0);
}

function closePopover() {
  if (!popoverEl) return;
  popoverEl.hidden = true;
  if (buttonEl) buttonEl.setAttribute('aria-expanded', 'false');
  isOpen = false;
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onDocKey);
}

function onDocClick(e) {
  if (!isOpen) return;
  if (popoverEl.contains(e.target)) return;
  if (buttonEl && buttonEl.contains(e.target)) return;
  closePopover();
}

function onDocKey(e) {
  if (e.key === 'Escape') closePopover();
}

export function initCitePopover() {
  buttonEl = document.getElementById('cite-btn');
  popoverEl = document.getElementById('cite-popover');
  if (!buttonEl || !popoverEl) return;

  buttonEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) closePopover();
    else openPopover();
  });

  // Re-render in place if the state changes while the popover is open
  // (e.g. user clicks a country in comparison mode without closing).
  const rerenderIfOpen = () => { if (isOpen) renderRows(); };
  on('selectedCountry', rerenderIfOpen);
  on('comparisonCountries', rerenderIfOpen);
  on('currentAttribute', rerenderIfOpen);
  on('timelineDate', rerenderIfOpen);
}
