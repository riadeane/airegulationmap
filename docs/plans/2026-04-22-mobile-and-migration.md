# Mobile UX + Architecture Plan

**Date:** 2026-04-22
**Status:** Proposal — awaiting direction on scope and tooling.
**Context:** The weekend polish ([2026-04-17-polish-and-onramp.md](./2026-04-17-polish-and-onramp.md)) shipped a help overlay, empty-panel on-ramp, and display-layer copy normalizer. In review, the mobile UX surfaced as the next honest weakness: a keyboard-shortcut overlay is meaningless on a phone, the empty-panel intro lives below the fold on cold load, and there's no first-class way to add a country to comparison without the desktop-only shift-click shortcut. A tactical fix has already landed (`910550d`: hide the `?` button and its intro step on coarse pointers; rewrite the intro copy). This plan scopes the fuller pass and asks whether it's the right moment to migrate off vanilla JS.

---

## 1. Diagnosis — what's actually broken on mobile

Findings from reading the repo and the Vite preview at 375×812:

| # | Problem | Severity | Where it lives |
|---|---------|----------|----------------|
| 1 | Empty-panel on-ramp is invisible on cold load. `#country-panel` sits below `#map-wrapper` in the flex column and `min-height: 50vh` on the map pushes the intro off-screen. | **High** | [src/styles/_responsive.css:16-31](../../src/styles/_responsive.css) |
| 2 | No touch-first way to add a country to comparison. Desktop uses shift-click; on mobile the user has to select a country first, then tap `+ Compare`, then deselect, then select another. Nothing communicates this path. | **High** | [src/comparison/index.js](../../src/comparison/index.js), [src/panel/index.js](../../src/panel/index.js) |
| 3 | Selecting a country doesn't scroll the panel into view — the user taps a country, "nothing happens," scrolls down to discover the panel updated. | **High** | [src/panel/index.js:123-129](../../src/panel/index.js) |
| 4 | Comparison panel on narrow viewports: `#comparison-panel` is `min-width: 380px` and sits next to `#country-panel`. Two 380px panels on a 375px screen is a scroll overflow event. | **High** | [src/styles/_comparison.css:4](../../src/styles/_comparison.css) |
| 5 | Header cramming: on `<768px` the header reflows to 3 rows (brand / search / score+filter+theme). It works, but the `196 countries` badge, `LAST UPDATED: YYYY-MM-DD`, and the Literata title compete for row 1. Feels busy. | Medium | [src/styles/_responsive.css:42-73](../../src/styles/_responsive.css) |
| 6 | No back-affordance from an opened country panel. The Esc keyboard path exists; nothing touch-equivalent. | Medium | Global |
| 7 | Timeline strip is fixed-height 50px at the bottom and takes screen real estate even when not scrubbed. On a 667px iPhone SE-class device, that's ~7.5% of vertical space gone. | Low | [src/styles/_timeline.css](../../src/styles/_timeline.css) |
| 8 | Hit-target sizes are already bumped to 44px for score/filter/theme/dimension/search suggestions via the existing `@media (pointer: coarse)` block. Good. No action needed. | ✓ Fixed | [src/styles/_responsive.css:91-110](../../src/styles/_responsive.css) |
| 9 | Keyboard-shortcut UI (`?` button, intro step 03) now hidden on coarse pointers. | ✓ Fixed (910550d) | [src/styles/_responsive.css](../../src/styles/_responsive.css) |

**Conclusion:** problems 1–4 are blocking. Problems 5–7 are quality-of-life. The fix for 1–4 requires a new interaction model for mobile, not just CSS tuning.

---

## 2. Design direction — what mobile should look like

Four principles, each anchored in the existing design doc (`.impeccable.md`, CLAUDE.md).

### Principle A — the map stays the protagonist on mobile

No hamburger-menu stowing the map behind a drawer. The map is the thing. Mobile should open to the full viewport filled with the choropleth, legend anchored bottom, header compressed to brand + search + one overflow menu.

### Principle B — the panel becomes a bottom sheet, not a section below

Right now the panel is a stacked section. On tap, it becomes invisible below the fold. Replace that with a bottom sheet — a native-feeling drawer that slides up on country select, covers ~60% of viewport height by default, can be dragged to ~90% for full reading, and swipes down to dismiss. Keeps the map visible in the upper portion during comparison browsing.

### Principle C — explicit compare mode instead of hidden shift-click

Introduce a **Compare** toggle in the header (or a floating action button at the bottom-right). Flipping it on changes selection semantics: taps add to the comparison list instead of replacing the selected country. Flipping off (or filling all four slots) drops back to normal. Desktop shift-click remains as the power-user shortcut, but no longer the only path.

### Principle D — panel state is in the URL, back button dismisses

A tapped country sets `?country=Germany` (already the case). On mobile, the browser back button should close the bottom sheet without leaving the page. This is a history-stack concern: the state sync needs to `pushState` for each country selection so that popstate closes the sheet. Currently `initUrlSync` uses `replaceState` — it preserves the URL but produces no navigable history.

---

## 3. Architecture question — stay vanilla, or migrate?

The user is open to React. Worth stress-testing whether React is the right answer, or whether a smaller lever gets most of the benefit.

### Current stack, honestly assessed

- **~15 modules.** Small. Legible. No dependency hell.
- **Centralized store at [src/state/store.js](../../src/state/store.js):** 40 lines, pub-sub, works. Mirrors Zustand/Redux at 1% the ceremony.
- **D3 + SVG map renderer:** imperative, and should stay imperative — React's reconciliation over 196 SVG paths is an anti-pattern. Observable-style islands are the right fit.
- **No test suite.** First thing a migration would expose. Vanilla-or-React, this is a hole.
- **No TypeScript.** Free type-safety win is available without any framework change.

### Migration options, sharpest-to-softest

#### Option 1 — React (full)

- **Pros:** ecosystem depth (react-spring for bottom-sheet physics, tanstack-router for URL-as-state, radix-ui for the help dialog we just wrote by hand), contributor accessibility, TS story is mature.
- **Cons:** ~45 KB gzipped baseline, new build complexity, forces a wrap-or-rewrite decision for the D3 map, realistically 1–2 weeks of porting before parity.
- **Verdict:** the right long-term answer if mobile grows into a serious target or if a second contributor joins.

#### Option 2 — Preact (full)

- **Pros:** same mental model as React, 3 KB gzipped, drop-in `preact/compat` supports most React libraries.
- **Cons:** smaller ecosystem for niche libraries; `preact/compat` occasionally leaks. Still a full rewrite of the UI layer.
- **Verdict:** rational middle path if the user wants React's mental model without the weight.

#### Option 3 — Solid

- **Pros:** fine-grained reactivity matches the existing pub-sub store almost exactly; fastest of the three; 7 KB.
- **Cons:** ecosystem thinner than Preact; fewer contributors know it.
- **Verdict:** technically elegant, socially awkward. Skip unless the user specifically likes it.

#### Option 4 — Stay vanilla, add targeted libraries

- Add **TypeScript** (`vite-plugin-checker`, `tsconfig` with `allowJs`) for incremental typing.
- Add **[vaul-vanilla](https://github.com/emilkowalski/vaul)** or a 200-line hand-rolled bottom-sheet component.
- Add **history-stack management** via a 30-line helper around `pushState`/`popstate`.
- Keep everything else.
- **Pros:** no migration; every fix is additive; bundle stays tiny; existing code legible.
- **Cons:** long-tail features (dark-mode variants, search-within-descriptions, saved views) eventually hit the ceiling of vanilla composability.
- **Verdict:** viable for 6–12 more months; the right answer right now if the mobile pass can be done without a framework.

### The D3 map constraint applies to all of the above

In every migration option, the map renderer ([src/map/renderer.js](../../src/map/renderer.js)) stays imperative. React wraps it in a ref-based component that updates via effect hooks on state change, never via JSX diff. This is the Observable pattern — it's fine, and it's what every serious React-D3 integration does.

---

## 4. Work streams

Four ways to slice the work. Pick one or sequence.

### Stream A — tactical mobile pass, no framework change (~1 weekend)

Fixes problems 1, 3, 5, 6 without touching the stack. Leaves problem 2 (no touch-first compare) and problem 4 (side-by-side panels) for Stream B.

**Deliverables:**
- Scroll-into-view on country select when viewport is `<768px`.
- Collapse `196 countries` badge + `LAST UPDATED` into a single line of small-caps text under the `h1`. Drop the badge visual chrome on mobile.
- Close-button (`×`) in the country panel header on mobile, paired with the existing Esc path.
- Hide the comparison panel entirely on `<768px` until Stream B lands a proper mobile flow. Comparison becomes desktop-only for now — honest and shippable. Add an inline note in the add-bar explaining this.

**Files touched:** `_responsive.css`, `_header.css`, `_panel.css`, `_comparison.css`, `src/panel/index.js` (scroll-into-view), `index.html` (close button).

**Non-goals:** no bottom sheet, no compare mode toggle, no routing changes.

### Stream B — bottom-sheet + compare mode + URL history (~1 week, vanilla or Preact)

Fixes problems 2 and 4. Touch-first compare mode. Bottom sheet for the country panel.

**Deliverables:**
- Bottom-sheet component for `#country-panel` on `<768px`. Three snap points (peek 25%, default 60%, expanded 90%). Drag-to-dismiss. Vaul-vanilla or hand-rolled.
- Compare mode toggle in the header. When on, taps append to `comparisonCountries` instead of setting `selectedCountry`. Visual affordance: the selected countries show color dots on the map matching their comparison slot.
- Full-screen comparison view on mobile (separate route: `?compare=A,B,C,D` → renders the comparison as a tab bar + single-country detail per tab, swipeable).
- Replace `history.replaceState` with `pushState` in `initUrlSync` for country selection so the back button works as a panel-dismiss on mobile.

**Decision point:** do Stream B in vanilla (add ~300 lines of gesture/sheet code to `src/controls/`) or pull in Preact now and rewrite the panel + comparison in it? Either works; the former is cheaper today, the latter pays down the Stream C path.

### Stream C — React (or Preact) migration foundation (~1 week, as a proof-of-concept)

Introduces React to the project without rewriting everything. Ports one component end-to-end to validate the approach.

**Deliverables:**
- Add `react` + `react-dom` (or Preact) to `package.json`. Keep Vite.
- Add a `tsconfig.json` with `allowJs: true`, `checkJs: false`. TypeScript is a free add; JS files keep working.
- Wrap the existing DOM in `<App />` — the root component just calls the existing vanilla init functions. This establishes a React tree without touching any existing module.
- Port **one** component to React: the help overlay ([src/controls/helpOverlay.js](../../src/controls/helpOverlay.js)) is the cleanest candidate — self-contained, uses native `<dialog>`, no state-store integration needed. Validates the pattern.
- Add `@testing-library/react` + Vitest. Write 3 tests for the ported overlay as the testing baseline.
- Document the migration pattern in a `CONTRIBUTING.md` so future ports have a template.

**Explicitly not in Stream C:** porting the map, the panel, the comparison, the controls. Those come in Stream D.

### Stream D — full React rewrite (~2–3 weeks, optional)

Only if Stream C proves out. Ports every remaining module to React. D3 map stays imperative as a ref-based island. Store becomes Zustand or stays as-is behind a `useSyncExternalStore` hook.

**Deliverables:**
- Panel, header controls, comparison, timeline, search, theme toggle — all in React.
- URL sync moved to tanstack-router or react-router (decision based on how much the user wants file-based routing).
- Bottom-sheet physics via [react-spring](https://www.react-spring.dev/) or [vaul](https://vaul.emilkowal.ski/).
- Unit tests for every ported component.
- One visual regression pass (playwright + light/dark screenshots).

---

## 5. Recommendation

**Do Stream A now, Stream B next, defer C/D until one of these triggers fires:**

1. A second contributor joins and vanilla JS becomes a recruitment friction.
2. A feature on the backlog needs something React does well that vanilla doesn't (scroll-driven storytelling, rich comparison sorting, editable confidence annotations).
3. The current codebase hits the 25-module ceiling where pub-sub navigation starts to feel like tribal knowledge.

Today's honest answer: the site is small, the store pattern works, and the mobile problems are mostly layout + interaction-model issues that Stream A and B can solve without a framework. The best version of "migrate to React" is one that's motivated by a concrete feature need, not by an intuition that the codebase should look more like peers.

**Tactical sequencing:**

| When | Stream | Effort |
|------|--------|--------|
| This weekend | A (tactical mobile) | 1 weekend |
| Following weekend | B part 1 (bottom sheet) | 1 weekend |
| A month out | B part 2 (compare mode + URL history) | 1 weekend |
| Q3 2026 or when a trigger fires | C (React foundation) | 1 week |
| After C proves out | D (full rewrite) | 2–3 weeks |

---

## 6. Non-goals

- **Separate mobile app.** No React Native, no PWA-to-app wrappers. Responsive web is the target.
- **Hamburger menu.** Dismissing the map behind a drawer contradicts Principle 1 of the existing design doc.
- **Custom gesture library.** If Stream B goes vanilla, hand-roll a small sheet component — don't pull in a 30 KB gesture framework for one bottom sheet.
- **Mobile-only features.** Anything worth building should exist on both. If a feature only makes sense on touch (e.g. a pinch-to-reveal detail), it's not worth building.

---

## 7. Open questions for the user

1. **Framework preference.** If Stream C runs, React or Preact? Preact gives 90% of the benefit at 5% of the bundle. React gives ecosystem depth and contributor familiarity.
2. **Comparison flow on mobile.** Two mental models on offer: (a) full-screen swipeable country pages with a top tab bar, or (b) the existing radar-chart view unchanged, with the country chips stacking vertically. (a) reads more native; (b) is less work.
3. **Back-button dismissal.** Pushing a history entry per country select means the back button steps through selection history. Is that the desired behavior, or should the back button exit the app / go to the previous page instead?
4. **Scope of the empty-panel intro on mobile.** Since it's below the fold, the intro has to either (a) get a dedicated pre-map card that dismisses on first tap, or (b) get quietly dropped on mobile. (a) is more welcoming; (b) is simpler and matches the "map is protagonist" principle.
5. **TypeScript.** Willing to add `allowJs: true` TS now regardless of Stream C? It's a free add and provides a better migration substrate.

---

## 8. Success criteria for each stream

**Stream A done when:**
- Tapping a country on mobile scrolls the panel into view.
- Header on `<768px` shows brand + metadata in a single compact row.
- Country panel has an explicit close affordance on mobile.
- Comparison panel is cleanly hidden with an explanatory note on mobile.
- No visual regressions on desktop (1440×900 screenshots match).

**Stream B done when:**
- Bottom sheet slides up on country tap with three snap points.
- Compare mode toggle exists in the header; tapping countries while on adds them to comparison.
- Browser back button closes an open panel on mobile without leaving the page.
- Comparison page renders full-screen on mobile with a swipeable tab bar.

**Stream C done when:**
- React (or Preact) and TS are in `package.json`; Vite builds both JS and TSX.
- The help overlay is a React component with three Vitest tests passing.
- A `CONTRIBUTING.md` page explains the migration pattern.
- The existing vanilla UI is visually unchanged from the user's perspective.

**Stream D done when:**
- No `src/controls/*.js` files remain — all components are TSX.
- D3 map is a ref-based React component, mounted once.
- A visual regression test suite exists for light and dark themes.
