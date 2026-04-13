# Full-Text Search Across Regulation Data

## Why Build This

Researchers need to find all countries mentioning specific policy concepts — "facial recognition", "sandbox", "high-risk AI", "foundation model", "algorithmic impact assessment". The current search only matches country names. Thematic cross-policy search is a primary researcher workflow and no existing tracker supports it. This feature turns the app into a policy research tool, not just a country lookup.

## Research Links

- IAPP AI Governance Tracker — tracks law names but has no keyword search across policy text
- OECD AI Policy Observatory — keyword search is limited to their curated summaries
- Stanford HAI — no search at all, static PDF/report format

## Current State

- `src/controls/search.js` (116 lines) handles country name search:
  - Filters `sortedCountryNames` from state with prefix-priority matching
  - Max 8 suggestions in dropdown
  - Keyboard nav (↑↓, Enter, Escape)
  - Global shortcuts: `/` or `Cmd+K` to focus, `←→` to cycle countries
  - `updateSearchHighlight()` dims non-matching countries on map
- `regulationData` in state contains text fields: `regulationStatus`, `policyLever`, `governanceType`, `actorInvolvement`, `enforcementLevel`, `specificLaws`
- DOM: `#search-input` is an `<input>` in the header, `#search-suggestions` is the dropdown `<ul>`

## Implementation Approach

### Step 1: Build a text search index at load time

Create `src/data/searchIndex.js`:

```js
/**
 * Builds a simple inverted index mapping lowercased tokens/phrases
 * to country names + field names + snippet.
 *
 * Structure: Map<string, Array<{country, field, snippet}>>
 * We don't need a full inverted index — just store per-country
 * searchable text for substring matching.
 */
export function buildSearchIndex(regulationData) {
  const index = [];
  for (const [country, data] of Object.entries(regulationData)) {
    const fields = [
      'regulationStatus', 'policyLever', 'governanceType',
      'actorInvolvement', 'enforcementLevel', 'specificLaws'
    ];
    for (const field of fields) {
      const text = data[field];
      if (!text || text.length < 10) continue;
      index.push({
        country,
        field,
        text: text.toLowerCase(),
        original: text,
      });
    }
  }
  return index;
}

/**
 * Search the index for a query string.
 * Returns array of { country, field, snippet } with highlighted match.
 */
export function searchRegulationText(index, query, maxResults = 20) {
  if (!query || query.length < 3) return [];
  const q = query.toLowerCase();
  const results = [];
  const seen = new Set(); // dedupe by country

  for (const entry of index) {
    const pos = entry.text.indexOf(q);
    if (pos === -1) continue;

    // Extract snippet around match (±60 chars)
    const start = Math.max(0, pos - 60);
    const end = Math.min(entry.original.length, pos + query.length + 60);
    let snippet = (start > 0 ? '…' : '') +
      entry.original.slice(start, end) +
      (end < entry.original.length ? '…' : '');

    results.push({
      country: entry.country,
      field: entry.field,
      snippet,
      matchStart: pos - start + (start > 0 ? 1 : 0),
      matchLength: query.length,
    });

    if (results.length >= maxResults) break;
  }

  return results;
}
```

### Step 2: Extend search.js to support dual modes

Modify `src/controls/search.js`:

**Add mode detection**: If the query starts with `"` or is ≥3 chars and doesn't match any country name prefix, switch to full-text mode. Alternatively, add a toggle icon/button next to the search input.

Recommended approach — **unified search with sections**:
- First section: "Countries" — existing country name matches (max 4)
- Second section: "Regulation text" — full-text matches with snippets (max 6)
- Separated by a `<li class="search-divider">` element

```js
import { buildSearchIndex, searchRegulationText } from '../data/searchIndex.js';

let textIndex = null;

export function initSearch() {
  // ... existing init code ...

  // Build text index after regulation data loads
  on('regulationData', (regData) => {
    textIndex = buildSearchIndex(regData);
  });
}

function updateSuggestions(query) {
  // Country name matches (existing logic)
  const countryMatches = getCountryMatches(query).slice(0, 4);

  // Full-text matches
  const textMatches = textIndex
    ? searchRegulationText(textIndex, query, 6)
    : [];

  renderSuggestions(countryMatches, textMatches);
}
```

### Step 3: Update suggestion rendering

In the suggestion dropdown:

```html
<ul id="search-suggestions">
  <!-- Country matches -->
  <li class="search-section-label">Countries</li>
  <li class="search-suggestion" data-country="Germany">Germany</li>
  ...
  <!-- Text matches -->
  <li class="search-section-label">Mentions</li>
  <li class="search-suggestion text-match" data-country="France">
    <span class="match-country">France</span>
    <span class="match-field">Specific Laws</span>
    <span class="match-snippet">…the <mark>AI Act</mark> establishes a risk-based…</span>
  </li>
  ...
</ul>
```

### Step 4: Handle text match selection

When a user clicks a text match result:
1. Set `selectedCountry` to that country (opens the panel)
2. Optionally scroll the panel to the matching section/field

### Step 5: Highlight matching countries on map

When text search has results, call `updateSearchHighlight()` with the set of matching country names to dim non-matching countries — reusing existing infrastructure.

### Step 6: Style text match results

Add to `src/styles/_header.css` (search section):

```css
.search-section-label {
  padding: 4px 12px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  pointer-events: none;
}

.text-match {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.match-country {
  font-weight: 600;
}

.match-field {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.match-snippet {
  font-size: 0.8rem;
  line-height: 1.3;
  color: var(--text-secondary);
}

.match-snippet mark {
  background: var(--highlight, #d4a04a33);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}
```

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/data/searchIndex.js` |
| Modify | `src/controls/search.js` — integrate text search, dual-section rendering |
| Modify | `src/styles/_header.css` — text match result styles |
| Modify | `src/main.js` — pass regulationData to build search index (may already happen via state subscription) |

## Key Decisions / Open Questions

1. **Unified vs. separate search modes**: Plan recommends unified — country matches appear first, text matches appear below with a divider. This avoids a mode toggle and feels more natural. The implementing agent should verify this UX feels right.

2. **Minimum query length for text search**: 3 characters to avoid excessive results. Country name search currently triggers at 2 chars — keep that.

3. **Snippet extraction**: ±60 characters around the first match. Should the snippet use `<mark>` to highlight the matched term? Yes — include a `highlightMatch()` helper.

4. **Deduplication**: If "sandbox" appears in multiple fields for France, show the best match only (shortest field text, or first match). Dedupe by country in the results.

5. **Performance**: With ~196 countries × 6 fields, the index will have ~1000 entries. Simple `indexOf` is fast enough — no need for a library like Fuse.js. If performance becomes an issue, pre-tokenize.

6. **Search input placeholder**: Update from "Search countries…" to "Search countries or policies…" to signal the new capability.

## Verification

1. Type "sandbox" → text matches show countries with sandbox in their regulation text
2. Type "Ger" → "Germany" appears as country match; text matches may also appear
3. Click a text match for France → country panel opens with France selected
4. Map dims countries not in the text search results
5. Clear search → map returns to normal
6. Type "xy" (2 chars) → only country matches, no text search (minimum 3 chars)
7. Keyboard navigation (↑↓) works across both sections
8. Verify snippet shows `<mark>` highlighting around matched term
9. Performance: search for "AI" (will match many entries) → results appear within 100ms
