# Product requirement documents

Each file is one self-contained piece of work. Status, owner, and dependencies
sit at the top of each PRD. Read the project `CLAUDE.md` before you start any
of them. Keep the design principles: the map is the protagonist, rigor over
ornament, designed for comparison, citeable by default, calm density.

| # | PRD | Area | Depends on |
|---|-----|------|------------|
| 01 | [Stability gate for weekly re-scoring](01-stability-gate.md) | Pipeline | - |
| 02 | [Weekly digest and RSS feed](02-weekly-digest.md) | Pipeline + site | 01 |
| 03 | [Rationale sentences per sub-indicator](03-subindicator-rationales.md) | Pipeline + panel | - |
| 04 | [Static country pages](04-country-pages.md) | Build + site | - |
| 05 | ["This week" strip on the map](05-this-week-strip.md) | Frontend | 01 |
| 06 | [Peer comparison shortcuts](06-peer-comparison.md) | Frontend | - |
| 07 | [Printable country brief](07-printable-brief.md) | Frontend | 03 (optional) |
| 08 | [Gold set and drift check](08-gold-set-drift-check.md) | Pipeline | - |
| 09 | [Error reporting from the panel](09-issue-reporting.md) | Frontend | - |
| 10 | [Versioned dataset releases with a DOI](10-dataset-doi.md) | Workflow + site | - |
| 11 | [Drift dashboard](11-drift-dashboard.md) | Site | 08 (optional) |
| 12 | [Monthly trend piece](12-monthly-trend-piece.md) | Pipeline + site | 02 |
| 13 | [Uncertainty on the map](13-uncertainty-on-map.md) | Frontend | - |
| 14 | [Evidence coverage per country](14-evidence-coverage.md) | Pipeline + panel | - |

Suggested order: 01, 02, 03, then the rest in any order. 01 protects the data
quality that every other PRD assumes.

## Conventions for every PRD

- Write code and docs in the project's conventions (`CLAUDE.md`).
- Add tests: Vitest for `src/`, pytest for `scripts/regulation_pipeline/`.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and `python -m pytest`
  before you finish.
- Do not commit data files (`public/*.csv`, `public/history.json`,
  `public/data/subscores.json`) that a local pipeline run changed.
- Ship both themes. Use the existing tokens in `src/styles/_tokens.css`.
- British English in user-facing copy. No em dashes.
- File a GitHub issue for anything wrong you notice outside the PRD's scope,
  and link an issue from every follow-up your PR lists (see "Found something
  off? File an issue" in `CLAUDE.md`).
