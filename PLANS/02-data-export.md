# Data Export

## Why Build This

Researchers need machine-readable data for statistical analysis in R, Python, Stata, and Excel. No free AI governance tracker offers clean structured exports — OECD has limited API access, IAPP has no API at all, and Stanford HAI publishes static PDFs. A one-click CSV/JSON download of the current filtered view turns this app from a visualization into a research data source.

## Research Links

- arXiv 2505.00174 — identifies machine-readable exports as a top-5 unmet need
- OECD AI Policy Observatory — limited API, no bulk CSV export
- IAPP AI Governance Tracker — no API or export

## Current State

- `scoreData` and `regulationData` are already in state as JS objects keyed by country name
- D3 is loaded and has `d3.csvFormat()` for CSV serialization
- `src/state/store.js` has `filterMin` and `filterMax` for current filter state
- `src/constants.js` has `ATTRIBUTE_LABELS` mapping internal keys to display names
- The header bar in `index.html` has space for additional controls (after `.search-container`)
- No existing export functionality

## Implementation Approach

### Step 1: Create export utility module

Create `src/controls/export.js`:

```js
import { getState } from '../state/store.js';
import { ATTRIBUTE_LABELS } from '../constants.js';

/**
 * Merge score and regulation data for a list of countries.
 * Returns array of flat objects suitable for CSV/JSON export.
 */
function buildExportRows(countries) {
  const { scoreData, regulationData } = getState();
  return countries.map(name => {
    const scores = scoreData[name] || {};
    const reg = regulationData[name] || {};
    return {
      Country: name,
      'Average Score': scores.averageScore,
      'Regulation Status (Score)': scores.regulationStatus,
      'Policy Lever (Score)': scores.policyLever,
      'Governance Type (Score)': scores.governanceType,
      'Actor Involvement (Score)': scores.actorInvolvement,
      'Enforcement Level (Score)': scores.enforcementLevel,
      'Regulation Status': reg.regulationStatus || '',
      'Policy Lever': reg.policyLever || '',
      'Governance Type': reg.governanceType || '',
      'Actor Involvement': reg.actorInvolvement || '',
      'Enforcement Level': reg.enforcementLevel || '',
      'Specific Laws': reg.specificLaws || '',
      'Sources': reg.sources || '',
      'Confidence': reg.confidence || '',
      'Last Updated': scores.lastUpdated || reg.lastUpdated || '',
    };
  });
}

/**
 * Get currently visible countries (respecting score filter).
 */
function getFilteredCountries() {
  const { scoreData, currentAttribute, filterMin, filterMax } = getState();
  return Object.keys(scoreData).filter(name => {
    const score = scoreData[name]?.[currentAttribute];
    return score >= filterMin && score <= filterMax;
  }).sort();
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(allCountries = false) {
  const countries = allCountries
    ? Object.keys(getState().scoreData).sort()
    : getFilteredCountries();
  const rows = buildExportRows(countries);
  const csv = d3.csvFormat(rows);
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(csv, `ai-regulation-data-${date}.csv`, 'text/csv');
}

export function exportJSON(allCountries = false) {
  const countries = allCountries
    ? Object.keys(getState().scoreData).sort()
    : getFilteredCountries();
  const rows = buildExportRows(countries);
  const json = JSON.stringify(rows, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(json, `ai-regulation-data-${date}.json`, 'application/json');
}
```

### Step 2: Add export button + dropdown to header

In `index.html`, add after the filter button in the header controls:

```html
<div class="export-container">
  <button id="export-btn" class="header-btn" aria-haspopup="true" aria-expanded="false">
    ↓ Export
  </button>
  <div id="export-dropdown" class="export-dropdown" hidden>
    <button data-format="csv" data-scope="filtered">CSV (filtered view)</button>
    <button data-format="json" data-scope="filtered">JSON (filtered view)</button>
    <hr>
    <button data-format="csv" data-scope="all">CSV (all countries)</button>
    <button data-format="json" data-scope="all">JSON (all countries)</button>
  </div>
</div>
```

### Step 3: Wire up event listeners

Add to `src/controls/export.js`:

```js
export function initExport() {
  const btn = document.getElementById('export-btn');
  const dropdown = document.getElementById('export-dropdown');

  btn.addEventListener('click', () => {
    const open = !dropdown.hidden;
    dropdown.hidden = open;
    btn.setAttribute('aria-expanded', !open);
  });

  dropdown.addEventListener('click', (e) => {
    const target = e.target.closest('button[data-format]');
    if (!target) return;
    const allCountries = target.dataset.scope === 'all';
    if (target.dataset.format === 'csv') exportCSV(allCountries);
    else exportJSON(allCountries);
    dropdown.hidden = true;
    btn.setAttribute('aria-expanded', false);
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.export-container')) {
      dropdown.hidden = true;
      btn.setAttribute('aria-expanded', false);
    }
  });
}
```

### Step 4: Init from main.js

In `src/main.js`, import and call `initExport()` after other control inits.

### Step 5: Style the dropdown

Add to `src/styles/_header.css` (or create `src/styles/_export.css`):

```css
.export-container {
  position: relative;
}

.export-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 200px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
}

.export-dropdown button {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
}

.export-dropdown button:hover {
  background: var(--hover);
}
```

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/controls/export.js` |
| Modify | `index.html` — add export button + dropdown markup |
| Modify | `src/main.js` — import and call `initExport()` |
| Modify | `src/styles/_header.css` — export dropdown styles (or create `_export.css` + import) |

## Key Decisions / Open Questions

1. **Scope options**: The plan includes both "filtered view" and "all countries" options. The filtered view exports only countries matching the current score range filter. The implementing agent should verify that `getFilteredCountries()` correctly applies the active attribute + filter range.

2. **Which fields to export**: The plan merges both scores and regulation text into one flat row. This is the most useful format for researchers. If the CSV gets too wide, consider offering "scores only" and "full data" options.

3. **Button placement**: Should go in the header controls bar, right-aligned, near the filter button. Match the visual style of existing header buttons (see `_header.css` for `.header-btn` or similar classes).

4. **Filename convention**: Uses `ai-regulation-data-YYYY-MM-DD.csv`. Consider including filter info in the filename if filtered.

5. **Large file handling**: With ~196 countries × 16 columns, the CSV will be ~200KB — no streaming needed.

## Verification

1. Click "Export" → dropdown appears with 4 options
2. Click "CSV (filtered view)" → downloads CSV with only countries in current filter range
3. Open CSV in Excel/Numbers → all columns present, scores are numeric, text is quoted properly
4. Click "JSON (all countries)" → downloads JSON with all 196 countries
5. Apply a filter (e.g., score 3–5) → "CSV (filtered view)" exports only matching countries
6. Click outside dropdown → closes
7. Verify no data corruption: spot-check 3 countries against the app's panel display
