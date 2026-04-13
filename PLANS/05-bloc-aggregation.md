# Bloc/Regional Aggregation

## Why Build This

Regulatory convergence and divergence analysis at the bloc level is a core research need. Researchers want to ask: "How aligned is the EU on enforcement?" or "How does ASEAN compare to the G20?" The AGILE Index (arXiv 2507.11546) explicitly calls out missing bloc-level aggregation. No existing tool groups countries by political/economic bloc and shows aggregate governance scores or intra-bloc variance.

## Research Links

- AGILE Index (arXiv 2507.11546) — explicitly identifies bloc-level aggregation as a gap
- OECD AI Policy Observatory — has region filters but no bloc-level scoring
- arXiv 2505.00174 — regional convergence identified as underserved analysis

## Current State

- `scoreData` contains per-country numeric scores for 6 dimensions
- `src/controls/filter.js` implements score range filtering (min/max sliders)
- `src/map/renderer.js` handles country highlighting and opacity based on filters
- `src/constants.js` has `ATTRIBUTE_LABELS` for dimension names
- No existing bloc/grouping data or UI
- `public/data/` directory exists for static data files (currently has `country_names.json`)

## Implementation Approach

### Step 1: Create bloc membership data file

Create `public/data/blocs.json`:

```json
{
  "EU": {
    "name": "European Union",
    "members": ["Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden"]
  },
  "G20": {
    "name": "G20",
    "members": ["Argentina", "Australia", "Brazil", "Canada", "China", "France", "Germany", "India", "Indonesia", "Italy", "Japan", "Mexico", "Russia", "Saudi Arabia", "South Africa", "South Korea", "Turkey", "United Kingdom", "United States"]
  },
  "ASEAN": {
    "name": "ASEAN",
    "members": ["Brunei", "Cambodia", "Indonesia", "Laos", "Malaysia", "Myanmar", "Philippines", "Singapore", "Thailand", "Vietnam"]
  },
  "AU": {
    "name": "African Union",
    "members": ["...all 55 members..."]
  },
  "BRICS": {
    "name": "BRICS+",
    "members": ["Brazil", "Russia", "India", "China", "South Africa", "Egypt", "Ethiopia", "Iran", "Saudi Arabia", "United Arab Emirates"]
  },
  "NATO": {
    "name": "NATO",
    "members": ["...32 members..."]
  },
  "OECD": {
    "name": "OECD",
    "members": ["...38 members..."]
  },
  "G7": {
    "name": "G7",
    "members": ["Canada", "France", "Germany", "Italy", "Japan", "United Kingdom", "United States"]
  }
}
```

**Important**: Country names MUST match exactly what's in `scores.csv`. The implementing agent should cross-reference against `sortedCountryNames` in state and the alias map in `public/data/country_names.json`.

### Step 2: Create bloc data loader

Create `src/data/blocs.js`:

```js
export async function loadBlocs() {
  const resp = await fetch('/data/blocs.json');
  return resp.json();
}

/**
 * Compute aggregate stats for a bloc.
 * Returns { avg, min, max, stdDev, memberCount, scoredCount }
 */
export function computeBlocStats(blocMembers, scoreData, attribute) {
  const scores = blocMembers
    .map(name => scoreData[name]?.[attribute])
    .filter(s => s != null);

  if (scores.length === 0) return null;

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length;

  return {
    average: +avg.toFixed(2),
    min: Math.min(...scores),
    max: Math.max(...scores),
    stdDev: +Math.sqrt(variance).toFixed(2),
    memberCount: blocMembers.length,
    scoredCount: scores.length,
  };
}
```

### Step 3: Create bloc selector UI

Create `src/controls/blocSelector.js`:

Build a `<select>` dropdown with bloc options. Use safe DOM creation (createElement + textContent, no dynamic HTML injection):

```js
import { getState, setState, on } from '../state/store.js';

export function initBlocSelector(blocs) {
  const container = document.getElementById('bloc-selector');
  const select = document.createElement('select');
  select.id = 'bloc-select';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'All Countries';
  select.appendChild(defaultOpt);

  for (const [key, bloc] of Object.entries(blocs)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = bloc.name;
    select.appendChild(opt);
  }

  container.appendChild(select);

  select.addEventListener('change', (e) => {
    setState({ selectedBloc: e.target.value || null });
  });
}
```

### Step 4: Add state keys

In `src/state/store.js`, add:
```js
selectedBloc: null,   // string key like "EU" or null
blocsData: null,      // loaded blocs.json
```

### Step 5: Wire bloc selection to map

Modify `src/map/index.js` or `src/map/renderer.js`:
- When `selectedBloc` is set, dim non-member countries (opacity ~0.2)
- Highlight member countries with full opacity
- Optionally add a colored outline to the bloc's countries

### Step 6: Create bloc summary panel

Create `src/controls/blocSummary.js`:

Renders below the map or in a floating card when a bloc is selected. Build DOM programmatically using createElement and textContent (no dynamic HTML injection). Show:

- Bloc name and member count
- Average score for current attribute
- Standard deviation (shows alignment/divergence)
- Highest and lowest scoring members
- Small bar chart of all dimensions' averages

### Step 7: Add HTML elements

In `index.html`, add in the header controls area:

```html
<div id="bloc-selector" class="bloc-selector"></div>
```

And below the map:

```html
<div id="bloc-summary" class="bloc-summary" hidden></div>
```

### Step 8: Init from main.js

```js
import { loadBlocs } from './data/blocs.js';
import { initBlocSelector } from './controls/blocSelector.js';

// In init():
const blocs = await loadBlocs();
setState({ blocsData: blocs });
initBlocSelector(blocs);
```

### Step 9: Style

Create `src/styles/_blocs.css` with styles for selector dropdown, summary card, and map overlay effects. Import in `main.css`.

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `public/data/blocs.json` |
| Create | `src/data/blocs.js` |
| Create | `src/controls/blocSelector.js` |
| Create | `src/controls/blocSummary.js` |
| Create | `src/styles/_blocs.css` |
| Modify | `src/state/store.js` — add `selectedBloc`, `blocsData` |
| Modify | `src/map/renderer.js` or `src/map/index.js` — filter map by bloc |
| Modify | `src/main.js` — load blocs, init selector |
| Modify | `src/styles/main.css` — import `_blocs.css` |
| Modify | `index.html` — add bloc selector and summary containers |

## Key Decisions / Open Questions

1. **Country name matching**: This is the highest-risk item. Bloc member names MUST exactly match `scores.csv` country names. The implementing agent should: (a) load `sortedCountryNames` from state, (b) cross-reference every name in `blocs.json`, (c) use `country_names.json` alias map for normalization if needed.

2. **Bloc selector placement**: Recommend as a `<select>` dropdown in the header, between the score selector and the filter. Alternative: pill/chip toggles below the map.

3. **Interaction with existing filters**: Bloc selection should work *alongside* the score range filter. When both are active: show only bloc members that also pass the score filter. The implementing agent should test this interaction.

4. **Bloc summary placement**: Below the map in a collapsible card. Should not obscure the map. On mobile, it should be above or below the map, not overlaid.

5. **Which blocs to include**: Start with EU, G7, G20, ASEAN, AU, BRICS+, NATO, OECD. The implementing agent can add more (MERCOSUR, GCC, CPTPP) but should ensure the dropdown doesn't get unwieldy.

6. **Variance visualization**: Standard deviation tells researchers how aligned a bloc is. Consider a small visual indicator — a narrow bar showing the score range (min to max) with the average marked.

## Verification

1. Select "EU" from dropdown — non-EU countries dim on map
2. Bloc summary shows correct member count and average scores
3. Select "G7" — only 7 countries highlighted, summary updates
4. Combine with score filter (3-5) — only G7 members with score >= 3 are fully visible
5. Select "All Countries" — map resets to normal view
6. Verify country name matching: no "0 scored" members for major blocs
7. Summary stats (avg, min, max, std dev) are mathematically correct — spot-check manually
8. Mobile: summary card doesn't overlap the map
