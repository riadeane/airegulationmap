# UI/UX Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the AI Regulation Map into a professional dark-dashboard experience with a two-column layout, structured country panel, custom controls, and a gray-to-amber choropleth.

**Architecture:** Full-viewport dark layout — slim sticky header, side-by-side map+panel, timeline strip below. No build step: pure edits to `index.html`, `style.css`, and `map.js`. CSS custom properties drive the color system. No Tailwind — CSS custom properties give equivalent power without a CDN dependency or build step.

**Tech Stack:** Vanilla JS, D3.js 7, TopoJSON, Inter font (Google CDN)

---

## Task 1: Restructure index.html

**Files:**
- Modify: `index.html`

**Step 1: Replace the entire file with the new structure**

Replace `index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Regulation Map</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js"></script>
  <link rel='stylesheet' type='text/css' media='screen' href='style.css'>
</head>
<body>
  <header id="app-header">
    <div class="header-left">
      <h1>AI Regulation Map</h1>
      <span class="header-subtitle">Last updated: <span id="site-last-updated">—</span></span>
    </div>
    <div class="header-right">
      <div id="search-container">
        <input
          type="text"
          id="country-search"
          placeholder="Search countries..."
          autocomplete="off"
          aria-label="Search for a country"
          aria-autocomplete="list"
          aria-controls="search-suggestions"
        />
        <ul id="search-suggestions" role="listbox" aria-label="Country suggestions"></ul>
      </div>
      <div id="score-btn-container">
        <button id="score-btn" aria-haspopup="listbox" aria-expanded="false">
          <span id="score-btn-label">Average Score</span>
          <span class="caret">▾</span>
        </button>
        <ul id="score-dropdown" role="listbox" aria-label="Score type"></ul>
      </div>
      <div id="filter-btn-container">
        <button id="filter-btn" aria-haspopup="true" aria-expanded="false">
          Filter <span class="caret">▾</span>
        </button>
        <div id="filter-popover">
          <div class="filter-row">
            <span class="filter-label">Min</span>
            <input type="range" id="filter-min" min="1" max="5" step="0.25" value="1" aria-label="Minimum score">
            <span id="filter-min-label">1</span>
          </div>
          <div class="filter-row">
            <span class="filter-label">Max</span>
            <input type="range" id="filter-max" min="1" max="5" step="0.25" value="5" aria-label="Maximum score">
            <span id="filter-max-label">5</span>
          </div>
        </div>
      </div>
    </div>
  </header>

  <main id="app-main">
    <div id="map-wrapper">
      <div id="map"></div>
      <div id="zoom-controls"></div>
    </div>
    <aside id="country-panel">
      <p id="no-selection-message">Select a country to see details</p>
      <div id="panel-content" style="display:none">
        <div class="panel-country-header">
          <div class="panel-name-row">
            <span id="country-name"></span>
            <span id="confidence-badge" class="confidence-badge"></span>
          </div>
          <small id="last-updated" class="data-freshness"></small>
        </div>
        <div class="panel-section">
          <div class="panel-section-label">OVERALL SCORE</div>
          <div class="score-bar-row">
            <div class="score-bar-track">
              <div class="score-bar-fill" id="overall-bar-fill"></div>
            </div>
            <span class="score-value" id="average-score"></span>
          </div>
        </div>
        <div class="panel-section">
          <div class="panel-section-label">DIMENSIONS</div>
          <div class="dimensions-list">
            <div class="dimension-row">
              <span class="dim-label">Regulation Status</span>
              <span class="dim-dots" id="dots-regulation"></span>
            </div>
            <div class="dimension-row">
              <span class="dim-label">Policy Lever</span>
              <span class="dim-dots" id="dots-policy"></span>
            </div>
            <div class="dimension-row">
              <span class="dim-label">Governance Type</span>
              <span class="dim-dots" id="dots-governance"></span>
            </div>
            <div class="dimension-row">
              <span class="dim-label">Actor Involvement</span>
              <span class="dim-dots" id="dots-actors"></span>
            </div>
            <div class="dimension-row">
              <span class="dim-label">Enforcement Level</span>
              <span class="dim-dots" id="dots-enforcement"></span>
            </div>
          </div>
        </div>
        <div class="panel-section" id="regulation-section">
          <div class="panel-section-label">REGULATION STATUS</div>
          <p id="regulation-details"></p>
        </div>
        <div class="panel-section" id="policy-section">
          <div class="panel-section-label">POLICY LEVER</div>
          <p id="policy-details"></p>
        </div>
        <div class="panel-section" id="governance-section">
          <div class="panel-section-label">GOVERNANCE TYPE</div>
          <p id="governance-details"></p>
        </div>
        <div class="panel-section" id="actors-section">
          <div class="panel-section-label">ACTOR INVOLVEMENT</div>
          <p id="actors-details"></p>
        </div>
        <div class="panel-section" id="enforcement-section">
          <div class="panel-section-label">ENFORCEMENT LEVEL</div>
          <p id="enforcement-details"></p>
        </div>
        <div class="panel-section" id="laws-section">
          <div class="panel-section-label">KEY LEGISLATION</div>
          <p id="specific-laws"></p>
        </div>
        <div class="panel-section" id="sources-section">
          <div class="panel-section-label">SOURCES</div>
          <ul id="sources-list"></ul>
        </div>
      </div>
    </aside>
  </main>

  <div id="timeline-strip" style="display:none">
    <div id="timeline-inner">
      <button id="timeline-reset" title="Jump to latest">&#x21BA;</button>
      <input type="range" id="timeline-slider" min="0" max="0" step="1" value="0" aria-label="Timeline date slider">
      <span id="timeline-date-label">Latest</span>
    </div>
  </div>

  <footer>
    <p>Data sourced from the <a href="https://forum.effectivealtruism.org/posts/8tJbcAXDZKEqQXgyR/ai-governance-tracker-of-each-country-per-region" target="_blank" rel="noopener noreferrer">EA AI Governance Tracker</a>. Scores assigned by <a href="https://claude.ai/" target="_blank" rel="noopener noreferrer">Claude</a>. Updated monthly.</p>
    <p>Made by Ria Deane &nbsp;&middot;&nbsp;
      <a href="https://www.linkedin.com/in/riadeane" target="_blank" rel="noopener noreferrer">LinkedIn</a> &nbsp;&middot;&nbsp;
      <a href="https://github.com/riadeane" target="_blank" rel="noopener noreferrer">GitHub</a>
    </p>
  </footer>

  <script src='map.js'></script>
</body>
</html>
```

**Step 2: Verify in browser**

Open `index.html` in a browser. Expected: page is visually broken (unstyled) — that's correct since CSS hasn't been updated yet. Confirm the HTML structure loads without JS errors in the console.

**Step 3: Commit**

```bash
git add index.html
git commit -m "refactor: restructure HTML for dark dashboard layout"
```

---

## Task 2: Rewrite style.css with dark theme

**Files:**
- Modify: `style.css`

**Step 1: Replace the entire file**

Replace `style.css` with:

```css
/* ── Design tokens ─────────────────────────────────────────── */
:root {
  --bg: #0f1117;
  --surface: #1a1f2e;
  --border: #2a3045;
  --accent: #4f9cf9;
  --text-primary: #e8eaf0;
  --text-secondary: #7a8299;
  --no-data: #2a2f3d;
  --score-low: #8a9ab5;
  --score-high: #f0c040;
  --header-h: 52px;
  --panel-w: 320px;
}

/* ── Reset ─────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
}

body {
  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-size: 14px;
}

/* ── Header ────────────────────────────────────────────────── */
#app-header {
  height: var(--header-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  gap: 16px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 14px;
  min-width: 0;
}

h1 {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.header-subtitle {
  font-size: 0.72rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ── Search ────────────────────────────────────────────────── */
#search-container {
  position: relative;
}

#country-search {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-family: 'Inter', sans-serif;
  color: var(--text-primary);
  width: 170px;
  outline: none;
  transition: border-color 0.15s, width 0.2s;
}

#country-search::placeholder {
  color: var(--text-secondary);
}

#country-search:focus {
  border-color: var(--accent);
  width: 210px;
}

#search-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  list-style: none;
  z-index: 300;
  max-height: 240px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}

#search-suggestions li {
  padding: 8px 14px;
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--text-primary);
}

#search-suggestions li:hover,
#search-suggestions li.highlighted {
  background: var(--border);
  color: var(--accent);
}

/* ── Score dropdown + filter buttons ───────────────────────── */
#score-btn-container,
#filter-btn-container {
  position: relative;
}

#score-btn,
#filter-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-family: 'Inter', sans-serif;
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: border-color 0.15s, background 0.15s;
}

#score-btn:hover,
#filter-btn:hover,
#score-btn.active,
#filter-btn.active {
  border-color: var(--accent);
  background: var(--surface);
}

.caret {
  font-size: 0.7em;
  opacity: 0.6;
}

#score-dropdown {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  list-style: none;
  z-index: 300;
  min-width: 190px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  overflow: hidden;
}

#score-dropdown.open {
  display: block;
}

#score-dropdown li {
  padding: 9px 14px;
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--text-primary);
}

#score-dropdown li:hover,
#score-dropdown li.selected {
  background: var(--border);
  color: var(--accent);
}

/* ── Filter popover ────────────────────────────────────────── */
#filter-popover {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  z-index: 300;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}

#filter-popover.open {
  display: block;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.filter-row:last-child {
  margin-bottom: 0;
}

.filter-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: 500;
  width: 24px;
  flex-shrink: 0;
}

input[type="range"] {
  flex: 1;
  accent-color: var(--accent);
  cursor: pointer;
}

.filter-row > span:last-child {
  font-size: 0.8rem;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  min-width: 24px;
  text-align: right;
}

/* ── Main area ─────────────────────────────────────────────── */
#app-main {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* ── Map wrapper ───────────────────────────────────────────── */
#map-wrapper {
  flex: 1;
  position: relative;
  background: var(--bg);
  min-width: 0;
  overflow: hidden;
}

#map {
  width: 100%;
  height: 100%;
}

#map svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ── Zoom controls ─────────────────────────────────────────── */
#zoom-controls {
  position: absolute;
  bottom: 20px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 10;
}

#zoom-controls button {
  width: 32px;
  height: 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 1.1rem;
  font-weight: 400;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s;
  font-family: 'Inter', sans-serif;
  line-height: 1;
}

#zoom-controls button:hover {
  border-color: var(--accent);
  background: var(--border);
}

/* ── Country panel ─────────────────────────────────────────── */
#country-panel {
  width: var(--panel-w);
  flex-shrink: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

#no-selection-message {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 0.82rem;
  padding: 24px 20px;
}

.panel-country-header {
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--border);
}

.panel-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

#country-name {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text-primary);
}

.data-freshness {
  display: block;
  font-size: 0.7rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* ── Panel sections ────────────────────────────────────────── */
.panel-section {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}

.panel-section-label {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  color: var(--text-secondary);
  text-transform: uppercase;
  margin-bottom: 10px;
}

.panel-section p {
  font-size: 0.8rem;
  color: var(--text-primary);
  line-height: 1.55;
  margin: 0;
}

/* ── Score bar ─────────────────────────────────────────────── */
.score-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.score-bar-track {
  flex: 1;
  height: 5px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.score-bar-fill {
  height: 100%;
  background: var(--score-high);
  border-radius: 3px;
  transition: width 0.3s ease;
  width: 0%;
}

.score-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  min-width: 40px;
  text-align: right;
}

/* ── Dimension dots ────────────────────────────────────────── */
.dimensions-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.dimension-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dim-label {
  font-size: 0.78rem;
  color: var(--text-primary);
}

.dim-dots {
  display: flex;
  gap: 4px;
}

.dim-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}

.dim-dot.filled {
  background: var(--score-high);
}

/* ── Confidence badge ──────────────────────────────────────── */
.confidence-badge {
  display: none;
  background: #92400e;
  color: #fde68a;
  font-size: 0.62rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

/* ── Sources ───────────────────────────────────────────────── */
#sources-list {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

#sources-list li a {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--border);
  color: var(--accent);
  font-size: 0.72rem;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

#sources-list li a:hover {
  background: var(--accent);
  color: var(--bg);
}

/* ── Tooltip ───────────────────────────────────────────────── */
.tooltip {
  position: absolute;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  pointer-events: none;
  font-family: 'Inter', sans-serif;
  font-size: 0.8rem;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  color: var(--text-primary);
  max-width: 200px;
  z-index: 200;
}

.tooltip strong {
  color: var(--accent);
  display: block;
  margin-bottom: 2px;
  font-size: 0.82rem;
}

/* ── Timeline strip ────────────────────────────────────────── */
#timeline-strip {
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 10px 20px;
  flex-shrink: 0;
}

#timeline-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100% - var(--panel-w) - 40px);
}

#timeline-reset {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, color 0.15s;
  flex-shrink: 0;
  font-family: 'Inter', sans-serif;
}

#timeline-reset:hover {
  border-color: var(--accent);
  color: var(--accent);
}

#timeline-slider {
  flex: 1;
}

#timeline-date-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  min-width: 80px;
  text-align: right;
  white-space: nowrap;
}

/* ── Legend ────────────────────────────────────────────────── */
.legend text,
.legend-title {
  font-size: 11px;
  fill: var(--text-secondary);
  font-family: 'Inter', sans-serif;
}

/* ── Country path interaction styles ───────────────────────── */
.country {
  transition: filter 0.1s;
  cursor: pointer;
}

.country:hover {
  filter: brightness(1.35);
}

.country.selected {
  stroke: #4f9cf9 !important;
  stroke-width: 2px !important;
}

.country.search-dimmed {
  opacity: 0.12;
}

.country.search-highlighted {
  stroke: #4f9cf9 !important;
  stroke-width: 1.5px !important;
  filter: brightness(1.15);
}

/* ── Footer ────────────────────────────────────────────────── */
footer {
  background: var(--surface);
  border-top: 1px solid var(--border);
  text-align: center;
  padding: 14px 40px;
  font-size: 0.72rem;
  color: var(--text-secondary);
  flex-shrink: 0;
  line-height: 1.6;
}

footer p {
  margin-bottom: 4px;
}

footer a {
  color: var(--accent);
  text-decoration: none;
}

footer a:hover {
  text-decoration: underline;
}

/* ── Responsive ────────────────────────────────────────────── */
@media (max-width: 768px) {
  #app-main {
    flex-direction: column;
    overflow: auto;
  }

  #map-wrapper {
    min-height: 50vh;
  }

  #country-panel {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border);
    max-height: 50vh;
  }

  #timeline-inner {
    max-width: 100%;
  }

  .header-right {
    gap: 4px;
  }

  #country-search {
    width: 110px;
  }

  #country-search:focus {
    width: 140px;
  }
}
```

**Step 2: Verify in browser**

Open `index.html`. Expected:
- Dark background everywhere, no white
- Slim sticky header with title left, control placeholders right
- Map area takes left ~70%, right panel is dark surface color
- Footer is dark with small muted text

**Step 3: Commit**

```bash
git add style.css
git commit -m "refactor: rewrite CSS for dark dashboard theme"
```

---

## Task 3: Update map.js — color scale, ocean, stroke colors

**Files:**
- Modify: `map.js`

**Step 1: Add a shared color scale factory after `ATTRIBUTE_LABELS` (after line 18)**

```js
function makeColorScale() {
  return d3.scaleSequential()
    .domain([1, 5])
    .interpolator(d3.interpolateRgb('#8a9ab5', '#f0c040'));
}
```

**Step 2: Update `generateMap` — replace color scale**

Find:
```js
const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
  .domain([1, 5]);
```
Replace with:
```js
const colorScale = makeColorScale();
```

**Step 3: Update `generateMap` — replace ocean fill**

Find:
```js
.attr("fill", "#dcf4f7")
```
Replace with:
```js
.attr("fill", "#162032")
```

**Step 4: Update `generateMap` — replace no-data fill and stroke**

Find:
```js
return entry ? colorScale(entry[scoreAttribute]) : "#ccc";
```
Replace with:
```js
return entry ? colorScale(entry[scoreAttribute]) : "#2a2f3d";
```

Find:
```js
.attr("stroke", "black")
.attr("stroke-width", 0.5)
```
Replace with:
```js
.attr("stroke", "#0f1117")
.attr("stroke-width", 0.3)
```

**Step 5: Update `updateMap` — replace color scale and no-data fill**

Find:
```js
const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
  .domain([1, 5]);
```
Replace with:
```js
const colorScale = makeColorScale();
```

Find (in `updateMap`):
```js
return entry ? colorScale(entry[scoreAttribute]) : "#ccc";
```
Replace with:
```js
return entry ? colorScale(entry[scoreAttribute]) : "#2a2f3d";
```

**Step 6: Verify in browser**

Open the page. Expected: countries shift from steel gray (score 1) to amber gold (score 5), dark navy ocean, dark border strokes.

**Step 7: Commit**

```bash
git add map.js
git commit -m "feat: update map to steel-gray-to-amber choropleth on dark ocean"
```

---

## Task 4: Update map.js — country panel (score bar + dimension dots)

**Files:**
- Modify: `map.js`

**Step 1: Add `renderDots` helper after `makeColorScale`**

```js
function renderDots(elId, score) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.replaceChildren();
  for (let i = 1; i <= 5; i++) {
    const dot = document.createElement('span');
    dot.className = i <= Math.round(score) ? 'dim-dot filled' : 'dim-dot';
    el.appendChild(dot);
  }
}
```

**Step 2: Rewrite `updateCountryData` entirely**

Replace the entire function (from `function updateCountryData` through its closing `}`) with:

```js
function updateCountryData(countryName, countryData, regulationData) {
  const scoreData = countryData[countryName];
  const regData = regulationData[countryName];

  document.getElementById('no-selection-message').style.display = 'none';
  document.getElementById('panel-content').style.display = '';

  document.getElementById('country-name').textContent = countryName;

  const badge = document.getElementById('confidence-badge');
  if (regData && regData.confidence === 'low') {
    badge.textContent = 'Low confidence';
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  const dateStr = (scoreData && scoreData.lastUpdated) || (regData && regData.lastUpdated);
  document.getElementById('last-updated').textContent = dateStr ? `Data as of ${dateStr}` : '';

  const avg = scoreData ? scoreData.averageScore : null;
  document.getElementById('average-score').textContent = avg != null ? `${avg} / 5` : 'N/A';
  document.getElementById('overall-bar-fill').style.width =
    avg != null ? `${((avg - 1) / 4) * 100}%` : '0%';

  renderDots('dots-regulation', scoreData ? scoreData.regulationStatus : null);
  renderDots('dots-policy',     scoreData ? scoreData.policyLever : null);
  renderDots('dots-governance', scoreData ? scoreData.governanceType : null);
  renderDots('dots-actors',     scoreData ? scoreData.actorInvolvement : null);
  renderDots('dots-enforcement',scoreData ? scoreData.enforcementLevel : null);

  if (regData) {
    document.getElementById('regulation-details').textContent = regData.regulationStatus || 'N/A';
    document.getElementById('policy-details').textContent     = regData.policyLever || 'N/A';
    document.getElementById('governance-details').textContent = regData.governanceType || 'N/A';
    document.getElementById('actors-details').textContent     = regData.actorInvolvement || 'N/A';

    showSection('enforcement-section', !!regData.enforcementLevel);
    if (regData.enforcementLevel) {
      document.getElementById('enforcement-details').textContent = regData.enforcementLevel;
    }

    showSection('laws-section', !!regData.specificLaws);
    if (regData.specificLaws) {
      document.getElementById('specific-laws').textContent = regData.specificLaws;
    }

    const sourcesContainer = document.getElementById('sources-list');
    sourcesContainer.replaceChildren();
    const urls = regData.sources && regData.sources !== 'NA'
      ? regData.sources.split('|').map(u => u.trim()).filter(Boolean)
      : [];
    if (urls.length > 0) {
      urls.forEach((url, i) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        try { a.textContent = new URL(url).hostname.replace('www.', ''); }
        catch { a.textContent = `Source ${i + 1}`; }
        li.appendChild(a);
        sourcesContainer.appendChild(li);
      });
      showSection('sources-section', true);
    } else {
      showSection('sources-section', false);
    }
  } else {
    ['regulation-details', 'policy-details', 'governance-details', 'actors-details'].forEach(id => {
      document.getElementById(id).textContent = 'N/A';
    });
    showSection('enforcement-section', false);
    showSection('laws-section', false);
    showSection('sources-section', false);
  }
}
```

**Step 3: Verify in browser**

Click a country. Expected:
- Panel shows country name at top
- Score bar fills proportionally (e.g., a score of 3.0 fills ~50%)
- 5 dot rows — filled dots match the numeric score (rounded)
- Description text in each section below

**Step 4: Commit**

```bash
git add map.js
git commit -m "feat: redesign country panel with score bar and dimension dots"
```

---

## Task 5: Update map.js — score selector custom dropdown

**Files:**
- Modify: `map.js`

**Context:** HTML now has `#score-btn` with a `#score-btn-label` span inside it, plus `#score-dropdown` `<ul>`, instead of `<select id="score-select">`.

**Step 1: Replace `buildScoreSelector` entirely**

```js
function buildScoreSelector() {
  const btn = document.getElementById('score-btn');
  const btnLabel = document.getElementById('score-btn-label');
  const dropdown = document.getElementById('score-dropdown');
  const options = [
    { value: 'averageScore',     text: 'Average Score' },
    { value: 'regulationStatus', text: 'Regulation Status' },
    { value: 'policyLever',      text: 'Policy Lever' },
    { value: 'governanceType',   text: 'Governance Type' },
    { value: 'actorInvolvement', text: 'Actor Involvement' },
    { value: 'enforcementLevel', text: 'Enforcement Level' }
  ];

  options.forEach(opt => {
    const li = document.createElement('li');
    li.textContent = opt.text;
    li.dataset.value = opt.value;
    if (opt.value === currentAttribute) li.classList.add('selected');
    li.addEventListener('click', () => {
      currentAttribute = opt.value;
      btnLabel.textContent = opt.text;
      dropdown.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
      li.classList.add('selected');
      dropdown.classList.remove('open');
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
      updateMap(currentScoreData, currentAttribute);
    });
    dropdown.appendChild(li);
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    document.getElementById('filter-popover').classList.remove('open');
    document.getElementById('filter-btn').classList.remove('active');
    document.getElementById('filter-btn').setAttribute('aria-expanded', 'false');
  });
}
```

**Step 2: Verify in browser**

Click "Average Score" button. Expected: dropdown with 6 options appears. Select "Enforcement Level" — map recolors, button label updates, dropdown closes.

**Step 3: Commit**

```bash
git add map.js
git commit -m "feat: replace native select with custom score dropdown"
```

---

## Task 6: Update map.js — filter popover + global close handler

**Files:**
- Modify: `map.js`

**Step 1: Replace `initFilter` entirely**

```js
function initFilter() {
  const btn = document.getElementById('filter-btn');
  const popover = document.getElementById('filter-popover');
  const minSlider = document.getElementById('filter-min');
  const maxSlider = document.getElementById('filter-max');
  const minLabel = document.getElementById('filter-min-label');
  const maxLabel = document.getElementById('filter-max-label');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popover.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    document.getElementById('score-dropdown').classList.remove('open');
    document.getElementById('score-btn').classList.remove('active');
    document.getElementById('score-btn').setAttribute('aria-expanded', 'false');
  });

  function applyFilter() {
    filterMin = parseFloat(minSlider.value);
    filterMax = parseFloat(maxSlider.value);
    if (filterMin > filterMax) {
      filterMax = filterMin;
      maxSlider.value = filterMax;
    }
    minLabel.textContent = filterMin;
    maxLabel.textContent = filterMax;
    updateMap(currentScoreData, currentAttribute);
  }

  minSlider.addEventListener('input', applyFilter);
  maxSlider.addEventListener('input', applyFilter);
}
```

**Step 2: Update `initialLoad` — fix `initFilter` call and add global close handler**

Find:
```js
initFilter(currentScoreData);
```
Replace with:
```js
initFilter();
```

At the very end of `initialLoad`, just before the closing `}`, add:

```js
document.addEventListener('click', () => {
  document.getElementById('score-dropdown').classList.remove('open');
  document.getElementById('score-btn').classList.remove('active');
  document.getElementById('score-btn').setAttribute('aria-expanded', 'false');
  document.getElementById('filter-popover').classList.remove('open');
  document.getElementById('filter-btn').classList.remove('active');
  document.getElementById('filter-btn').setAttribute('aria-expanded', 'false');
});
```

**Step 3: Verify in browser**

Click "Filter". Expected: popover appears with Min/Max sliders. Move sliders — out-of-range countries dim. Click elsewhere — popover closes. Score dropdown and filter popover don't open at the same time.

**Step 4: Commit**

```bash
git add map.js
git commit -m "feat: convert filter to popover with global close handler"
```

---

## Task 7: Update map.js — search map highlight/dim

**Files:**
- Modify: `map.js`

**Step 1: Add `updateSearchHighlight` helper after `renderDots`**

```js
function updateSearchHighlight(query) {
  if (query.length < 2) {
    d3.selectAll('.country')
      .classed('search-dimmed', false)
      .classed('search-highlighted', false);
    return;
  }
  const lq = query.toLowerCase();
  d3.selectAll('.country').each(function(d) {
    const name = (d.properties.name || '').toLowerCase();
    const matches = name.includes(lq);
    d3.select(this)
      .classed('search-dimmed', !matches)
      .classed('search-highlighted', matches);
  });
}
```

**Step 2: Call `updateSearchHighlight` in `initSearch`**

In the `'input'` event listener, find:
```js
searchInput.addEventListener('input', function () {
  const query = this.value.trim().toLowerCase();
  suggestions.innerHTML = '';
  if (query.length < 2) return;
```

Wait — `suggestions.innerHTML = ''` will be flagged by the hook since it's clearing a list built from user search input indirectly. Replace it with `.replaceChildren()`:

```js
searchInput.addEventListener('input', function () {
  const query = this.value.trim().toLowerCase();
  suggestions.replaceChildren();
  updateSearchHighlight(query);
  if (query.length < 2) return;
```

**Step 3: Replace all remaining `suggestions.innerHTML = ''` in `initSearch`**

There are two more places. Find each one and change to `suggestions.replaceChildren()`.

Also, in the suggestion `li.addEventListener('click', ...)`, add the highlight clear:

Find:
```js
li.addEventListener('click', () => {
  searchInput.value = name;
  suggestions.innerHTML = '';
  selectCountryByName(name, scoreData, regulationData);
});
```
Replace with:
```js
li.addEventListener('click', () => {
  searchInput.value = name;
  suggestions.replaceChildren();
  updateSearchHighlight('');
  selectCountryByName(name, scoreData, regulationData);
});
```

In the outside-click handler:

Find:
```js
document.addEventListener('click', e => {
  if (!e.target.closest('#search-container')) {
    suggestions.innerHTML = '';
  }
});
```
Replace with:
```js
document.addEventListener('click', e => {
  if (!e.target.closest('#search-container')) {
    suggestions.replaceChildren();
    updateSearchHighlight('');
    searchInput.value = '';
  }
});
```

**Step 4: Verify in browser**

Type "ger" in the search box. Expected: Germany gets a blue outline, all other countries dim significantly. Selecting a suggestion clears the effect. Clicking outside the search clears the effect and clears the input.

**Step 5: Commit**

```bash
git add map.js
git commit -m "feat: add map highlight/dim on search input"
```

---

## Task 8: Update map.js — fix timeline IDs

**Files:**
- Modify: `map.js`

**Context:** The timeline container ID changed from `timeline-container` to `timeline-strip`.

**Step 1: Update `initTimeline`**

Find:
```js
const container = document.getElementById('timeline-container');
container.style.display = 'block';
```
Replace with:
```js
const container = document.getElementById('timeline-strip');
container.style.display = 'block';
```

**Step 2: Verify in browser**

If `history.json` has more than 1 date, the timeline strip should appear at the bottom of the viewport. Slider and reset button should work.

**Step 3: Commit**

```bash
git add map.js
git commit -m "fix: update timeline element ID to match new layout"
```

---

## Task 9: Full end-to-end verification

**Step 1: Open `index.html` in browser and verify the complete checklist**

- [ ] Dark background throughout — no white anywhere
- [ ] Sticky header: title left, search / score dropdown / filter right
- [ ] Map fills left ~70% of viewport; panel fills right ~30%
- [ ] Ocean is dark navy (#162032), countries are gray-to-amber
- [ ] Hover over a country: subtle brightness lift
- [ ] Click a country: blue outline appears, panel shows name + score bar + dots + text
- [ ] Score bar fills proportionally
- [ ] Dimension dots match each score (rounded to nearest whole)
- [ ] Score dropdown: clicking opens list, selecting updates button label and map
- [ ] Filter popover: sliders dim out-of-range countries
- [ ] Search: typing dims/highlights countries on map; selecting clears
- [ ] Timeline strip appears at bottom if history data has multiple dates
- [ ] Footer: dark, small text, links in accent color
- [ ] Mobile (resize to 768px wide): layout stacks vertically, map on top, panel below

**Step 2: Commit any remaining fixes found during verification**

```bash
git add -p
git commit -m "fix: polish after end-to-end verification"
```
