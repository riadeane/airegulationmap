# Citability & Resilience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Turn the AI Regulation Map from a nice visualization into a tool that policy researchers actually cite in working papers. Three additions, in order of importance:

1. **Shareable URLs** — every meaningful view (country, score dimension, comparison set, timeline date, theme) encodes to a query-string so a researcher can link a colleague directly.
2. **Methodology page + "Cite this" action** — a public rubric explaining the 1–5 scale, plus a one-tap action that copies a formatted citation (APA / Chicago) to the clipboard.
3. **Resilience basics** — loading skeleton, data-fetch error boundary, `<noscript>` fallback, and an accessible label for the map so screen readers announce "World map showing AI regulation scores for 196 countries" rather than nothing.

**Architecture:** Vanilla JS + D3 + Vite, as-is. No new dependencies. New modules go in `src/controls/url.js`, `src/controls/citation.js`, `src/panel/resilience.js`. The methodology content lives in a separate static `methodology.html` so it's printable and indexable. All three features reuse the existing state store (`src/state/store.js`) — the store's event bus is the seam we hang URL sync on.

**Tech Stack:** Vanilla JS, D3.js 7, TopoJSON, Vite, OKLCH tokens.

**Design principles to honor throughout:**
- Principle 4 (Citeable by default) — these three features together deliver it
- Principle 2 (Rigor over ornament) — no new chrome; reuse existing components
- Principle 5 (Calm density) — methodology page is a reference document, not a marketing page

---

## Task 1: Shareable URLs (permalinks)

**Files:**
- Create: `src/controls/url.js`
- Modify: `src/main.js`, `src/state/store.js` (add `timelineDate` key if missing)

### Step 1.1 — Define the URL schema

Query parameters (all optional):

| Param | Maps to state key | Example | Notes |
|---|---|---|---|
| `country` | `selectedCountry` | `?country=Germany` | ISO-3 or full name. Prefer full canonical name for readability. URL-encoded. |
| `mode` | `currentAttribute` | `?mode=enforcementLevel` | One of the six attribute keys. |
| `compare` | `comparisonCountries` | `?compare=Germany,France,Japan` | Comma-separated, URL-encoded. |
| `date` | `timelineDate` | `?date=2025-09-01` | ISO date; if absent, use latest. |
| `theme` | `data-theme` attribute | `?theme=light` | `light` or `dark`. |

Design notes:
- Use full canonical country names (what the CSV uses) rather than ISO codes. Simplifies lookup; readable to humans.
- Omit params whose values equal defaults so URLs stay short: no `?mode=averageScore` when it's already the default.
- The `theme` param wins over `localStorage`, which wins over `prefers-color-scheme`. Explicit > stored > system.

### Step 1.2 — Create `src/controls/url.js`

Exports:

```js
export function parseUrl() → { country, mode, compare, date, theme }
export function initUrlSync() → void   // call once from main.js after other init
```

`parseUrl()`:
- Reads `window.location.search`
- Returns a plain object with only the keys that were present (absent keys are undefined — lets callers decide defaults)
- Validates `mode` against `SCORE_OPTIONS` from `constants.js`; drops if unknown
- Validates `theme` against `light`/`dark`
- Splits `compare` on `,`, trims, caps at `MAX_COMPARISON` (4), filters out empties

`initUrlSync()`:
- Subscribes to state changes (`on('selectedCountry', …)`, `on('currentAttribute', …)`, `on('comparisonCountries', …)`, `on('timelineDate', …)`) and writes the next URL via `history.replaceState(null, '', newUrl)`.
- Subscribes to the theme MutationObserver the same way (re-use `onThemeChange` from `src/map/cssColors.js` — export it if not already; the current file exports it already).
- Listens to `popstate` so back/forward navigation restores state: parses the URL on each popstate and calls `setState` / `setAttribute('data-theme', …)` accordingly.

Use `replaceState` for normal changes (don't spam history on every hover-click). Use `pushState` only for the user-initiated theme toggle — it's the one navigation-like action worth reversing with Back.

### Step 1.3 — Wire it in `src/main.js`

Apply URL state **after** `loadScores`/`loadRegulation` resolve (so country-name validation works against real data) but **before** `generateMap` runs (so the first render uses the correct `currentAttribute`).

```js
async function main() {
  const [scoreData, regulationData] = await Promise.all([loadScores(), loadRegulation()]);
  const sortedCountryNames = Object.keys(scoreData).sort();
  setState({ scoreData, regulationData, sortedCountryNames });

  // Apply URL state BEFORE first render.
  const urlState = parseUrl();
  if (urlState.theme) document.documentElement.setAttribute('data-theme', urlState.theme);
  if (urlState.mode)  setState({ currentAttribute: urlState.mode });
  if (urlState.date)  setState({ timelineDate: urlState.date });

  initTheme();
  buildScoreSelector();
  initFilter();
  initDimensionClicks();
  initPanel();
  initComparison();
  initSearch();
  initKeyboardNav();
  initMapSubscriptions();
  await generateMap();

  // Selected country / comparison need the map to exist first so the
  // highlight fires correctly. Apply after generateMap resolves.
  if (urlState.compare?.length >= 1) {
    setState({ comparisonCountries: urlState.compare });
  } else if (urlState.country) {
    setState({ selectedCountry: urlState.country });
  }

  updateSiteLastUpdated(scoreData);
  updateCountryCount(scoreData);
  loadHistory().then(history => initTimeline(history));

  // Hang URL writes on state-change events.
  initUrlSync();

  document.addEventListener('click', closeAllDropdowns);
}
```

### Step 1.4 — Handle timeline date

The timeline module sets `timelineDate` in state somewhere. Verify by reading `src/controls/timeline.js`. If `timelineDate` isn't in the store yet, add it to the initial state object in `src/state/store.js` (default `null` meaning "latest"). Make sure the timeline slider also reads `timelineDate` on init so a URL-provided date lands the slider at the right position.

### Edge cases to handle explicitly
- Unknown country name in URL (typo, deleted from data): ignore silently rather than error. URL already in address bar; don't fight the user.
- `compare` param contains the same country twice: dedupe.
- Theme param flicker: the existing pre-paint script in `index.html` reads localStorage. Add a URL-check before that:
  ```js
  var urlTheme = new URLSearchParams(location.search).get('theme');
  if (urlTheme === 'light' || urlTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', urlTheme);
  } else {
    /* existing localStorage path */
  }
  ```
- Very long `compare` URLs from power users: trust the `MAX_COMPARISON` cap; anything over gets truncated.
- Decode URI components on parse, encode on write.

### Verification
- Load `/?country=Germany` → panel opens on Germany
- Load `/?compare=Germany,France&mode=enforcementLevel` → comparison panel up with two countries, map in enforcement mode
- Click around — URL updates live without full navigation
- Back/forward buttons restore prior state
- `/?theme=light` and `/?theme=dark` flip theme before first paint (no FOUC)

---

## Task 2: Methodology page + "Cite this" action

**Files:**
- Create: `methodology.html` (standalone HTML page, served from root by Vite)
- Create: `src/controls/citation.js`
- Modify: `index.html` (add "Methodology" link in footer), `src/panel/index.js` (add Cite this button), `src/styles/_panel.css` (button styling)

### Step 2.1 — Create `methodology.html`

Standalone HTML (not a SPA route — this is a reference document that should be printable, linkable, and indexable). Layout mirrors the main app's header and footer for consistency but drops the map/panel.

Content sections:
1. **Introduction** — What the site is, who it's for, the epistemic caveat (scores are inferred by Claude from public sources and updated monthly).
2. **The six dimensions** — one subsection per dimension. For each: one-paragraph definition + the 1–5 rubric with one concrete example per level (e.g. `Enforcement Level 5: existing authority has issued fines or initiated enforcement actions; e.g. Italy's GDPR-via-Garante AI enforcement`).
3. **Confidence levels** — how "high / medium / low confidence" are assigned.
4. **Data update cadence** — GitHub Action runs monthly; manual overrides possible; history snapshots preserved in `history.json`.
5. **Known limitations** — scores reflect a specific point in time; non-English sources under-represented; aggregate scores hide regional variance.
6. **Citing this site** — suggested APA / Chicago / MLA formats, with the permalink caveat.
7. **Source code & contact** — GitHub link, author, license.

Use the same tokens and stylesheet structure as the main app (import `./src/styles/main.css` or a tailored subset). Reuse `<header>` and `<footer>` HTML shapes.

Add `<link rel="canonical" href="https://airegulationmap.org/methodology">` and proper OpenGraph tags.

### Step 2.2 — Add "Methodology" entry points

In `index.html` footer, add a new link:

```html
<p>Methodology: <a href="/methodology.html">How countries are scored</a></p>
```

Also add a small `?` info icon next to the site title in the header that links to `/methodology.html`. Sparing use — don't crowd the header.

### Step 2.3 — Create `src/controls/citation.js`

```js
// Produces formatted citation strings for the currently-selected
// country or comparison view. All formats link to the permalink so
// a reader can reproduce the exact view the researcher saw.

export function citationsFor({ country, mode, date, url }) {
  const accessed = new Date().toISOString().slice(0, 10);
  const year = (date || accessed).slice(0, 4);
  const base = `Deane, R. (${year}). AI Regulation Map`;
  const view = country ? ` — ${country}` : '';
  const modeBit = mode && mode !== 'averageScore' ? ` (${humanize(mode)})` : '';

  return {
    apa:     `${base}${view}${modeBit}. Retrieved ${accessed}, from ${url}`,
    chicago: `Deane, Ria. "AI Regulation Map${view}${modeBit}." Accessed ${accessed}. ${url}.`,
    mla:     `Deane, Ria. "AI Regulation Map${view}${modeBit}." AI Regulation Map, ${url}. Accessed ${accessed}.`,
  };
}
```

`humanize()` maps the internal attribute key to a human phrase — reuse `ATTRIBUTE_LABELS` from `constants.js`.

The "url" input is generated by calling into a small helper in `url.js`: `buildPermalink(state) → string`.

### Step 2.4 — Add the "Cite this" button to the country panel

In `index.html`, extend `.panel-country-header` with a second button alongside `+ Compare`:

```html
<div class="panel-header-actions">
  <button id="compare-btn" class="compare-btn" type="button">+ Compare</button>
  <button id="cite-btn" class="cite-btn" type="button" aria-haspopup="dialog">Cite</button>
</div>
```

Clicking "Cite" opens a small popover anchored under the button (NOT a modal — modals are lazy per the skill's guidance). The popover shows three format options (APA, Chicago, MLA) with "Copy" buttons. Each format is a `<code>` block. Copy uses `navigator.clipboard.writeText(...)`. Confirmation: the button text briefly flips to "Copied ✓" for 1.5s.

### Step 2.5 — Add per-field confidence (optional, higher-effort)

Currently `regulation_data.csv` has a `confidence` column but it's record-level (one value per country). Enhancing to per-field confidence requires data-model changes in the Python pipeline.

**Lower-effort compromise for this plan:** surface the existing record-level confidence more prominently. Change the current "Low confidence" badge (only shown when low) to always show:
- High: small `●` in text-tertiary tone (near-invisible — "nothing to see")
- Medium: small `●` in amber
- Low: "LOW CONFIDENCE" badge as today

Defer true per-field confidence to a later plan; note it in the methodology page as a known limitation.

### Edge cases to handle
- Clipboard API unavailable (rare, e.g. non-HTTPS preview): fall back to a `<textarea>` + `document.execCommand('copy')` or just show the text with a "Select all" hint.
- User cites while `comparisonCountries.length >= 1`: use the comparison URL and citation title like `"AI Regulation Map — Germany, France comparison"`.
- URL is very long (4 countries + mode): citation still works, just the string is long. No fix needed.

### Verification
- Click Cite on Germany → popover shows three formats → click Copy APA → paste into a notepad → full string including permalink.
- Navigate to `/methodology.html` → no console errors → fonts match main app → print preview shows A4-ready page with no JS required.
- Methodology header links back to map via the site title.

---

## Task 3: Resilience basics

**Files:**
- Create: `src/panel/resilience.js` (tiny — loading + error state helpers)
- Modify: `src/main.js`, `index.html`, `src/styles/_map.css` (skeleton styles), `src/map/renderer.js` (aria-label on SVG)

### Step 3.1 — Skeleton loading state

Before the JSON files and TopoJSON resolve, the app currently paints the shell (header, empty map div, empty panel). Add a skeleton to the map area:

```html
<div id="map">
  <div id="map-skeleton" aria-hidden="true">
    <div class="map-skeleton-shimmer"></div>
  </div>
</div>
```

Skeleton is a muted rectangle with a slow left-to-right shimmer gradient (one `@keyframes` in `_animations.css`, running at ~2s linear). When `generateMap()` completes, remove `#map-skeleton`.

### Step 3.2 — Error boundary for data fetches

Wrap the top of `main()`:

```js
async function main() {
  try {
    const [scoreData, regulationData] = await Promise.all([
      loadScores(),
      loadRegulation(),
    ]);
    // … rest of existing body
  } catch (err) {
    console.error('[main] data load failed', err);
    showLoadError(err);
    return;
  }
}
```

`showLoadError(err)` lives in `src/panel/resilience.js` and replaces the map area with:

```
Couldn't load the regulation data.
[Retry] — reloads the page
Last known good copy from [YYYY-MM-DD] available in the GitHub mirror.
```

Keep the header, footer, and theme toggle operational so the page doesn't look dead.

### Step 3.3 — `<noscript>` fallback

In `index.html`, add inside `<body>`:

```html
<noscript>
  <div class="noscript-fallback">
    <h1>AI Regulation Map</h1>
    <p>This site requires JavaScript to render the interactive map. You can view the underlying data at
      <a href="https://github.com/riadeane/airegulationmap/blob/main/public/regulation_data.csv">GitHub</a>
      or read the <a href="/methodology.html">methodology page</a>, which works without JavaScript.</p>
  </div>
</noscript>
```

Style lightly in `_reset.css` so it inherits the current theme's colors.

### Step 3.4 — Accessible label for the map

In `src/map/renderer.js`, on SVG creation:

```js
const svg = select('#map')
  .append('svg')
  .attr('role', 'img')
  .attr('aria-label', 'World map showing AI regulation scores by country. Click a country for details; use arrow keys to move between countries.')
  .attr('width', size.w)
  .attr('height', size.h);
```

Also add a `<title>` element inside the SVG (screen readers prefer it to aria-label in some cases):

```js
svg.append('title').text('World map showing AI regulation scores by country');
```

Add an sr-only live region so screen readers announce when the user changes the score mode:

```html
<div class="sr-only" role="status" aria-live="polite" id="map-live-region"></div>
```

When `currentAttribute` changes, update this region's text: `"Map now showing ${humanize(attr)}. Legend ranges from ${low} to ${high}."`.

### Step 3.5 — Reduced-motion honor for skeleton

Skeleton shimmer is an animation; the existing global `prefers-reduced-motion` reset in `_reset.css` already neutralizes it. Verify it still looks reasonable as a static muted rectangle with no shimmer — if not, add a `prefers-reduced-motion` override that swaps to a quiet "Loading…" text label.

### Edge cases to handle
- CSV loads but is empty: treat same as error? Or show "No data available for the selected date"? Use the latter — it's a valid state during timeline scrubbing to a very early date.
- `countries-110m.json` fetch fails: specific error message ("Map tiles unavailable") since the CSV could still drive a table view.
- Slow 3G: skeleton stays for several seconds; verify it doesn't look broken.
- Screen reader on the zoom controls: their aria-labels exist already (zoom.js sets `aria-label="Zoom in"` etc.). No change.

### Verification
- Disable network → reload → error state renders with Retry.
- Throttle to Slow 3G → skeleton visible for ~2s → map resolves.
- Disable JavaScript in browser → noscript message appears with working links.
- VoiceOver / NVDA: navigate the page → hear "world map showing AI regulation" on the SVG landmark.
- Switch score dimensions → hear the live region announce the new mode.

---

## Execution order

Tasks are mostly independent, but there's one real dependency:

1. **Task 1 (URLs) first.** Task 2's citation generator needs `buildPermalink(state)` from `url.js`. Task 3's error state benefits from being URL-aware ("retry" should preserve the view the user was trying to reach).
2. **Task 3 (Resilience) second.** Quick wins. Unblocks shipping because it improves the first-load experience everyone sees.
3. **Task 2 (Methodology + Cite) last.** The methodology page content is substantive writing; it may warrant more review time than the code work.

A reasonable cadence:
- Day 1: Task 1 end-to-end, including tests with real URLs shared around.
- Day 2: Task 3 skeleton + error state + noscript + aria-label.
- Day 3–4: Task 2 code (citation popover + per-field confidence surfacing).
- Day 5: Task 2 methodology page content (this is writing, not coding).

---

## Non-goals / explicitly deferred

- **True per-field confidence** in the data model. Surface the record-level field better; defer real per-field to a future plan that touches the Python pipeline.
- **Permalink shortening / named slugs.** Long URLs are fine; researchers copy them wholesale anyway.
- **Server-side rendering or static export of every country page.** Nice for SEO but a separate project.
- **User accounts / saved comparisons.** Permalinks cover the 90% case.
- **Internationalization.** Not until traction proves demand.

---

## Success criteria

- A researcher can share a URL like `/?country=Germany&mode=enforcementLevel` and the recipient lands on that exact view in one click.
- A researcher can cite the site in a footnote using the generated APA/Chicago string, and the methodology URL is stable.
- Initial page load on Slow 3G shows a skeleton rather than a blank map; a simulated data-fetch failure shows an actionable error.
- `aXe` / Lighthouse accessibility audit reports no new violations; screen reader announces the map's purpose on focus.
- No new runtime dependencies added to `package.json`.

---

## Decisions (resolved 2026-04-17)

1. **Citation attribution**: `Deane, Ria`. Use full first name in all formats (APA pattern `Deane, R.` is the one exception — follow standard APA convention there).
2. **Methodology drafting**: Claude drafts the rubric from the existing Python prompt template at `scripts/regulation_pipeline/api.py`. Ria reviews and edits before publish. Keep the draft honest about its epistemic status: scores are LLM-inferred from public sources, not human-coded.
3. **OG image**: Single site-level static image only. Per-country generation is out of scope. Verify `og-image.png` actually exists in `public/`; if missing, generate a simple one from the site-level hero (plain dark background, "AI Regulation Map" title, URL, subtitle like "Mapping AI governance across 196 countries").
4. **URL form**: Readable — `?country=Germany&mode=enforcementLevel&compare=Germany,France` etc. Full canonical country names, full attribute keys, comma-separated compare list. No short slugs.
