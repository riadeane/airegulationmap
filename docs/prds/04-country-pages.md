# PRD 04: Static country pages

Status: Implemented (September 2026, #48). Owner: unassigned. Depends on: none.

## Problem

The app is one page. A country is a query parameter on `index.html`. Search
engines index one document, links in papers point at a JavaScript app, and a
reader without JavaScript sees nothing.

## Users and job

Researchers who cite a country entry in a footnote and want a stable URL.
Readers who arrive from search for "Kenya AI regulation".

## Goal

Every country has a static HTML page at `/country/<slug>/` generated at build
time from the data files. The page reads like a reference entry and links into
the app.

## Non-goals

- A second app. The page is static HTML with no data loading.
- Replacing the panel. The panel stays the interactive surface.

## Requirements

1. **Generation.** A build step runs before `vite build` and writes
   `country/<slug>/index.html` for every row in `scores.csv`. Slug: lowercase,
   ASCII, hyphens; keep a `slug -> name` map in `public/data/country_slugs.json`
   so the app can link the other way.
2. **Content.** Title, ISO codes, six scores, the five text sections from
   `regulation_data.csv`, specific laws, sources (official first, using the
   classifier in `src/data/sources.ts`), confidence, last updated, and the
   sub-indicators when present. Include rationales if PRD 03 has landed.
3. **Links.** "Open on the map" to `index.html?country=<name>`. "Compare with
   ..." links for the country's bloc peers. Prev/next country links in
   alphabetical order.
4. **Metadata.** `<title>`, meta description, canonical URL, Open Graph tags,
   and JSON-LD `Dataset` markup with the scores as `variableMeasured`.
5. **Style.** Reuse the tokens and typography of `methodology.html`. Both
   themes via the shared `localStorage.theme` toggle.
6. **Sitemap.** Write `public/sitemap.xml` with every country page plus the
   top-level pages.
7. **Deep link from the app.** The panel header gets a "Permanent link" action
   that copies `/country/<slug>/`.

## Design notes

- Put the generator in `scripts/build_pages.ts`, run with `tsx` or `node`
  from an npm `prebuild` script. It reads the same CSV parser as the app
  (`src/data/loader.ts`) to avoid two parsers.
- Cloudflare Pages serves `dist/country/<slug>/index.html` at `/country/<slug>/`
  with no extra config.
- Keep the template a single function that returns a string. No template
  engine.

## Acceptance criteria

- `npm run build` produces 196 pages and a sitemap.
- A page renders without JavaScript and passes an HTML validator.
- Lighthouse SEO score at or above 95 on a sample page.
- Vitest covers the slug function and the source ordering.

## Open questions

- Should pages include a static SVG of the country's radar chart? Proposed:
  defer.
