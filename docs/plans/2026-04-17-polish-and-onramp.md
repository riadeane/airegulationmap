# Polish & On-ramp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** A weekend-scoped polish pass on `airegulationmap.org` — a display-layer copy normalizer, a compressed first-visit on-ramp in the empty country panel, a source-count signal in the per-country date line, and a `?` keyboard-shortcut help overlay. No new data, no new dependencies, no framework migration.

**Architecture:** Vanilla JS + D3 + Vite, as-is. One new display module (`src/panel/normalize.js`), one new UI module (`src/controls/helpOverlay.js`), one new stylesheet partial (`src/styles/_overlay.css`). All other changes are edits to existing files. URL-sync, state store, and data loaders are untouched.

**Tech Stack:** Vanilla JS, D3.js 7, TopoJSON, Vite, OKLCH tokens.

**Design doc:** [2026-04-17-polish-and-onramp-spec.md](./2026-04-17-polish-and-onramp-spec.md) — read first if unclear on any task's intent.

**Design principles to honor throughout:**
- Principle 1 (map is protagonist): the on-ramp lives in the empty panel and is removed on first engagement — no global chrome added.
- Principle 2 (rigor over ornament): no animations, no gradients, no color tokens outside the existing palette.
- Principle 4 (citeable by default): the source-count line is honest about "no primary sources" rather than hiding the zero case.

**Sibling plans (do not duplicate):**
- [2026-04-17-citability-and-resilience.md](./2026-04-17-citability-and-resilience.md) — already shipped. Methodology page, permalinks, cite popover, skeleton + error state, noscript fallback, three-tier confidence badge.

---

## Task 1: Copy normalizer

**Goal:** Strip repetitive boilerplate from LLM-generated regulation descriptions at display time. CSV data is untouched. A feature flag lets you disable the transform for A/B inspection.

**Files:**
- Create: `src/panel/normalize.js`
- Modify: `src/constants.js` (add `NORMALIZE_COPY` flag)
- Modify: `src/panel/sections.js` (call normalizer inside `cleanRegulationText`)

### Step 1.1 — Add the feature flag

In `src/constants.js`, append a new export at the bottom:

```js
// Display-time cleanup of LLM-generated regulation descriptions.
// Set to false for A/B eyeballing against the raw CSV text.
export const NORMALIZE_COPY = true;
```

### Step 1.2 — Create `src/panel/normalize.js`

Full file contents:

```js
// Display-time text cleanup for LLM-generated regulation descriptions.
//
// Three conservative passes, each opt-out on guard. If the normalizer
// shrinks the text below 60% of its original length or produces an empty
// string, return the original — better stiff than factually truncated.
//
// CSV data is never modified. Every call is scoped to one free-text field
// at render time in src/panel/sections.js.

import { NORMALIZE_COPY } from '../constants.js';

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

// "Country X has no Y, as of April 2026." → strip the "as of …" clause.
// Only applied when the phrase lives inside the first 80 characters AND
// at least one further sentence follows. Preserves trailing "as of …"
// which often carries legitimate anchoring mid-paragraph.
const LEADING_TEMPORAL_RE = new RegExp(
  `^([\\s\\S]{0,80}?)\\s*(?:,\\s*)?as of (?:${MONTHS}) \\d{4}\\s*(?=[.,])`,
  'i'
);

// Stopwords for the cascading-negation vocabulary-overlap heuristic.
const STOPWORDS = new Set([
  'a','an','the','of','on','in','to','for','and','or','but','at','by','with',
  'is','are','was','were','be','been','being','has','have','had','do','does',
  'did','will','would','can','could','should','as','that','this','these','those',
  'it','its','he','she','they','them','their','there','here','than','then','so',
  'no','not','any','all','some','such','only','also','yet','from','into','over',
  'under','about','through','between','among','per','via','nor','exist','exists'
]);

function tokens(s) {
  return (s.toLowerCase().match(/[a-z][a-z-]+/g) || [])
    .filter(t => !STOPWORDS.has(t) && t.length > 2);
}

function stripLeadingTemporal(text) {
  const sentenceCount = (text.match(/[.!?](\s|$)/g) || []).length;
  if (sentenceCount < 2) return text;
  return text.replace(LEADING_TEMPORAL_RE, '$1').replace(/^\s*,\s*/, '').trim();
}

// Heuristic: a run of sentences all starting with "No " is redundant if
// every sentence after the first shares ≥2 non-stopword tokens with the
// first. Conservative — genuinely distinct claims fall through.
function sharesVocab(sentences) {
  const firstTokens = new Set(tokens(sentences[0]));
  if (firstTokens.size < 2) return false;
  for (let i = 1; i < sentences.length; i++) {
    const shared = tokens(sentences[i]).filter(w => firstTokens.has(w)).length;
    if (shared < 2) return false;
  }
  return true;
}

function collapseCascadingNegations(text) {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (!sentences || sentences.length < 3) return text;

  const out = [];
  let run = [];

  const flushRun = () => {
    if (run.length >= 3 && sharesVocab(run)) {
      out.push('No AI-specific legislation, governance body, or enforcement mechanism exists. ');
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const s of sentences) {
    if (/^\s*No\s/.test(s)) {
      run.push(s);
    } else {
      flushRun();
      out.push(s);
    }
  }
  flushRun();
  return out.join('').trim();
}

function trimLeadingHedges(text) {
  return text
    .replace(/^(Generally|Broadly|Notably|Essentially|Largely),\s*/i, '')
    .replace(/([.!?]\s+)(Generally|Broadly|Notably|Essentially|Largely),\s+/g, '$1');
}

export function normalizeRegulationText(text) {
  if (!NORMALIZE_COPY) return text;
  if (!text || typeof text !== 'string') return text;

  const original = text;
  let out = text;

  out = stripLeadingTemporal(out);
  out = collapseCascadingNegations(out);
  out = trimLeadingHedges(out);

  // Safety rail — never silently chew a claim into nothing.
  if (!out || out.trim().length === 0) return original;
  if (out.length < original.length * 0.6) return original;
  return out;
}
```

### Step 1.3 — Wire into `cleanRegulationText`

In `src/panel/sections.js`, update the imports and the `cleanRegulationText` function:

```js
import { PLACEHOLDER_RE } from '../constants.js';
import { normalizeRegulationText } from './normalize.js';

export function showSection(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}

export function cleanRegulationText(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (PLACEHOLDER_RE.test(trimmed)) return null;
  if (/^(cf\.|Cf\.)\s/i.test(trimmed) && trimmed.length < 40) return null;
  if (/^idem\b/i.test(trimmed) && trimmed.length < 10) return null;
  return normalizeRegulationText(trimmed);
}
```

Only the last two lines change — the import and the `return` of `cleanRegulationText`. Leave the rest of the file intact.

### Step 1.4 — Verify in the dev server

Run:

```bash
npm run dev
```

Open the local URL, then click through these 10 countries in the panel. For each, confirm the text reads cleaner (shorter, no "as of April 2026" stock openers, no cascading "No X" chains) without losing factual content:

- Afghanistan (heavy "No X" cascade)
- Algeria (moderate cascade, temporal opener)
- Angola (cascade)
- Antigua and Barbuda (cascade)
- Argentina (substantive content — should be mostly unchanged)
- Germany (rich content — should be mostly unchanged)
- France (rich content — should be mostly unchanged)
- Singapore (mid-register)
- Kenya (mid-register)
- Belarus (edge case — unusual structure)

Then flip the flag to confirm the opt-out works:

1. In `src/constants.js`, change `export const NORMALIZE_COPY = true;` to `false;`.
2. Save — Vite HMR refreshes.
3. Open Afghanistan again — text should now show the original "as of March 2026" opener and all cascading "No X" sentences.
4. Flip back to `true`.

### Step 1.5 — Commit

```bash
git add src/panel/normalize.js src/panel/sections.js src/constants.js
git commit -m "feat: normalize LLM-generated country descriptions at display time"
```

---

## Task 2: Source-count in date line

**Goal:** Surface a count of primary sources inline with the "Data as of YYYY-MM-DD" line in the country header. Honest "no primary sources" fallback when empty.

**Files:**
- Modify: `src/panel/index.js`

### Step 2.1 — Extend `renderPanel`

In `src/panel/index.js`, find the `dateStr` block (currently around lines 94–95):

```js
const dateStr = (score && score.lastUpdated) || (reg && reg.lastUpdated);
document.getElementById('last-updated').textContent = dateStr ? `Data as of ${dateStr}` : '';
```

Replace with:

```js
const dateStr = (score && score.lastUpdated) || (reg && reg.lastUpdated);
const sourceUrls = reg && reg.sources
  ? reg.sources.split('|').map(u => u.trim()).filter(Boolean)
  : [];
const countText = sourceUrls.length > 0
  ? `${sourceUrls.length} source${sourceUrls.length === 1 ? '' : 's'}`
  : 'no primary sources';
document.getElementById('last-updated').textContent = dateStr
  ? `Data as of ${dateStr} · ${countText}`
  : countText;
```

Nothing else in the file changes.

### Step 2.2 — Verify

With the dev server still running from Task 1:

1. Click Germany (or any country with multiple sources) → date line reads like `Data as of 2026-03-21 · 3 sources`.
2. Click Afghanistan (no sources in the CSV as of April 2026) → date line reads `Data as of 2026-03-21 · no primary sources`.
3. Click a country with exactly one source → `· 1 source` (singular).

Spot-check on both light and dark themes by toggling the theme button in the header.

### Step 2.3 — Commit

```bash
git add src/panel/index.js
git commit -m "feat: surface source count inline with per-country date line"
```

---

## Task 3: Empty-panel on-ramp

**Goal:** Replace the single-line empty-panel message with a richer orientation moment — a display-weight lede, three numbered steps, a methodology link. Removed from the DOM on first engagement; a plain one-liner takes its place for subsequent deselects.

**Files:**
- Modify: `src/styles/_reset.css` (add shared `<kbd>` base styles)
- Modify: `index.html` (replace `#no-selection-message` markup)
- Modify: `src/styles/_panel.css` (add `.panel-intro` styles)
- Modify: `src/panel/index.js` (state transition: remove intro on first engage; show plain one-liner thereafter)

### Step 3.1 — Add shared `<kbd>` base styles

The `<kbd>` element is used both by the overlay (Task 4) and by the empty-panel intro below. Keep the base styling in `_reset.css` so both consumers share one source.

In `src/styles/_reset.css`, append at the bottom (after the `.noscript-fallback` rules):

```css
/* Keyboard-key pill. Shared by the empty-panel on-ramp and the help
   overlay. Small monospace badge; inherits color from the surrounding
   text so it reads quiet. */
kbd {
  display: inline-block;
  min-width: 1.4em;
  padding: 0 0.4em;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 0.82em;
  font-weight: 500;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  text-align: center;
  font-variant-numeric: tabular-nums;
  vertical-align: baseline;
}
```

### Step 3.2 — Replace the empty-panel markup

In `index.html`, find the current empty-panel paragraph (inside `<aside id="country-panel">`, currently around line 155):

```html
<p id="no-selection-message">Select a country to see details.<br><span class="hint">Tip: Shift+click two or more countries to compare them.</span></p>
```

Replace with:

```html
<div id="panel-intro" class="panel-intro">
  <p class="panel-intro-lede">Global AI governance across 196 countries, scored on six dimensions.</p>
  <ol class="panel-intro-steps">
    <li><span class="panel-intro-num">01</span> Click a country to read its regulatory posture.</li>
    <li><span class="panel-intro-num">02</span> Shift-click to compare up to four.</li>
    <li><span class="panel-intro-num">03</span> Press <kbd>?</kbd> for keyboard shortcuts.</li>
  </ol>
  <a class="panel-intro-methodology" href="/methodology.html">Read the methodology &rarr;</a>
</div>
<p id="no-selection-message" class="no-selection-message" hidden>Select a country to see details.</p>
```

Two elements sit where there used to be one. The intro is visible at initial render; `#no-selection-message` starts hidden.

### Step 3.3 — Add `.panel-intro` styles

In `src/styles/_panel.css`, append at the bottom of the file:

```css
/* ── Empty-panel on-ramp ──────────────────────────────────────
   Shown once, on first load, before any country is selected.
   Removed from the DOM on first engagement (see src/panel/index.js).
   After that, #no-selection-message takes over as a quiet one-liner.
   ----------------------------------------------------------- */
.panel-intro {
  padding: 28px 22px 24px;
  max-width: 320px;
}

.panel-intro-lede {
  font-family: 'Literata', Georgia, serif;
  font-size: 1.15rem;
  font-weight: 400;
  line-height: 1.35;
  color: var(--text-primary);
  letter-spacing: -0.005em;
  margin-bottom: 22px;
}

.panel-intro-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-intro-steps li {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.panel-intro-num {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  flex-shrink: 0;
  min-width: 1.8em;
}

.panel-intro-methodology {
  display: inline-block;
  font-size: 0.78rem;
  color: var(--text-secondary);
  text-decoration: none;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1px;
  transition: color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}

.panel-intro-methodology:hover {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.no-selection-message {
  padding: 24px 22px;
  font-size: 0.82rem;
  color: var(--text-secondary);
  font-style: italic;
}
```

The rule for `.no-selection-message` replaces any existing styling for `#no-selection-message`. If the existing file has an older `#no-selection-message` rule, leave it — the `hidden` attribute on the element is an HTML-level override that wins regardless. (Claude can remove it as cleanup if obvious; otherwise leave it.)

### Step 3.4 — State transition in `src/panel/index.js`

Two changes:
1. Add a once-per-session subscription that removes `#panel-intro` from the DOM on first `selectedCountry` or `comparisonCountries` engagement.
2. Update `clearPanel` to show `#no-selection-message` (the plain one-liner) after engagement, not the intro.

Open `src/panel/index.js`. Find `clearPanel` (currently around line 106):

```js
function clearPanel() {
  document.getElementById('no-selection-message').style.display = '';
  document.getElementById('panel-content').style.display = 'none';
  clearHighlight();
  updateCompareButton();
  updateCiteButton();
}
```

Replace with:

```js
function clearPanel() {
  const fallback = document.getElementById('no-selection-message');
  if (fallback) fallback.hidden = false;
  document.getElementById('panel-content').style.display = 'none';
  clearHighlight();
  updateCompareButton();
  updateCiteButton();
}
```

Note the swap from `style.display = ''` to the `hidden` attribute — matches the markup change in Step 3.2.

Next, find `renderPanel` (around line 61). Inside the `if (!comparisonActive)` block near the top (around line 70):

```js
if (!comparisonActive) {
  document.getElementById('no-selection-message').style.display = 'none';
  document.getElementById('panel-content').style.display = '';
}
```

Replace with:

```js
if (!comparisonActive) {
  const fallback = document.getElementById('no-selection-message');
  if (fallback) fallback.hidden = true;
  document.getElementById('panel-content').style.display = '';
}
```

Finally, add the intro-removal logic. At the end of `initPanel` (currently ends around line 134), just before the closing `}`, add:

```js
  let introConsumed = false;
  const consumeIntro = () => {
    if (introConsumed) return;
    const { selectedCountry, comparisonCountries } = getState();
    if (selectedCountry || (comparisonCountries && comparisonCountries.length > 0)) {
      introConsumed = true;
      const intro = document.getElementById('panel-intro');
      if (intro) intro.remove();
    }
  };
  on('selectedCountry', consumeIntro);
  on('comparisonCountries', consumeIntro);
```

`consumeIntro` runs on every state change but early-returns after the first engagement. The DOM node is physically removed so it can't come back. The `#no-selection-message` one-liner takes its place on subsequent deselects.

### Step 3.5 — Verify

With the dev server still running:

1. Hard-reload the page (Cmd+Shift+R) with no country selected in the URL. Expected: the panel shows the Literata lede, three numbered steps (01 / 02 / 03), and the methodology link. Take a screenshot if you want to compare later.
2. Click any country → country panel renders; reload the page; the intro comes back (once per page load is correct).
3. Click a country → panel renders → press Esc → now shows "Select a country to see details." in the quiet italic style. Confirm the intro does NOT return.
4. Click a country again → panel renders. Reload → intro returns.
5. Toggle light/dark theme → the lede Literata color, the Geist Mono numbers, and the methodology link border all read correctly on both.
6. Press Tab from the search input → the methodology link inside the intro should receive focus with the global `:focus-visible` ring.

### Step 3.6 — Commit

```bash
git add src/styles/_reset.css src/styles/_panel.css index.html src/panel/index.js
git commit -m "feat: orientation on-ramp in empty country panel"
```

---

## Task 4: Help overlay

**Goal:** A native `<dialog>` surfaces every keyboard shortcut the app already wires. Opens via `?` key or the header `?` icon. Esc or backdrop click closes.

**Files:**
- Create: `src/controls/helpOverlay.js`
- Create: `src/styles/_overlay.css`
- Modify: `index.html` (change header `?` from anchor to button; add `<dialog>` element)
- Modify: `src/styles/_header.css` (rename `.header-methodology-link` → `.header-help-btn`)
- Modify: `src/styles/main.css` (import `_overlay.css`)
- Modify: `src/main.js` (call `initHelpOverlay`)
- Modify: `src/controls/search.js` (wire `?` key inside `initKeyboardNav`)

### Step 4.1 — Add the `<dialog>` markup

In `index.html`, find the header `?` link (currently around line 73):

```html
<a
  class="header-methodology-link"
  href="/methodology.html"
  aria-label="How countries are scored — methodology"
  title="Methodology"
>?</a>
```

Replace with:

```html
<button
  id="header-help-btn"
  class="header-help-btn"
  type="button"
  aria-label="Keyboard shortcuts and help"
  title="Keyboard shortcuts"
>?</button>
```

In `src/styles/_header.css`, rename the CSS class to match — find both selectors and replace:

```css
/* Before */
.header-methodology-link { ... }
.header-methodology-link:hover,
.header-methodology-link:focus-visible { ... }

/* After */
.header-help-btn { ... }
.header-help-btn:hover,
.header-help-btn:focus-visible { ... }
```

Keep all property values unchanged — only the selector names change. Also drop the comment `"?" info icon next to the site title — links to methodology.html.` in favor of `"?" help button next to the site title — opens the shortcuts overlay.`

Because the element is now a `<button>` instead of an `<a>`, add `cursor: pointer;` and `background: transparent;` inside the rule so it doesn't render with the default button chrome. Specifically, the rule becomes:

```css
.header-help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-tertiary);
  font-family: 'Geist Mono', 'JetBrains Mono', monospace;
  font-size: 0.66rem;
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s var(--ease-out), border-color 0.15s var(--ease-out), background 0.15s var(--ease-out);
  align-self: center;
  flex-shrink: 0;
}

.header-help-btn:hover,
.header-help-btn:focus-visible {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-muted);
}
```

Then, just before `</body>` in `index.html`, add the dialog:

```html
<dialog id="help-overlay" class="help-overlay" aria-label="Keyboard shortcuts and help">
  <div class="help-overlay-inner">
    <button id="help-overlay-close" class="help-overlay-close" type="button" aria-label="Close">&times;</button>
    <h2 class="help-overlay-title">Keyboard shortcuts</h2>
    <div class="help-overlay-grid">
      <dl>
        <dt><kbd>/</kbd> or <kbd>&#8984;</kbd><kbd>K</kbd></dt>
        <dd>Focus search</dd>
        <dt><kbd>&larr;</kbd> <kbd>&rarr;</kbd></dt>
        <dd>Step through countries</dd>
        <dt><kbd>?</kbd></dt>
        <dd>This menu</dd>
      </dl>
      <dl>
        <dt>Click</dt>
        <dd>Select country</dd>
        <dt>Shift&#8239;+&#8239;click</dt>
        <dd>Add to comparison</dd>
        <dt><kbd>Esc</kbd></dt>
        <dd>Close / deselect</dd>
      </dl>
    </div>
    <p class="help-overlay-footer">More detail in the <a href="/methodology.html">methodology</a>.</p>
  </div>
</dialog>
```

### Step 4.2 — Create `src/styles/_overlay.css`

Full file contents:

```css
/* ── Help overlay ─────────────────────────────────────────────
   Native <dialog> — gives us focus trap, Esc-to-close, and
   ::backdrop for free. Sits over the full viewport.
   ----------------------------------------------------------- */
.help-overlay {
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-primary);
  max-width: 480px;
  width: calc(100% - 32px);
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.4);
}

.help-overlay::backdrop {
  background: rgb(0 0 0 / 0.4);
  backdrop-filter: blur(2px);
}

:root[data-theme='light'] .help-overlay::backdrop {
  background: rgb(20 20 28 / 0.18);
}

.help-overlay-inner {
  position: relative;
  padding: 28px 32px 24px;
}

.help-overlay-title {
  font-family: 'Literata', Georgia, serif;
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: -0.005em;
  margin-bottom: 18px;
  color: var(--text-primary);
}

.help-overlay-close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color 0.15s var(--ease-out), background 0.15s var(--ease-out);
}

.help-overlay-close:hover {
  color: var(--text-primary);
  background: var(--surface-raised);
}

.help-overlay-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px 28px;
  margin-bottom: 20px;
}

.help-overlay-grid dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 14px;
  align-items: center;
  font-size: 0.82rem;
}

.help-overlay-grid dt {
  display: flex;
  gap: 4px;
  align-items: center;
  color: var(--text-primary);
  white-space: nowrap;
}

.help-overlay-grid dd {
  color: var(--text-secondary);
  margin: 0;
}

.help-overlay-footer {
  font-size: 0.76rem;
  color: var(--text-tertiary);
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.help-overlay-footer a {
  color: var(--text-secondary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.help-overlay-footer a:hover {
  color: var(--accent);
}

@media (max-width: 520px) {
  .help-overlay-grid {
    grid-template-columns: 1fr;
  }
}
```

### Step 4.3 — Import the overlay stylesheet

In `src/styles/main.css`, append a new import at the bottom:

```css
@import './_overlay.css';
```

Result:

```css
@import './_tokens.css';
@import './_reset.css';
@import './_animations.css';
@import './_header.css';
@import './_map.css';
@import './_panel.css';
@import './_timeline.css';
@import './_legend.css';
@import './_footer.css';
@import './_comparison.css';
@import './_responsive.css';
@import './_overlay.css';
```

### Step 4.4 — Create `src/controls/helpOverlay.js`

Full file contents:

```js
// Help overlay — native <dialog>, showing the keyboard shortcuts that
// already exist in src/controls/search.js. Opens via ? key (wired in
// search.js) or the header ? button (wired here). Esc and backdrop
// click close it for free via <dialog> semantics.

export function openHelpOverlay() {
  const dialog = document.getElementById('help-overlay');
  if (dialog && !dialog.open && typeof dialog.showModal === 'function') {
    dialog.showModal();
  }
}

export function closeHelpOverlay() {
  const dialog = document.getElementById('help-overlay');
  if (dialog && dialog.open) dialog.close();
}

export function initHelpOverlay() {
  const dialog = document.getElementById('help-overlay');
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
```

### Step 4.5 — Call `initHelpOverlay` from `src/main.js`

In `src/main.js`, add the import near the other control imports (around line 15):

```js
import { initHelpOverlay } from './controls/helpOverlay.js';
```

Then, inside `main()`, add the call alongside the other `init*` calls (the existing block around lines 72–81):

```js
// Wire up UI controls
initTheme();
buildScoreSelector();
initFilter();
initDimensionClicks();
initPanel();
initCitePopover();
initComparison();
initSearch();
initKeyboardNav();
initMapSubscriptions();
initHelpOverlay();   // ← add this line
```

### Step 4.6 — Wire the `?` key in `src/controls/search.js`

Open `src/controls/search.js` and find `initKeyboardNav` (currently starts around line 77). After the input-guard block (around line 86) and before the `/` / `Cmd+K` search-focus handler, add the `?` branch:

```js
export function initKeyboardNav() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        document.getElementById('search-suggestions').replaceChildren();
        updateSearchHighlight('');
      }
      return;
    }

    // ← add this block
    if (e.key === '?') {
      e.preventDefault();
      const dialog = document.getElementById('help-overlay');
      if (dialog && !dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
      return;
    }
    // ← end of new block

    if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      document.getElementById('country-search').focus();
      return;
    }

    // … rest unchanged
```

Leave everything below untouched.

### Step 4.7 — Verify

With the dev server still running:

1. **Key opens overlay:** press `?` anywhere outside a text input → dialog appears centered, backdrop dims the map behind.
2. **Key doesn't fire inside inputs:** focus the search input, type `?` → should insert the character, not open the overlay.
3. **Esc closes:** with the overlay open, press Esc → dialog closes.
4. **Backdrop click closes:** open, click outside the inner panel → closes.
5. **Close button works:** open, click the `×` button → closes.
6. **Header `?` button opens:** click the header `?` → opens the overlay.
7. **Focus trap:** open the overlay, press Tab repeatedly → focus cycles through close-button, then inner links — never escapes to the map / header. This is native `<dialog>` behavior; no extra code needed.
8. **Themes:** toggle to light theme → overlay backdrop reads as a soft dim, not opaque black; text readable. Toggle back to dark.
9. **Methodology link:** click "More detail in the methodology" → navigates to `/methodology.html`.
10. **Narrow viewport:** resize the browser to ~400px wide → the two-column grid collapses to one column.

### Step 4.8 — Commit

```bash
git add src/controls/helpOverlay.js src/styles/_overlay.css src/styles/main.css src/styles/_header.css index.html src/main.js src/controls/search.js
git commit -m "feat: ? help overlay listing keyboard shortcuts"
```

---

## Execution order

Tasks are independent except for the shared `<kbd>` styles added in Task 3 (used by Task 4). The order below serves commit hygiene, not hard dependencies:

1. **Task 1 — Copy normalizer.** Most isolated. If the weekend runs short, this alone is shippable.
2. **Task 2 — Source-count.** Tiny. Do it next so the freshness improvement lands early.
3. **Task 3 — Empty-panel on-ramp.** Adds the shared `<kbd>` styles used by Task 4.
4. **Task 4 — Help overlay.** Largest new surface; last.

Each commit is independently revertable in reverse order.

---

## Non-goals / explicitly deferred

- **Source-side copy fix.** Editing `scripts/regulation_pipeline/api.py` to change the LLM prompt and re-running the pipeline. That's path (A) from the brainstorm — its own plan, later. The display-layer normalizer is a holding pattern until the pipeline is retuned.
- **Full narrative scaffolding.** Scroll-driven landing page, editorial numbered sections à la trackpolicy.org. The methodology page already covers the reference-document side; the empty-panel on-ramp covers compressed orientation. Full scaffolding is acknowledged as future work but not this weekend.
- **Operational-freshness affordances.** Recent-activity feed, "what changed this month" ticker. These dilute the differentiator (durable structured comparison across 196 countries).
- **Per-field confidence.** Still record-level. Per the citability plan's deferred note.
- **New fonts, palette, animations.** Out of scope. Existing Literata + Geist + OKLCH tokens are already good.

---

## Success criteria

- Dev server loaded cold with no country selected → empty panel shows the Literata lede, three numbered steps (01 / 02 / 03), and the "Read the methodology →" link.
- Clicking any country → intro removed from the DOM, never returns for that page load.
- Pressing Esc after engagement → panel shows the quiet italic "Select a country to see details." — NOT the intro.
- Afghanistan, Angola, Antigua and Barbuda panels: descriptions no longer open with "as of [Month Year]"; cascading "No X" sentences collapsed to one.
- Feature flag `NORMALIZE_COPY = false` in `src/constants.js` restores the raw CSV text for A/B eyeballing.
- Country header's "Data as of …" line now includes source count (e.g. `· 3 sources`), with honest "no primary sources" fallback when empty.
- Existing three-tier confidence badge unchanged (already shipped).
- Pressing `?` outside an input → overlay opens. Esc / backdrop / close button all dismiss it. Works on both themes and at narrow widths.
- No new entries in `package.json`. No changes to `public/scores.csv`, `public/regulation_data.csv`, or `public/history.json`.
- Lighthouse accessibility score ≥ current baseline on both themes.

---

## Decisions (resolved during brainstorm)

1. **Copy path B (display-layer), not A (source).** Source fix deserves its own plan; mixing it into weekend polish is scope creep.
2. **Numbered on-ramp steps, not un-numbered.** Shipped first with numbers; if they read imposed ("her device pasted onto your site"), strip to three equal-weight lines in a follow-up.
3. **Header `?` now opens overlay, not direct-to-methodology.** Methodology reaches from footer, overlay footer, and empty-panel intro. Reversible if the UX regresses.
4. **Confidence-dot work dropped.** The three-tier confidence badge already shipped via citability Task 2.5 — verified in `src/styles/_panel.css:220-263`. Section 3 of the spec now covers source-count only.
