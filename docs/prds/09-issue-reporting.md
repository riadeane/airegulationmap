# PRD 09: Error reporting from the panel

Status: Implemented (September 2026). Owner: unassigned. Depends on: none.

## Problem

Readers who spot a wrong score or a stale law have no way to say so except
finding the repository. Their corrections are the cheapest data-quality signal
the project can get.

## Users and job

A researcher who knows a country's law better than the model and wants to
report a mistake in under a minute.

## Goal

A "Report an issue" action in the panel opens a pre-filled GitHub issue with
everything the maintainer needs to reproduce and fix the entry.

## Non-goals

- Storing reports in the database. GitHub issues are the queue.
- Anonymous submission without a GitHub account.

## Requirements

1. **Action.** "Report an issue" in the panel actions row. It opens
   `https://github.com/riadeane/airegulationmap/issues/new` in a new tab with
   the `template`, `title`, and `body` query parameters filled.
2. **Prefill.** Title: `Data: <Country>`. Body: the six scores, confidence,
   last updated, the data version, the list of source URLs, the current app
   URL, and an empty "What is wrong" section. Keep the body under 6,000
   characters; truncate the sources list with a count if needed.
3. **Template.** `.github/ISSUE_TEMPLATE/data-error.yml` with fields:
   country, what is wrong, evidence (URL), and a checkbox for "I have checked
   the methodology page". Label `data`.
4. **Sub-scores.** When PRD 03 rationales exist, include the sub-indicator
   rows in the body inside a collapsed `<details>` block.
5. **Privacy.** Send nothing but the data already on screen. No analytics.

## Design notes

- Build the URL in a new `src/controls/report.ts`. Use `URLSearchParams`;
  GitHub reads `template`, `title`, `body`, and `labels`.
- Reuse the citation formatter (`src/controls/citation.ts`) for the data
  version line so the issue quotes the same version string a reader would cite.
- Add a "Data issues" section to `CONTRIBUTING.md` or the README that says
  how reports are handled and how a fix flows through the pipeline
  (`--countries "<name>"` re-research, or a manual edit plus commit).

## Acceptance criteria

- Vitest covers the body builder: content, length cap, truncation note.
- Clicking the action from Chile opens the issue form with the correct
  prefilled values.
- The template renders on GitHub without validation errors.

## Open questions

- Should reports auto-trigger a re-research of that country? Decided: no,
  the maintainer decides (`CONTRIBUTING.md`, "Data issues").

## Implementation notes

- GitHub prefills an issue *form* from query parameters named after its
  field ids and ignores the free-text `body` parameter, which only Markdown
  templates take. The entry block therefore travels in the form's `entry`
  field, the country in `country`; the "What is wrong" section is the form's
  own required textarea rather than a heading inside the prefilled text.
- The body is capped at 6,000 characters and its encoded form at 7,000, so
  the URL stays inside GitHub's limit (measured: 414 above roughly 8 KB).
  Detail is shed in a fixed order: unlisted sources with a count, then the
  rationales, then the sub-indicator block.
