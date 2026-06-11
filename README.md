# AI Regulation Map

An interactive world map showing the current state of AI regulation in every country. Explore how nations are approaching AI governance across six dimensions — from enforcement rigor to the types of policy instruments in use.

Live at [airegulationmap.org](https://airegulationmap.org)

## What it does

- Choropleth world map colored by regulation score, built with D3.js and TopoJSON
- Six scoring dimensions: regulation status, policy lever, governance type, actor involvement, enforcement level, and a composite average
- Click any country to see detailed descriptions, relevant laws, source links, and a per-country score change history
- Compare up to four countries side-by-side on a radar chart
- Full-text search across regulation text ("sandbox", "facial recognition", …) alongside country-name search
- Filter by score range or by bloc (EU, G7, G20, ASEAN, AU, BRICS+, NATO, OECD) with aggregate stats
- Cross-dimension scatter plot to explore governance clusters
- One-click CSV/JSON export of the full or filtered dataset
- Timeline slider to view how scores have changed over time
- Shareable URLs, formatted citations (APA/Chicago/MLA), and light/dark themes
- Data is automatically re-researched monthly using Claude to keep it current

## Quick start

```bash
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173) in your browser.

## Project structure

```
src/              TypeScript frontend (no framework)
  main.ts           Entry point
  state/store.ts    Centralized state with event bus
  map/              Map rendering, legend, zoom, tooltip
  panel/            Country detail panel (scores, text, changelog)
  comparison/       Side-by-side comparison panel + radar chart
  scatter/          Cross-dimension scatter plot
  controls/         Search, score selector, filter, blocs, export, timeline
  styles/           CSS partials
  constants.ts      Shared labels, options, regex
  data/             CSV + history loading, search index, blocs

public/           Static data files served as-is
  scores.csv        Numeric scores (1–5) per country
  regulation_data.csv  Text descriptions, laws, sources
  history.json      Timestamped score snapshots for timeline
  data/country_names.json  Country name aliases
  data/blocs.json   Bloc membership (EU, G20, …)

scripts/          Python data pipeline
  update_data.py    CLI entry point
  regulation_pipeline/  Modules for API calls, parsing, staleness

tests/            Vitest unit tests (frontend) + pytest (pipeline)
```

## Development

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript (strict)
npm test           # Vitest unit tests
python -m pytest   # pipeline tests (pip install -r requirements-dev.txt)
```

CI runs lint, tests, and the production build on every push and pull request.

## Updating the data

The regulation data is refreshed automatically on the 1st of each month via GitHub Actions. You can also run it manually:

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your-key

python scripts/update_data.py                              # update stale countries
python scripts/update_data.py --countries "Germany,France"  # specific countries
python scripts/update_data.py --dry-run                     # preview without writing
python scripts/update_data.py --force                       # re-research everything
```

## Building for production

```bash
npm run build    # outputs to dist/
npm run preview  # preview the build locally
```

Deployed on Cloudflare Pages.

## License

GPL-3.0
