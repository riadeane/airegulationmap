# Per-Country Changelog View

## Why Build This

Longitudinal change tracking is the #1 unmet need in AI governance research (arXiv 2505.00174, AGILE Index). Every existing tool publishes static snapshots — researchers can't see *when* a country's regulation matured, *what* changed, or at *what pace*. The app already stores timestamped score history in `history.json`, but it's only used for the timeline scrubber. Surfacing per-country score change history (e.g., "Enforcement Level: 2 to 3 on 2025-09-01") creates an auditable research trail that no competitor offers.

## Research Links

- arXiv 2505.00174 — longitudinal tracking identified as top unmet need
- AGILE Index (arXiv 2507.11546) — static snapshots only, explicitly notes lack of change tracking
- Stanford HAI AI Index — annual cadence, no per-country change log

## Current State

- `public/history.json` stores timestamped snapshots per country:
  ```json
  { "countries": { "Germany": [{ "date": "2026-03-21", "regulationStatus": 4, ... }] } }
  ```
- `src/data/history.js` exports:
  - `loadHistory()` — fetches history.json
  - `buildScoresAtDate(history, targetDate)` — reconstructs scores at a date
  - `extractSortedDates(history)` — returns sorted unique dates
- `src/controls/timeline.js` uses history for the timeline slider
- `src/panel/index.js` renders the country panel; subscribes to `selectedCountry`
- The panel currently shows only the *current* scores and text — no historical view

## Implementation Approach

### Step 1: Create changelog computation utility

Create `src/data/changelog.js`:

```js
import { ATTRIBUTE_LABELS } from '../constants.js';

/**
 * Compute changelog for a single country from history snapshots.
 * Returns array of { date, changes: [{ dimension, from, to }] }
 * sorted newest-first.
 */
export function computeChangelog(countryHistory) {
  if (!countryHistory || countryHistory.length < 2) return [];

  const changelog = [];
  const sorted = [...countryHistory].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const changes = [];

    for (const [key, label] of Object.entries(ATTRIBUTE_LABELS)) {
      const histKey = toHistoryKey(key);
      if (prev[histKey] !== curr[histKey]) {
        changes.push({
          dimension: label,
          from: prev[histKey],
          to: curr[histKey],
        });
      }
    }

    if (changes.length > 0) {
      changelog.push({ date: curr.date, changes });
    }
  }

  return changelog.reverse(); // newest first
}
```

### Step 2: Add changelog section to country panel

Modify `src/panel/index.js` — in `renderPanel()`, after existing scores and text sections, call a `renderChangelog()` function.

**SECURITY NOTE**: Use safe DOM creation methods (`document.createElement`, `textContent`) for rendering changelog entries. Do NOT use `innerHTML` with data from history.json. Build DOM nodes programmatically:

```js
function renderChangelog(countryName) {
  const container = document.getElementById('changelog-section');
  const { history } = getState();

  if (!history?.countries?.[countryName]) {
    container.hidden = true;
    return;
  }

  const changelog = computeChangelog(history.countries[countryName]);
  if (changelog.length === 0) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.replaceChildren(); // clear previous content

  const heading = document.createElement('h3');
  heading.textContent = 'Score History';
  container.appendChild(heading);

  const entriesDiv = document.createElement('div');
  entriesDiv.className = 'changelog-entries';

  for (const entry of changelog) {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'changelog-entry';

    const time = document.createElement('time');
    time.className = 'changelog-date';
    time.textContent = formatDate(entry.date);
    entryDiv.appendChild(time);

    const ul = document.createElement('ul');
    ul.className = 'changelog-changes';

    for (const c of entry.changes) {
      const li = document.createElement('li');

      const dimSpan = document.createElement('span');
      dimSpan.className = 'changelog-dim';
      dimSpan.textContent = c.dimension;
      li.appendChild(dimSpan);

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'changelog-arrow';
      arrowSpan.textContent = `${c.from} → ${c.to}`;
      li.appendChild(arrowSpan);

      const dirSpan = document.createElement('span');
      dirSpan.className = c.to > c.from ? 'changelog-direction up' : 'changelog-direction down';
      dirSpan.textContent = c.to > c.from ? '↑' : '↓';
      li.appendChild(dirSpan);

      ul.appendChild(li);
    }

    entryDiv.appendChild(ul);
    entriesDiv.appendChild(entryDiv);
  }

  container.appendChild(entriesDiv);
}
```

### Step 3: Store history in state

In `src/main.js`, after loading history (already happens for timeline), store it in state:

```js
const history = await loadHistory();
setState({ history });
```

Add `history: null` to the initial state in `src/state/store.js`.

### Step 4: Add HTML container in panel

In `index.html`, inside `#country-panel` (after existing sections):

```html
<div id="changelog-section" class="panel-section" hidden></div>
```

### Step 5: Style the changelog

Add to `src/styles/_panel.css`:

```css
.changelog-entries {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.changelog-entry {
  border-left: 2px solid var(--border);
  padding-left: 12px;
}

.changelog-date {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.changelog-changes {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
}

.changelog-changes li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  padding: 2px 0;
}

.changelog-dim {
  min-width: 140px;
  color: var(--text-secondary);
}

.changelog-arrow {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.changelog-direction.up {
  color: var(--success, #4caf50);
}

.changelog-direction.down {
  color: var(--warning, #ff9800);
}
```

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/data/changelog.js` |
| Modify | `src/state/store.js` — add `history: null` to initial state |
| Modify | `src/main.js` — store loaded history in state via `setState({ history })` |
| Modify | `src/panel/index.js` — call `renderChangelog()` inside `renderPanel()` |
| Modify | `index.html` — add `#changelog-section` container inside country panel |
| Modify | `src/styles/_panel.css` — changelog entry styles |

## Key Decisions / Open Questions

1. **Placement**: Plan puts changelog at the bottom of the country panel, below text sections. Alternative: a collapsible/expandable accordion section to save vertical space. Recommend starting with always-visible if there are 5 or fewer entries, collapsible if more.

2. **Date formatting**: Use `Intl.DateTimeFormat` for locale-aware formatting (e.g., "Mar 21, 2026"). Avoid raw ISO dates.

3. **First snapshot**: The first snapshot has no "previous" to diff against. Options: (a) show it as "Initial assessment" with all scores listed, or (b) skip it. Recommend (a) to establish a baseline.

4. **Average score changes**: Show average score changes or only the 5 individual dimensions? Recommend showing average only if an individual dimension changed (it's derived, not independently scored).

5. **History key mapping**: `history.json` uses camelCase keys (`regulationStatus`), but `ATTRIBUTE_LABELS` uses different keys (`averageScore`). The implementing agent needs to verify the key mapping between these two formats. Check `src/data/loader.js` for the exact accessor names.

6. **Empty states**: If a country has only one snapshot (no changes yet), show "No score changes recorded" instead of hiding the section entirely — this is more informative.

## Verification

1. Select a country with 2+ history snapshots — changelog section appears with dated entries
2. Each entry shows which dimensions changed and the direction (up/down arrows)
3. Entries are sorted newest-first
4. Select a country with only 1 snapshot — "No score changes recorded" message
5. Select a country not in history.json — section is hidden
6. Dates are formatted readably (not raw ISO)
7. Verify scores in changelog match what the timeline slider shows at those dates
8. Check vertical overflow: if a country has many changes, the panel scrolls properly
