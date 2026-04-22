# Polish & On-ramp — Design Spec

> Sibling to `docs/plans/2026-04-17-citability-and-resilience.md` (already shipped). Does not duplicate.

**Date:** 2026-04-17
**Status:** Design approved, pending plan generation

## Goal

A weekend-scoped polish pass addressing four gaps in the current app:

1. Copy quality on LLM-generated country descriptions — display-layer fix
2. Narrative scaffolding / first-visit on-ramp — compressed form, not a full landing page
3. Freshness and authority signals — surface existing data, don't add new data
4. `?` keyboard shortcut help overlay — expose shortcuts already wired

## Out of scope

- Source-side copy fix (editing `scripts/regulation_pipeline/api.py`, re-running the pipeline, reviewing 196 outputs). Separate plan, later. Design reference: path (A) in brainstorm.
- Full narrative scaffolding (scroll-driven homepage, editorial numbered sections à la trackpolicy.org). Acknowledged as highest-leverage future move; methodology page already covers the reference-document side.
- Operational-freshness affordances: recent-activity feed, "what changed this month" ticker, temporal-activity spine. These dilute the differentiator (durable structured comparison across 196 countries).
- New fonts, palette, animations. Framework migration.
- Per-field confidence. Still record-level, per the citability plan's deferred note.

## Design principles (carried from `.impeccable.md`)

1. **The map is the protagonist.** New UI recedes or only appears when no country is selected.
2. **Rigor over ornament.** Every change surfaces existing information, not decoration.
3. **Citeable by default.** Freshness signals are honest, including "no sources" states.
4. **Calm density.** The on-ramp uses typographic hierarchy, not color or iconography.

## Architecture

Vanilla JS + D3 + Vite, no new dependencies. State store (`src/state/store.js`) unchanged. URL-sync behavior unchanged. No data file changes.

### Files

| Feature | New | Modified |
|---|---|---|
| Copy normalizer | `src/panel/normalize.js` | `src/panel/sections.js`, `src/constants.js` |
| Empty-panel on-ramp | — | `index.html`, `src/styles/_panel.css`, `src/panel/index.js` |
| Freshness signals | — | `src/panel/index.js` |
| Help overlay | `src/controls/helpOverlay.js`, `src/styles/_overlay.css` | `index.html`, `src/controls/search.js`, `src/styles/main.css`, `src/styles/_reset.css` (shared `<kbd>` base) |

---

## 1. Copy normalizer

**Problem:** LLM-generated descriptions in `public/regulation_data.csv` have repetitive patterns — "as of April 2026" leads, cascading "No X / No Y / No Z exists" constructions, standalone hedges. Reads stiff.

**Approach:** a small normalizer at display time. CSV data is untouched.

### Module — `src/panel/normalize.js`

Export a single function:

```js
export function normalizeRegulationText(text) → string | null
```

Applied inside `cleanRegulationText` in `src/panel/sections.js`, after existing placeholder and short-hedge checks, before returning to the render path.

### Transformations

Three conservative passes, applied in order:

1. **Strip leading temporal anchor.** If the substring `as of (January|February|...|December) \d{4}` appears within the first 80 chars AND at least one more sentence of content follows, remove it and the surrounding spaces/commas. Preserves trailing "as of …" which often carries genuine temporal framing mid-paragraph.
2. **Collapse cascading negations.** When three or more consecutive sentences each open with `No ` (case-sensitive, capital N after sentence boundary), AND their remaining tokens overlap by ≥2 non-stopword tokens (heuristic: shared vocabulary signals redundant claims), collapse to a single sentence: `"No AI-specific legislation, governance body, or enforcement mechanism exists."` — joining the subject nouns from each original sentence. When tails diverge (distinct claims), skip.
3. **Trim leading hedges.** Strip standalone `Generally,`, `Broadly,`, `Notably,` at sentence start.

### Safety rail

If `output.length < input.length * 0.6` OR `output.trim() === ''`, return the original input unchanged. Guards against regex catastrophe on unusual text shapes.

### Feature flag

In `src/constants.js`:

```js
export const NORMALIZE_COPY = true;
```

`normalizeRegulationText` early-returns when flag is false. Allows A/B inspection without a rebuild.

### Verification

Eyeball 10 countries across confidence tiers in the dev server:

- Afghanistan, Algeria, Angola, Antigua and Barbuda (heavy "No X" cascades)
- Argentina, Germany, France (substantive content, check for over-normalization)
- Singapore, Kenya, Bolivia (mid-register)
- Belarus (edge case: potentially unusual structure)

For each: confirm text is shorter or equal, reads cleaner, retains factual content. No unit tests — eyeball is faster for a weekend's worth of regex.

---

## 2. Empty-panel on-ramp

**Problem:** First-time visitors land on the map with no orientation. The current `#no-selection-message` is one line: "Select a country to see details." Plus a tip about Shift-click. Neither teaches what the site is.

**Approach:** a compressed narrative block in the country panel that only appears on first load. Borrows the numbered-section device from trackpolicy.org at small scale, without requiring a scroll-driven layout. Removed permanently on first engagement.

### Markup — `index.html`

The current markup is a single `<p id="no-selection-message">` inside `#country-panel` before `#panel-content`. Remove it and add two siblings in its place — the rich intro (visible) and a hidden simple one-liner for the deselected-after-engagement case:

```html
<div id="panel-intro" class="panel-intro">
  <p class="panel-intro-lede">Global AI governance across 196 countries, scored on six dimensions.</p>
  <ol class="panel-intro-steps">
    <li><span class="panel-intro-num">01</span> Click a country to read its regulatory posture.</li>
    <li><span class="panel-intro-num">02</span> Shift-click to compare up to four.</li>
    <li><span class="panel-intro-num">03</span> Press <kbd>?</kbd> for keyboard shortcuts.</li>
  </ol>
  <a class="panel-intro-methodology" href="/methodology.html">Read the methodology →</a>
</div>
<p id="no-selection-message" class="no-selection-message" hidden>Select a country to see details.</p>
```

Both elements sit in the same parent (`#country-panel`), one visible and one hidden at initial render. The state transition below swaps them.

### Styles — `src/styles/_panel.css`

| Selector | Properties |
|---|---|
| `.panel-intro` | Padding matches existing `#no-selection-message`, max-width for readability |
| `.panel-intro-lede` | Literata, ~1.15–1.2rem, line-height ~1.35, `--text-primary`, margin-bottom 1.5em |
| `.panel-intro-steps` | No default list markers; vertical gap between items |
| `.panel-intro-num` | Geist Mono, `--text-tertiary`, tabular-nums, fixed-width gutter |
| `.panel-intro-steps li` | Sans, `--text-secondary`, line-height 1.5 |
| `.panel-intro-methodology` | Quiet link, `--accent` on hover, small arrow |

### State transition — `src/panel/index.js`

Add a subscription (or extend an existing one) that runs once:

```js
let introConsumed = false;
function maybeConsumeIntro() {
  if (introConsumed) return;
  const { selectedCountry, comparisonCountries } = getState();
  if (selectedCountry || (comparisonCountries && comparisonCountries.length > 0)) {
    introConsumed = true;
    const intro = document.getElementById('panel-intro');
    if (intro) intro.remove();
    const fallback = document.getElementById('no-selection-message');
    if (fallback) fallback.hidden = false;
  }
}
on('selectedCountry', maybeConsumeIntro);
on('comparisonCountries', maybeConsumeIntro);
```

After first engagement, subsequent deselect shows the plain one-liner. The intro is once-per-page-load. No localStorage — users who reload get the intro back, which is fine.

---

## 3. Freshness / authority signals

**What already ships:** always-visible three-tier confidence badge (see `src/panel/index.js:77-92` and `src/styles/_panel.css:220-263`). High reads quiet at opacity 0.65, medium amber, low loud-accent. The Task 2.5 compromise from the citability plan did land.

**What's still missing:** source count inline with the date. A researcher currently sees `"Data as of 2026-04-01"` with no signal for how many primary sources back the entry. Surfacing the count is honest about the data's provenance.

**Approach:** extend the existing `#last-updated` render in `src/panel/index.js`. The `regulationData[country].sources` field is pipe-separated URLs; count them, append to the date line.

Behavior:

```js
// Inside renderPanel, after computing dateStr:
const urls = reg?.sources
  ? reg.sources.split('|').map(u => u.trim()).filter(Boolean)
  : [];
const countText = urls.length > 0
  ? `${urls.length} source${urls.length === 1 ? '' : 's'}`
  : 'no primary sources';
const dateLine = dateStr ? `Data as of ${dateStr} · ${countText}` : countText;
document.getElementById('last-updated').textContent = dateLine;
```

When zero sources, the line reads "no primary sources" — honest rather than hidden. The existing `renderTextSections` render in `src/panel/sections.js` parses the same URL list for chip rendering; a minor shared-parse refactor is optional but not required for correctness (they're cheap to compute twice).

No CSS changes required — `.data-freshness` already renders the line in the right style. Nothing else is added here; the three-tier confidence treatment stays as-is.

---

## 4. Help overlay

**Problem:** Keyboard shortcuts (`/`, `⌘K`, arrows, `Esc`, Shift-click) are wired but undiscoverable. No reference for first-time users.

**Approach:** a native `<dialog>` overlay listing every shortcut, opened by the `?` key or the header `?` icon.

### Module — `src/controls/helpOverlay.js`

```js
export function initHelpOverlay() {
  const dialog = document.getElementById('help-overlay');
  if (!dialog) return;
  document.getElementById('help-overlay-close')
    ?.addEventListener('click', () => dialog.close());
  document.getElementById('header-help-btn')
    ?.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // backdrop click
  });
}
export function openHelpOverlay() {
  const d = document.getElementById('help-overlay');
  if (d && !d.open) d.showModal();
}
```

Called from `src/main.js` alongside other `init*` calls.

### Markup — `index.html`

Change the existing header link:

```html
<button
  id="header-help-btn"
  class="header-help-btn"
  type="button"
  aria-label="Keyboard shortcuts and help"
  title="Keyboard shortcuts"
>?</button>
```

Add the dialog just before `</body>`:

```html
<dialog id="help-overlay" class="help-overlay" aria-label="Keyboard shortcuts and help">
  <div class="help-overlay-inner">
    <button id="help-overlay-close" class="help-overlay-close" type="button" aria-label="Close">×</button>
    <h2 class="help-overlay-title">Keyboard shortcuts</h2>
    <div class="help-overlay-grid">
      <dl>
        <dt><kbd>/</kbd> or <kbd>⌘</kbd><kbd>K</kbd></dt><dd>Focus search</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Step through countries</dd>
        <dt><kbd>?</kbd></dt><dd>This menu</dd>
      </dl>
      <dl>
        <dt>Click</dt><dd>Select country</dd>
        <dt>Shift+click</dt><dd>Add to comparison</dd>
        <dt><kbd>Esc</kbd></dt><dd>Close / deselect</dd>
      </dl>
    </div>
    <p class="help-overlay-footer">More detail in the <a href="/methodology.html">methodology</a>.</p>
  </div>
</dialog>
```

### Styles

Base `<kbd>` styles live in `src/styles/_reset.css` so they're shared by both the help overlay and the empty-panel intro (which uses `<kbd>?</kbd>`). Shape: small monospace pill, `--surface-raised` background, `--border-subtle` outline, `--radius-sm`, `font-family: 'Geist Mono'`, ~0.8em, tabular numerics. Works against any theme.

Overlay-specific styles in `src/styles/_overlay.css`, imported from `src/styles/main.css`:

- `.help-overlay` — native dialog reset (remove default border/padding), `--surface` background, `--border`, `--radius` matching other panels, max-width ~480px
- `.help-overlay::backdrop` — dim overlay (e.g. `rgb(0 0 0 / 0.4)`), respecting theme
- `.help-overlay-inner` — padding, typography
- `.help-overlay-grid` — CSS grid, two columns, collapse to one on narrow
- `.help-overlay-close` — top-right absolute, subtle

### Key binding

In `src/controls/search.js`, inside `initKeyboardNav`, before the ArrowLeft/ArrowRight handler:

```js
if (e.key === '?') {
  e.preventDefault();
  document.getElementById('help-overlay').showModal();
  return;
}
```

Match the existing guard that skips when `e.target` is input/textarea.

### Decision recorded: header `?` behavior

The header `?` icon currently links directly to `/methodology.html`. After this change, it opens the overlay instead. Methodology remains reachable via:

- Footer link
- Overlay footer ("More detail in the methodology")
- Empty-panel intro ("Read the methodology →")

Rationale: one affordance for help (overlay), one page for the deep reference (methodology). If this feels like a regression once live, revert this specific line.

### Accessibility

Native `<dialog>` provides focus trap, Esc-to-close, and `::backdrop` for free. Explicit close button for users who don't know Esc. `aria-label` on the dialog. Semantic `<kbd>` elements.

---

## Build sequence

Four independently-revertable commits, in this order:

1. **Copy normalizer.** Most isolated. Can ship even if the others slip.
2. **Source-count in date line.** A handful of JS lines in `src/panel/index.js`. Zero CSS, zero new markup.
3. **Empty-panel on-ramp.** Pure markup + CSS + one store subscription.
4. **Help overlay.** Biggest new surface; last so it doesn't block earlier wins.

Each commit is verifiable in the dev server before moving on.

## Success criteria

- Dev server loaded cold → intro visible in the empty panel → three numbered steps legible → methodology link present.
- Click any country → intro removed from DOM → never returns for this page load.
- Afghanistan, Angola, Antigua panels: descriptions no longer open with "as of [Month Year]"; cascading "No X" sentences collapsed to one.
- Country header's `Data as of <date>` line now includes inline source count (e.g. `· 3 sources`), with honest "no primary sources" fallback when empty. Existing three-tier confidence badge unchanged.
- Press `?` on any page state (outside inputs) → overlay opens → tab-cycles stay inside → Esc closes → backdrop click closes.
- No new entries in `package.json`.
- Lighthouse accessibility score ≥ current baseline on both themes.

## Open decisions (captured from brainstorm)

1. **Numbered vs. unnumbered on-ramp.** Ship numbered first. If it reads imposed ("narrative device from her site pasted onto yours"), strip to three equal-weight short lines. Evaluated after the commit lands.
2. **Header `?` behavior change.** Now opens overlay instead of linking to methodology. Reverted to direct-to-methodology if the UX feels like a regression.
