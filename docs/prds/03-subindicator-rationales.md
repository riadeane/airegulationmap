# PRD 03: Rationale sentences per sub-indicator

Status: Proposed. Owner: unassigned. Depends on: none.

## Problem

Each dimension score is the mean of four sub-indicators (methodology v2). The
panel shows the 24 integers but not why the model chose them. A reader cannot
tell a well-founded 4 from a guessed 4, and cannot spot a wrong score without
re-doing the research.

## Users and job

Researchers who want to check a score against their own knowledge before they
cite it. Maintainers who want to see where the model misreads the rubric.

## Goal

Every sub-indicator carries one sentence that states the fact the score rests
on. The panel shows it next to the score.

## Non-goals

- Long explanations. One sentence, at most 200 characters.
- Changing the rubric or the calibration.

## Requirements

1. **Schema.** Add `rationale: str` (1 to 200 characters) to each
   sub-indicator in `ResearchResult` (`scripts/regulation_pipeline/models.py`).
   The structured-output schema must require it.
2. **Prompt.** In `prompt.py`, instruct the model to state, for each
   sub-indicator, the single fact that justifies the score. It must name the
   instrument, body, or date where one exists. No hedging phrases.
3. **Storage.** Persist rationales in `public/data/subscores.json` under each
   sub-indicator: `{score: 4, rationale: "..."}`. Bump the methodology tag in
   the file to `v2.1`. Keep the loader backward compatible with `v2` entries
   that have no rationale.
4. **Supabase.** Mirror the rationales. Add a `rationales jsonb` column to
   `country_scores` in a new migration, with a table comment. Refresh
   `public/openapi.json`.
5. **Panel.** In `src/panel/subscores.ts`, show the rationale under each
   sub-indicator score in a muted secondary style. Collapse behind the existing
   sub-score disclosure if one exists; do not add a new control.
6. **Export.** Include rationales in the JSON export (`src/controls/export.ts`).
   Leave the CSV export unchanged.
7. **Methodology.** Add one paragraph to `public/methodology.html` that says
   rationales are model output, not editorial text.

## Design notes

- Structured outputs guarantee the field is present. Validate length in
  pydantic; on failure, the result is rejected like any other invalid result.
- Output tokens grow by roughly 24 sentences per country. Cost impact is under
  $1 per weekly run at batch pricing.
- Typography: the rationale is body text at the small size, not a caption.
  Keep line length under 70 characters in the panel.

## Acceptance criteria

- `python -m pytest` passes with new tests for the schema, the prompt render,
  and the subscores file shape.
- `npm test` passes with a test that the loader accepts both `v2` and `v2.1`.
- The panel shows rationales for a country that has them and shows nothing
  extra for a country that does not.
- The API docs show the new column.

## Open questions

- Should the pipeline require a rationale to cite a source? Proposed: no, the
  country-level `Sources` list remains the citation surface.
