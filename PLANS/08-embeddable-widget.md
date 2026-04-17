# Embeddable Widget / iframe API

## Why Build This

Researchers, journalists, and policy organizations want to embed the AI regulation map in their own websites, reports, and dashboards. No existing AI governance tracker offers an embeddable widget. An iframe embed mode with URL-parameter configuration would dramatically increase the app's reach and citation frequency — the same way Our World in Data's embeddable charts became the standard for data journalism.

## Research Links

- Our World in Data — embeddable chart pattern is the gold standard for research data visualization
- OECD AI Policy Observatory — no embed option, screenshots only
- Stanford HAI — static images in PDFs, no interactive embeds

## Current State

- The app is a single-page Vite app served from Cloudflare Pages
- All state is managed through `src/state/store.js` with `getState()`/`setState()`
- URL has no current hash/query parameter routing
- The app renders a full-page layout: header, map, panel, footer
- CSS uses custom properties in `src/styles/_tokens.css`
- No existing embed mode or URL parameter handling

## Implementation Approach

### Step 1: Add URL parameter parsing

Create `src/utils/params.js`:

```js
/**
 * Parse URL search params for embed configuration.
 * Example: ?embed=true&attribute=enforcementLevel&country=Germany&filter=3-5&bloc=EU
 */
export function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    embed: params.get('embed') === 'true',
    attribute: params.get('attribute'),
    country: params.get('country'),
    filterMin: params.has('filter') ? +params.get('filter').split('-')[0] : null,
    filterMax: params.has('filter') ? +params.get('filter').split('-')[1] : null,
    bloc: params.get('bloc'),
    hideControls: params.get('controls') === 'false',
    hidePanel: params.get('panel') === 'false',
    theme: params.get('theme'),
  };
}
```

### Step 2: Create embed mode CSS

Create `src/styles/_embed.css`:

```css
body.embed-mode {
  margin: 0;
  padding: 0;
  overflow: hidden;
}

body.embed-mode .site-header {
  display: none;
}

body.embed-mode .site-footer {
  display: none;
}

body.embed-mode #map {
  height: 100vh;
  width: 100vw;
}

body.embed-mode .embed-attribution {
  position: fixed;
  bottom: 4px;
  right: 8px;
  font-size: 0.65rem;
  color: var(--text-muted);
  z-index: 1000;
}

body.embed-mode .embed-attribution a {
  color: var(--accent);
}

body.embed-mode.hide-controls .controls-bar {
  display: none;
}

body.embed-mode.hide-panel #country-panel {
  display: none;
}
```

### Step 3: Apply embed mode in main.js

In `src/main.js`, early in initialization:

```js
import { parseUrlParams } from './utils/params.js';

const params = parseUrlParams();

if (params.embed) {
  document.body.classList.add('embed-mode');
  if (params.hideControls) document.body.classList.add('hide-controls');
  if (params.hidePanel) document.body.classList.add('hide-panel');

  // Add attribution link using safe DOM methods
  const attr = document.createElement('div');
  attr.className = 'embed-attribution';
  const link = document.createElement('a');
  link.href = 'https://airegulationmap.com';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'AI Regulation Map';
  attr.append('Data: ', link);
  document.body.appendChild(attr);
}

// After data loads, apply URL params as initial state
if (params.attribute) setState({ currentAttribute: params.attribute });
if (params.country) setState({ selectedCountry: params.country });
if (params.filterMin != null) setState({ filterMin: params.filterMin });
if (params.filterMax != null) setState({ filterMax: params.filterMax });
if (params.bloc) setState({ selectedBloc: params.bloc });
```

### Step 4: Create an embed code generator

Add a "Share / Embed" button to the header (non-embed mode only). When clicked, show a modal with:

1. **Link**: Current view as a shareable URL with params
2. **Embed code**: iframe snippet with current configuration
3. **Customization**: Checkboxes for controls, panel, dimension selector

Create `src/controls/share.js`:

```js
export function initShare() {
  document.getElementById('share-btn').addEventListener('click', showShareModal);
}

function buildEmbedUrl(options) {
  const base = window.location.origin;
  const params = new URLSearchParams();
  params.set('embed', 'true');

  const { currentAttribute, selectedCountry, filterMin, filterMax } = getState();
  if (currentAttribute !== 'averageScore') params.set('attribute', currentAttribute);
  if (selectedCountry) params.set('country', selectedCountry);
  if (filterMin > 1 || filterMax < 5) params.set('filter', `${filterMin}-${filterMax}`);
  if (options.hideControls) params.set('controls', 'false');
  if (options.hidePanel) params.set('panel', 'false');

  return `${base}?${params}`;
}

function generateIframeCode(url) {
  // Returns a string for the user to copy — not injected into the DOM as HTML
  return `<iframe src="${url}" width="800" height="500" frameborder="0" style="border:1px solid #ddd;border-radius:8px;" loading="lazy"></iframe>`;
}
```

### Step 5: Add share modal HTML

In `index.html`, add a `<dialog>` element for the share modal. Build the modal content with safe DOM construction in JS (createElement + textContent). The modal should contain:
- A readonly text input for the share URL with a Copy button
- A readonly textarea for the iframe embed code with a Copy button
- Checkboxes for "Show controls" and "Show country panel"
- A Close button

### Step 6: Style the share modal

Add to `src/styles/_header.css` or create `src/styles/_share.css`.

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/utils/params.js` |
| Create | `src/controls/share.js` |
| Create | `src/styles/_embed.css` |
| Modify | `src/main.js` — import params, apply embed mode, apply initial state from URL |
| Modify | `index.html` — add share button, share dialog element |
| Modify | `src/styles/main.css` — import `_embed.css` |

## Key Decisions / Open Questions

1. **Attribution requirement**: The embed MUST include a small attribution link back to the main site. This is non-negotiable for data provenance.

2. **Iframe sandboxing**: The embed should work within `<iframe sandbox="allow-scripts allow-same-origin">`. Test that D3 rendering works under these restrictions.

3. **Responsive embed**: The iframe content should adapt to the container size. Use `viewBox` on the SVG and percentage-based sizing.

4. **URL parameter stability**: Once published, embed URLs become a public API. Parameter names and behavior should be considered stable. Document them.

5. **Theme support**: Consider a `?theme=dark` parameter for embeds on dark-background sites. This requires the app's CSS to support both themes via custom properties.

6. **Cross-origin communication**: If the embedding page wants to react to country selections (e.g., show additional info), consider using `postMessage` to communicate from iframe to parent. This is a nice-to-have.

7. **Performance**: Embeds should load quickly. Consider lazy-loading the TopoJSON only when the SVG is in viewport. The current app already loads it eagerly.

8. **Security**: All URL parameters should be validated before use. The `attribute` param should be checked against the known list of valid attribute keys. The `country` param should be checked against `sortedCountryNames`. Never inject URL param values into the DOM as HTML.

## Verification

1. Navigate to `/?embed=true` — header, footer hidden; map fills viewport; attribution visible
2. `/?embed=true&attribute=enforcementLevel` — map shows enforcement level colors
3. `/?embed=true&country=Germany` — Germany pre-selected with panel open
4. `/?embed=true&controls=false&panel=false` — minimal map-only view
5. Copy iframe code from share modal — paste into a test HTML page — renders correctly
6. Share URL reflects current view state (attribute, filter, country)
7. Embed works inside `<iframe sandbox="allow-scripts allow-same-origin">`
8. Attribution link opens main site in new tab
9. Mobile: embed renders properly in small container (300x200px minimum)
10. Invalid URL params (e.g., `?attribute=<script>`) are safely rejected
