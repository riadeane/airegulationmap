# UI/UX Redesign — Design Document

**Date:** 2026-02-22
**Status:** Approved

## Goal

Redesign the AI Regulation Map from a basic, flat layout into a professional, authoritative dark-dashboard experience. The target feel is "policy think tank" — data-dense, credible, not soulless.

---

## 1. Overall Layout

Full-viewport dark layout with no white page margins. Three zones:

```
┌─────────────────────────────────────────────────────────┐
│  HEADER  [logo/title]              [search]  [controls] │
├──────────────────────────────────┬──────────────────────┤
│                                  │                      │
│         WORLD MAP                │   COUNTRY PANEL      │
│         (70% width)              │   (30% width)        │
│                                  │                      │
├──────────────────────────────────┴──────────────────────┤
│  TIMELINE SLIDER (full width)                           │
└─────────────────────────────────────────────────────────┘
```

- The right country panel is always visible with a placeholder ("Select a country") — no layout shift on click
- Timeline lives in a slim strip below the map

---

## 2. Color Palette

| Token | Value | Usage |
|---|---|---|
| Background | `#0f1117` | Page/map canvas |
| Surface | `#1a1f2e` | Panels, header, cards |
| Border | `#2a3045` | Dividers, subtle outlines |
| Accent | `#4f9cf9` | Selected country outline, links, active states |
| Text primary | `#e8eaf0` | Headings, key data |
| Text secondary | `#7a8299` | Labels, metadata |
| No data | `#2a2f3d` | Countries with no score data |

**Choropleth:** Steel gray (`#8a9ab5`) → Amber gold (`#f0c040`)
Low regulation scores = neutral gray; high scores = warm amber. Avoids dark-on-dark blending problems and avoids political red/green associations.

---

## 3. Typography

- **Font:** Inter or DM Sans (Google Fonts, CDN) — clean, modern, professional
- **Section labels:** Small caps / muted uppercase (`#7a8299`)
- **Score values:** Monospaced — makes numbers feel precise
- **Body/descriptions:** Regular weight, `#e8eaf0`

---

## 4. Map Interactions

- **Hover:** Subtle brightness lift + `#2a3045` border — no jarring color change
- **Selected:** `#4f9cf9` 2px outline, persists while panel is open
- **Hover tooltip:** Small dark card near cursor — country name + current score, disappears on mouseout
- **Zoom/pan:** Unchanged (already works well)

---

## 5. Country Panel (Right Sidebar)

```
┌──────────────────────────────┐
│  🇩🇪  Germany                │
│  Last updated: Jan 2026      │
├──────────────────────────────┤
│  OVERALL SCORE               │
│  ████████░░  3.8 / 5         │
├──────────────────────────────┤
│  DIMENSIONS                  │
│  Regulation Status    ●●●●○  │
│  Policy Lever         ●●●○○  │
│  Governance Type      ●●●●○  │
│  Actor Involvement    ●●●○○  │
│  Enforcement Level    ●●●●●  │
├──────────────────────────────┤
│  SUMMARY                     │
│  [description text]          │
├──────────────────────────────┤
│  KEY LEGISLATION             │
│  • EU AI Act (2024)          │
├──────────────────────────────┤
│  SOURCE ↗                    │
└──────────────────────────────┘
```

- Dot indicators (filled/empty circles) for each dimension score
- Horizontal progress bar for overall score
- Clear section labels in muted uppercase
- Source link opens in new tab

---

## 6. Header & Controls

**Header:** Slim top bar — title left-aligned, controls right-aligned
**Score selector:** Small dropdown button (replaces native `<select>`)
**Filter:** Popover with min/max sliders — hidden until clicked, reduces visual clutter

**Search behavior:** Expands on focus; typing highlights matching countries with blue accent outline and dims non-matching countries on the map.

---

## 7. Timeline Strip

```
┌─────────────────────────────────────────────────────────┐
│  ◀  ──────●──────────────────────────  ▶   Jan 2026    │
└─────────────────────────────────────────────────────────┘
```

Slim dark strip below map. Play/pause left, date label right, slider track styled to match palette.

---

## Files to Modify

- `style.css` — Full rewrite of color tokens, typography, layout, component styles
- `index.html` — Restructure layout (header bar, two-column map+panel, timeline strip), add Google Font link
- `map.js` — Update hover/selection interactions, tooltip, search highlight behavior, dropdown/popover controls
