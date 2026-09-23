# PRD 14: Evidence coverage per country

Status: Proposed. Owner: unassigned. Depends on: none.

## Problem

Grounded runs inject verified OECD/GAIIN policy initiatives into the prompt
for countries that have them. Other countries are researched from web search
alone. The reader cannot tell which is which, and the maintainer cannot see
where evidence is thin.

## Users and job

Researchers judging how well-founded an entry is. The maintainer prioritising
where to improve evidence.

## Goal

Every country entry states how many verified initiatives grounded its research
and whether web search was used. The map can filter by evidence coverage.

## Non-goals

- Changing how evidence is collected. The evidence sync stays as is.
- Ranking countries by evidence.

## Requirements

1. **Pipeline record.** For each researched country record
   `{grounded: bool, initiatives_used: int, search: bool, model, run_id}` in
   `public/data/subscores.json` alongside the sub-scores, and in Supabase
   `country_scores` (new columns `initiatives_used integer`, `grounded boolean`,
   `web_search boolean`) via a migration with comments.
2. **Panel.** Under the confidence line show one sentence:
   "Grounded in 7 verified policy initiatives and web search" or "Web search
   only; no verified initiatives on record". Link "verified policy
   initiatives" to the existing Policy Initiatives section of the panel.
3. **Filter.** The filter control (`src/controls/filter.ts`) gains an
   "Evidence" facet: any, grounded, search only. URL parameter `evidence`.
4. **Bloc summary.** `src/controls/blocSummary.ts` shows the share of grounded
   countries for the selected bloc.
5. **Data page.** `public/data.html` documents the fields.

## Design notes

- The count is available in `ResearchClient._prompt_for` when the evidence
  provider returns records. Return it alongside the prompt (a small dataclass)
  so the strategy can attach it to the result without a second lookup.
- Keep the sentence factual. No adjectives such as "strong" or "weak".
- The filter must compose with the existing confidence and official-source
  filters through the same selector pipeline.

## Acceptance criteria

- pytest covers the recorded fields for a grounded and a plain prompt.
- Vitest covers the evidence filter and the bloc share computation.
- The panel sentence appears for a grounded country and a search-only
  country; nothing appears for a country that has no run record.
- The API docs show the new columns.

## Open questions

- Should the map show evidence coverage as its own colour mode? Proposed: no,
  a filter is enough; the map stays about scores.
