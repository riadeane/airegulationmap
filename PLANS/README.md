# Feature Plans

Self-contained implementation plans for the AI Regulation Map. Each plan can be handed to a fresh agent for independent implementation.

## Feature Index

| # | Feature | Status | Plan |
|---|---------|--------|------|
| 01 | [Country Comparison](01-country-comparison.md) | ✅ Shipped | Radar/spider chart comparing 2-4 countries across 6 dimensions |
| 02 | [Data Export](02-data-export.md) | ✅ Shipped 2026-06 | CSV/JSON download of filtered or full dataset |
| 03 | [Full-Text Search](03-fulltext-search.md) | ✅ Shipped 2026-06 | Search regulation text for keywords ("sandbox", "facial recognition") |
| 04 | [Changelog View](04-changelog-view.md) | ✅ Shipped 2026-06 | Per-country score change history from history.json |
| 05 | [Bloc Aggregation](05-bloc-aggregation.md) | ✅ Shipped 2026-06 | Group/filter by EU, G20, ASEAN, etc. with aggregate stats |
| 06 | [Scatter Plot](06-scatter-plot.md) | ✅ Shipped 2026-06 | Cross-dimension scatter plot revealing governance clusters |
| 07 | [Kaggle Integration](07-kaggle-integration.md) | Backlog | Cross-reference external Kaggle dataset for enrichment |
| 08 | [Embeddable Widget](08-embeddable-widget.md) | Backlog | iframe embed mode with URL parameter configuration |

## Remaining Order

1. **08-embeddable-widget** — medium effort, other features are now stable
2. **07-kaggle-integration** — medium effort, requires dataset inspection first, backend-only

Note: the shipped plan docs (01–06) predate implementation and contain some snippets
that no longer match the codebase (e.g. global `d3`, CSS token names). Treat the code
as the source of truth.

## Notes

- All features are independent — no feature requires another to be built first
- Feature 08 is frontend-only; feature 07 is backend/pipeline only
- All plans follow the project's architecture: vanilla JS + D3, centralized state store, Vite build
