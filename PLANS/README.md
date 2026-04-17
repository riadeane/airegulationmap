# Feature Plans

Self-contained implementation plans for the AI Regulation Map. Each plan can be handed to a fresh agent for independent implementation.

## Feature Index

| # | Feature | Effort | Dependencies | Plan |
|---|---------|--------|--------------|------|
| 01 | [Country Comparison](01-country-comparison.md) | Medium-high | None | Radar/spider chart comparing 2-4 countries across 6 dimensions |
| 02 | [Data Export](02-data-export.md) | Low | None | CSV/JSON download of filtered or full dataset |
| 03 | [Full-Text Search](03-fulltext-search.md) | Low-medium | None | Search regulation text for keywords ("sandbox", "facial recognition") |
| 04 | [Changelog View](04-changelog-view.md) | Low-medium | None | Per-country score change history from history.json |
| 05 | [Bloc Aggregation](05-bloc-aggregation.md) | Medium | None | Group/filter by EU, G20, ASEAN, etc. with aggregate stats |
| 06 | [Scatter Plot](06-scatter-plot.md) | Medium | None | Cross-dimension scatter plot revealing governance clusters |
| 07 | [Kaggle Integration](07-kaggle-integration.md) | Medium (unknown) | None | Cross-reference external Kaggle dataset for enrichment |
| 08 | [Embeddable Widget](08-embeddable-widget.md) | Medium | None | iframe embed mode with URL parameter configuration |

## Suggested Implementation Order

1. **02-data-export** — lowest effort, immediate researcher value, no new state
2. **04-changelog-view** — low effort, uses existing history.json, high research impact
3. **03-fulltext-search** — low-medium effort, transforms the app into a policy research tool
4. **05-bloc-aggregation** — medium effort, new data file needed, high research value
5. **06-scatter-plot** — medium effort, new visualization panel, enables hypothesis testing
6. **01-country-comparison** — medium-high effort, new D3 radar chart, most-requested feature
7. **08-embeddable-widget** — medium effort, best after other features are stable
8. **07-kaggle-integration** — medium effort, requires dataset inspection first, backend-only

## Notes

- All features are independent — no feature requires another to be built first
- Features 01-06 and 08 are frontend-only; feature 07 is backend/pipeline only
- All plans follow the project's architecture: vanilla JS + D3, centralized state store, Vite build
- This folder is gitignored — plans stay local
