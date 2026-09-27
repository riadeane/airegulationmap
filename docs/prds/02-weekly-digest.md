# PRD 02: Weekly digest and RSS feed

Status: Implemented (September 2026, #44). Owner: unassigned. Depends on: 01 (stability gate).

## Problem

The weekly run produces a stream of changes that nobody can read as a whole.
Researchers see one country at a time in the panel changelog. There is no
reason to return to the site each week and no way to subscribe.

## Users and job

Policy researchers and journalists who want a sourced, five-minute read of
what moved in AI regulation this week. They will forward it and quote it, so
every claim needs a link.

## Goal

After every scheduled run, the pipeline writes a dated digest. The site renders
it on a changes page with an RSS feed. Each item links to the sources the run
found.

## Non-goals

- Editorial opinion. The digest reports changes and cites sources.
- Email delivery. Design the feed so a service such as Buttondown can consume
  it later.
- Social posts. A later PRD can derive those from the digest.

## Requirements

1. **Input.** The set of countries whose gated scores or `Specific Laws`
   changed in this run, with old and new rows, the new sources, and the run id.
   Skip the digest when the set is empty; write a one-line "no changes" entry.
2. **Generation.** One Claude request with structured output:
   `{lead: str, items: [{country, headline, summary, sources: [url]}]}`.
   The prompt must forbid claims without a source from the supplied list.
   Reject any item whose `sources` contains a URL not in the input. Use the
   pipeline's default model.
3. **Storage.** Write `public/digest/YYYY-Www.json` (structured) and
   `public/digest/index.json` (list of weeks, newest first). Commit them with
   the data files in the workflow.
4. **Page.** `changes.html`, a static page in the style of `methodology.html`,
   renders the latest digest and links to earlier weeks. Each item links to the
   country in the app (`index.html?country=...`) and to its sources. Show the
   run date and model.
5. **Feed.** `public/digest/feed.xml` (Atom). One entry per week with the lead
   and the items as HTML. Link it from the page `<head>` and from the app menu.
6. **Link from the app.** Add "This week's changes" to the header menu
   (`src/controls/menu.ts`).
7. **CLI.** `python -m regulation_pipeline.digest --run <id>` regenerates a
   digest for a past run from Supabase `score_history`. Useful for backfill.

## Design notes

- Implement as a post-run step in `PipelineService.run` or a separate module
  `scripts/regulation_pipeline/digest.py` that consumes `RunResult`. Prefer the
  separate module; keep the service free of content concerns.
- Reuse `ResearchResult.output_schema()` patterns from `models.py` for the
  digest schema (pydantic model, `output_config.format`).
- The Atom file is a template in Python, no extra dependency.
- Copy rules: British English, no em dashes, no adjectives that are not
  verifiable. The prompt should include those rules.

## Acceptance criteria

- A run with changes produces a digest whose every source URL appears in the
  input rows. A test feeds a fake run and asserts this.
- `changes.html` renders in both themes and passes `npm run lint`.
- The feed validates with the W3C feed validator.
- The workflow commits the new files on the data commit.

## Open questions

- Should the digest also cover confidence changes without score changes?
  Proposed: only when confidence rises to high and new sources appear.
