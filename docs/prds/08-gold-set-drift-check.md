# PRD 08: Gold set and drift check

Status: Implemented (September 2026). Owner: unassigned. Depends on: none. The gold entries are drafts until the maintainer verifies them.

## Problem

Nothing measures whether the pipeline scores correctly, or whether a model or
prompt change moved the calibration. A model swap, a prompt edit, or a change
in web search results can shift every score without anyone noticing.

## Users and job

The maintainer deciding between models and prompts. Readers who want to know
how reliable the numbers are.

## Goal

A small set of hand-verified country scores, checked on every weekly run, with
the agreement recorded over time.

## Non-goals

- A full evaluation harness. Ten countries and one metric.
- Blocking the run. Drift is reported, not enforced.

## Requirements

1. **Gold set.** `public/data/gold_set.json`: ten countries across the
   maturity range, each with 20 sub-indicator scores (five dimensions times
   four; the maturity index is derived), a one-line justification
   per dimension, the sources used, and the verification date. Countries:
   choose from the priority list plus two low-coverage countries. The
   maintainer verifies the scores by hand; the agent drafts them and marks
   them "draft" until verified.
2. **Check.** After each run, compare the run's sub-indicators for the gold
   countries against the gold set. Metrics: mean absolute error per dimension,
   share of sub-indicators within 1 point, and the largest single deviation.
3. **Record.** Append one row per run to `public/data/drift.json`:
   `{run_id, date, model, prompt_version, mae_by_dimension, within_one, max_dev}`.
   Mirror the same row to a new `gold_checks` table in Supabase.
4. **Summary.** Print the metrics in the workflow step summary. When
   `within_one` drops below 0.8, prefix the summary with "Calibration
   warning". Do not fail the run.
5. **CLI.** `python -m regulation_pipeline.gold --model <id>` runs only the
   gold countries with the given model and prints the metrics. This is the
   model-comparison tool.
6. **Methodology.** One paragraph on the methodology page: what the gold set
   is, how it is verified, and where the drift record lives.

## Design notes

- The gold check reads results from the run in memory (`RunResult`) so it
  costs no extra API calls on scheduled runs.
- Use the gate's raw results, not the gated scores, so the check measures the
  model, not the gate.
- Keep the metric code pure and tested in `tests/pipeline/test_gold.py`.

## Acceptance criteria

- The check runs on a fake run in tests and produces the expected metrics.
- A real weekly run appends one row to `drift.json`.
- The gold set file states "verified" or "draft" per country.

## Open questions

- Who verifies the gold scores and how often? Proposed: the maintainer,
  every quarter, recorded in the file.
