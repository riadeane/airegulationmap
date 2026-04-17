# Country Comparison Panel

## Why Build This

Side-by-side comparison of 2–4 countries is the #1 researcher request for governance analysis tools. No existing tracker (OECD, Stanford HAI, AGILE Index) offers interactive multi-country visual comparison. Researchers currently copy scores into spreadsheets manually. A radar chart overlaying all six dimensions for selected countries would make governance pattern differences immediately visible (e.g., "high enforcement but low actor involvement" vs. "broad participation but weak enforcement").

## Research Links

- AGILE Index (arXiv 2507.11546) — calls out lack of cross-country visual comparison tools
- Stanford HAI AI Index 2025 — compares countries in static tables only
- OECD AI Policy Observatory — no multi-country overlay view

## Current State

- `src/panel/` renders a single country's details (scores + text sections)
- `src/panel/scores.js` has `renderDots(elId, score)` for 1–5 dot displays and `renderScoreBar(avg)` for the average
- `src/state/store.js` has `selectedCountry` (single string) and `scoreData` / `regulationData` (full datasets)
- `src/constants.js` has `ATTRIBUTE_LABELS` with all 6 dimension names
- Country selection happens via map click in `src/map/renderer.js` and search in `src/controls/search.js`
- No existing multi-select or comparison infrastructure

## Implementation Approach

### Step 1: Add comparison state to the store

In `src/state/store.js`, add a new state key:

```js
comparisonCountries: []   // array of 0–4 country name strings
```

When `comparisonCountries` has 2+ entries, the comparison panel should render.

### Step 2: Add "Compare" button to country panel

In `src/panel/index.js`, add a button to the rendered panel:

```
[+ Compare] button
```

Clicking it adds the current `selectedCountry` to `comparisonCountries` (max 4). If already in the list, the button shows "Remove from comparison" instead.

### Step 3: Add comparison toggle via map interaction

Extend `src/map/renderer.js`:
- Hold `Shift` + click to add/remove a country from `comparisonCountries` (visual: add a colored border to compared countries on the map)
- Show small numbered badges (1–4) on compared countries

### Step 4: Create comparison panel module

Create `src/comparison/` directory:

**`src/comparison/radar.js`** — D3 radar/spider chart:
- 6 axes (one per dimension), scale 1–5
- One polygon per country, each with a distinct color
- Labels on each axis
- Legend mapping colors to country names
- Use D3's `d3.lineRadial()` with `d3.curveLinearClosed`
- SVG sized ~400×400px

**`src/comparison/panel.js`** — Comparison panel container:
- Slides in from right (or replaces the country detail panel)
- Header: "Comparing N countries" with country name chips (click × to remove)
- Radar chart section
- Below radar: aligned text sections showing each dimension's text for all compared countries in columns
- "Clear All" button to reset

**`src/comparison/index.js`** — Subscriptions and init:
- Subscribe to `comparisonCountries` state changes
- Show/hide comparison panel
- Re-render radar when countries change

### Step 5: Wire into main.js

In `src/main.js`:
- Import and call `initComparison()` during app boot
- Ensure comparison panel and single-country panel don't conflict (comparison takes precedence when 2+ countries selected)

### Step 6: Add CSS

Create `src/styles/_comparison.css`:
- Panel layout (flex column)
- Radar chart sizing and colors
- Country chips with × buttons
- Responsive: stack vertically on mobile
- Import in `src/styles/main.css`

### Step 7: Add HTML container

In `index.html`, add inside `<main>`:

```html
<aside id="comparison-panel" class="comparison-panel" hidden>
  <div class="comparison-header">
    <h2>Country Comparison</h2>
    <button id="clear-comparison">Clear All</button>
  </div>
  <div id="comparison-chips"></div>
  <div id="radar-chart"></div>
  <div id="comparison-details"></div>
</aside>
```

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/comparison/radar.js` |
| Create | `src/comparison/panel.js` |
| Create | `src/comparison/index.js` |
| Create | `src/styles/_comparison.css` |
| Modify | `src/state/store.js` — add `comparisonCountries: []` |
| Modify | `src/panel/index.js` — add Compare button |
| Modify | `src/map/renderer.js` — Shift+click multi-select, badges |
| Modify | `src/main.js` — import and init comparison module |
| Modify | `src/styles/main.css` — import `_comparison.css` |
| Modify | `index.html` — add comparison panel container |

## Key Decisions / Open Questions

1. **Panel placement**: Recommend replacing the single-country panel when comparison is active (same `<aside>` slot). Alternative: full-width modal overlay. The implementing agent should check viewport constraints — the current panel is 380px wide in `_panel.css`.

2. **Radar vs. bar chart**: Radar is recommended — it uniquely shows the "shape" of a governance profile. For accessibility, also include a small data table below the chart. Implement radar first; bar chart can be a fallback if radar proves too complex.

3. **Max countries**: Cap at 4 to keep the radar readable. The UI should gray out the "Compare" button and show a tooltip when at capacity.

4. **Color assignment**: Use a fixed 4-color palette (e.g., from the existing token palette) assigned in order. Colors should be distinct from the map's gold-to-gray scale.

5. **Mobile behavior**: On screens < 768px, the comparison panel should be a full-screen overlay with a close button, not a side panel.

6. **URL state**: Consider encoding compared countries in the URL hash (e.g., `#compare=Germany,France,Japan`) for shareability. This is a nice-to-have.

## Verification

1. Select 2 countries via Shift+click on map → radar chart renders with 2 polygons
2. Add a 3rd country via the panel's Compare button → radar updates, chip appears
3. Remove a country via chip × → radar updates, map badge disappears
4. Try to add a 5th country → button is disabled, tooltip explains limit
5. "Clear All" resets to normal single-country panel mode
6. Verify radar axes are labeled correctly and scale matches 1–5
7. Verify text comparison sections show aligned content for all countries
8. Test on mobile viewport (< 768px) — should show full-screen overlay
9. Test keyboard: Shift+Enter in search should add to comparison
