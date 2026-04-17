# Cross-Dimension Scatter Plot

## Why Build This

A scatter plot of any two governance dimensions reveals regulatory clusters — e.g., countries with high enforcement but low actor involvement may follow an authoritarian AI governance model, while high participation + low enforcement suggests a consultative approach. No existing tracker offers this cross-dimension visual analysis. It enables hypothesis testing ("Does enforcement correlate with governance centralization?") that researchers currently do manually in R/Stata after extracting data.

## Research Links

- arXiv 2505.00174 — quantitative comparable scores across dimensions listed as top-5 need
- AGILE Index — proposes multi-dimensional governance scoring but provides no interactive visualization
- Stanford HAI — static tables, no cross-dimension scatter

## Current State

- `scoreData` contains 6 numeric dimensions (1–5 scale) per country
- `src/constants.js` has `SCORE_OPTIONS` (dropdown items) and `ATTRIBUTE_LABELS` (display names)
- `src/controls/scoreSelector.js` builds the existing score dimension dropdown
- D3.js v7 is loaded and used extensively
- `src/map/renderer.js` handles country selection via state
- No existing scatter plot or secondary visualization panel

## Implementation Approach

### Step 1: Add HTML container

In `index.html`, add after or alongside the map:

```html
<div id="scatter-container" class="scatter-container" hidden>
  <div class="scatter-header">
    <h3>Dimension Explorer</h3>
    <div class="scatter-controls">
      <label>X: <select id="scatter-x"></select></label>
      <label>Y: <select id="scatter-y"></select></label>
      <button id="scatter-close" aria-label="Close scatter plot">×</button>
    </div>
  </div>
  <div id="scatter-chart"></div>
</div>
```

### Step 2: Add a toggle button to the header

In `index.html` header controls:

```html
<button id="scatter-toggle" class="header-btn" title="Scatter plot">⊞ Scatter</button>
```

### Step 3: Create scatter plot module

Create `src/visualizations/scatter.js`:

```js
import * as d3 from 'd3';
import { getState, setState, on } from '../state/store.js';
import { ATTRIBUTE_LABELS, SCORE_OPTIONS } from '../constants.js';

const MARGIN = { top: 20, right: 20, bottom: 50, left: 50 };
const WIDTH = 500;
const HEIGHT = 400;

let svg, xScale, yScale, xAxis, yAxis;
let currentX = 'enforcementLevel';
let currentY = 'regulationStatus';

export function initScatter() {
  // Populate axis selectors
  const dims = SCORE_OPTIONS.filter(o => o.value !== 'averageScore');
  ['scatter-x', 'scatter-y'].forEach((id, i) => {
    const select = document.getElementById(id);
    dims.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.value;
      opt.textContent = d.label;
      select.appendChild(opt);
    });
    select.value = i === 0 ? currentX : currentY;
    select.addEventListener('change', () => {
      if (id === 'scatter-x') currentX = select.value;
      else currentY = select.value;
      updateScatter();
    });
  });

  // Toggle visibility
  document.getElementById('scatter-toggle').addEventListener('click', () => {
    const container = document.getElementById('scatter-container');
    container.hidden = !container.hidden;
    if (!container.hidden && !svg) createScatter();
    else if (!container.hidden) updateScatter();
  });

  document.getElementById('scatter-close').addEventListener('click', () => {
    document.getElementById('scatter-container').hidden = true;
  });

  // Re-render when data changes
  on('scoreData', () => { if (svg) updateScatter(); });
  on('currentAttribute', () => { /* optionally sync one axis */ });
}

function createScatter() {
  const chart = d3.select('#scatter-chart');
  svg = chart.append('svg')
    .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  xScale = d3.scaleLinear().domain([0.5, 5.5]).range([MARGIN.left, WIDTH - MARGIN.right]);
  yScale = d3.scaleLinear().domain([0.5, 5.5]).range([HEIGHT - MARGIN.bottom, MARGIN.top]);

  // Axes
  xAxis = svg.append('g')
    .attr('transform', `translate(0,${HEIGHT - MARGIN.bottom})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.format('d')));

  yAxis = svg.append('g')
    .attr('transform', `translate(${MARGIN.left},0)`)
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('d')));

  // Axis labels (updated dynamically)
  svg.append('text').attr('id', 'scatter-x-label')
    .attr('x', WIDTH / 2).attr('y', HEIGHT - 5)
    .attr('text-anchor', 'middle').attr('font-size', '0.8rem');

  svg.append('text').attr('id', 'scatter-y-label')
    .attr('transform', `rotate(-90)`)
    .attr('x', -HEIGHT / 2).attr('y', 14)
    .attr('text-anchor', 'middle').attr('font-size', '0.8rem');

  updateScatter();
}

function updateScatter() {
  const { scoreData, selectedCountry, filterMin, filterMax, currentAttribute } = getState();

  // Update axis labels
  svg.select('#scatter-x-label').text(ATTRIBUTE_LABELS[currentX]);
  svg.select('#scatter-y-label').text(ATTRIBUTE_LABELS[currentY]);

  const countries = Object.entries(scoreData).map(([name, scores]) => ({
    name,
    x: scores[currentX],
    y: scores[currentY],
    avg: scores.averageScore,
    visible: scores[currentAttribute] >= filterMin && scores[currentAttribute] <= filterMax,
  })).filter(d => d.x != null && d.y != null);

  // Add jitter to reduce overlap on integer grid
  const jitter = () => (Math.random() - 0.5) * 0.25;

  const dots = svg.selectAll('circle.scatter-dot')
    .data(countries, d => d.name);

  dots.enter()
    .append('circle')
    .attr('class', 'scatter-dot')
    .attr('r', 5)
    .attr('cx', d => xScale(d.x + jitter()))
    .attr('cy', d => yScale(d.y + jitter()))
    .attr('fill', 'var(--accent, #d4a04a)')
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.5)
    .attr('opacity', d => d.visible ? 0.8 : 0.15)
    .attr('cursor', 'pointer')
    .on('click', (e, d) => setState({ selectedCountry: d.name }))
    .on('mouseenter', showDotTooltip)
    .on('mouseleave', hideDotTooltip)
    .merge(dots)
    .transition().duration(300)
    .attr('opacity', d => d.visible ? 0.8 : 0.15)
    .attr('r', d => d.name === selectedCountry ? 8 : 5)
    .attr('stroke-width', d => d.name === selectedCountry ? 2 : 0.5);

  dots.exit().remove();
}
```

### Step 4: Handle integer score clustering

Since all scores are integers 1–5, a 5×5 grid will have massive dot overlap. Strategies:
- **Jitter** (included above): small random offset so dots spread within each grid cell
- **Bubble size**: encode count or average score as radius
- **Count labels**: show count badges at each grid intersection

Recommend jitter as the primary approach; it's simple and effective.

### Step 5: Style the scatter panel

Create `src/styles/_scatter.css`:

```css
.scatter-container {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-top: 12px;
}

.scatter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.scatter-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.scatter-controls select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 0.85rem;
}

#scatter-chart svg {
  width: 100%;
  max-height: 400px;
}

circle.scatter-dot:hover {
  stroke: var(--accent);
  stroke-width: 2;
}
```

### Step 6: Wire into main.js

```js
import { initScatter } from './visualizations/scatter.js';
// In init():
initScatter();
```

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/visualizations/scatter.js` |
| Create | `src/styles/_scatter.css` |
| Modify | `index.html` — add scatter container and toggle button |
| Modify | `src/main.js` — import and call `initScatter()` |
| Modify | `src/styles/main.css` — import `_scatter.css` |

## Key Decisions / Open Questions

1. **Placement**: Plan puts the scatter plot below the map in a collapsible panel, toggled by a header button. Alternative: replace the map entirely (tab view). Recommend below — researchers want to see map + scatter simultaneously.

2. **Jitter strategy**: Random jitter makes dots non-deterministic. Alternative: use a force-directed layout (`d3.forceSimulation`) to prevent overlap while keeping dots near their true positions. More polished but more complex. Start with simple jitter; upgrade to force layout if it looks messy.

3. **Tooltip on dots**: Show country name, X-axis score, Y-axis score on hover. Reuse `src/map/tooltip.js` functions (`showTooltip`, `hideTooltip`).

4. **Dot click behavior**: Clicking a dot should set `selectedCountry`, opening the country panel. This creates a seamless map↔scatter workflow.

5. **Correlation line**: Optionally show a linear regression line or Pearson's r coefficient. This is a nice-to-have — implement if time permits.

6. **Responsive sizing**: Use `viewBox` (as shown) so SVG scales. On mobile, the scatter should be full-width.

7. **Sync with map filters**: Dots should respect the current score filter — filtered-out countries appear dimmed (opacity 0.15). This is already in the plan.

## Verification

1. Click "Scatter" toggle → scatter panel appears below map
2. Default axes show Enforcement Level (X) vs. Regulation Status (Y)
3. Change X axis to "Policy Lever" → dots reposition with transition
4. Hover a dot → tooltip shows country name and scores
5. Click a dot → country panel opens for that country
6. Apply score filter (3–5) → low-scoring dots dim to 0.15 opacity
7. Selected country's dot is larger and highlighted
8. Close button (×) hides the scatter panel
9. Verify all ~196 countries have dots (no missing data)
10. Integer clustering: dots at (3,3) are spread out via jitter, not stacked
