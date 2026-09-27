# PRD 01: Stability gate for weekly re-scoring

Status: Implemented (September 2026, #43). Owner: unassigned. Depends on: none. Includes the calibration break and the fixed-anchor rubric (addenda A and B).
Blocks: 02 (weekly digest), 05 ("This week" strip).

## Problem

The pipeline now re-researches all 196 countries every Monday with web search
(`.github/workflows/update-data.yml`). Each run re-scores 24 sub-indicators
per country from scratch. Two runs on the same real-world situation will
disagree by a quarter point on some dimensions. Without a gate, the score
history fills with jitter that has no policy cause, the per-country changelog
loses credibility, and any downstream "what changed this week" feature reports
noise.

## Users and job

Policy researchers who read the changelog and timeline expect every recorded
change to correspond to a real event. The maintainer expects a full run to be
safe to auto-commit.

## Goal

A score change reaches `scores.csv`, `history.json`, and Supabase only when the
run gives evidence for it, or when the same change persists across two runs.

## Non-goals

- Human review UI. The gate is automatic. A review list is a by-product.
- Changing the rubric or the prompt.

## Requirements

1. **Evidence rule.** Apply a result's scores immediately when at least one of
   these holds for the country:
   - The result cites at least one source URL that is not in the existing
     `Sources` column.
   - The `Specific Laws` text changed after whitespace normalisation.
   - The country has no prior scores.
2. **Persistence rule.** When the evidence rule fails and any dimension score
   changed, do not apply the scores. Record the candidate in
   `public/data/pending.json` as `{country, candidate_scores, first_seen}`.
   Apply the candidate on the next run if that run produces the same direction
   of change on the same dimensions. Clear the candidate if the next run
   reverts to the existing scores.
3. **Text updates always apply.** Descriptions, laws, sources, confidence, and
   `Last Updated` update on every successful result, independent of the gate.
   Only the numeric scores and the history snapshot are gated.
4. **Large-move flag.** When an applied change moves any dimension by 0.75 or
   more, list the country, dimension, old, new, and the new sources in the run
   summary (`GITHUB_STEP_SUMMARY` in the workflow) under "Review these".
5. **Provenance.** Log per country which rule applied: `applied:evidence`,
   `applied:persisted`, `held`, `unchanged`. Include counts in the run summary.
6. **Escape hatch.** `--no-gate` applies every result unconditionally. Use it
   for calibration resets such as a model change.

## Design notes

- The seam is `PipelineService._apply` in `scripts/regulation_pipeline/service.py`
  and `Dataset.apply` in `repository.py`. Put the rule logic in a new
  `scripts/regulation_pipeline/gate.py` with a pure function
  `decide(existing_scores, existing_reg, result, pending) -> Decision`.
- `history.append_snapshot` already skips snapshots with no change. Keep that.
- The Supabase mirror (`db/mirror.py`) must receive the gated scores, not the
  raw result, so the database stays consistent with the static files.
- `pending.json` travels with the other data files: commit it in the workflow's
  "Check for changes" step.
- Source URL comparison: normalise with the same rules as `sources.py`
  (strip scheme, trailing slash, `www.`).

## Acceptance criteria

- Unit tests in `tests/pipeline/test_gate.py` cover: new source applies; law
  text change applies; no evidence holds; held then persisted applies; held
  then reverted clears; `--no-gate` applies everything.
- A dry run prints the decision per country.
- `research_runs.notes` (or a new column) records the gate counts.
- README of the pipeline documents the rules in one short section.

## Open questions

- Should a confidence drop from high to low bypass the gate? Proposed: no.
- Should the persistence window be two runs or a calendar span? Proposed: two
  consecutive runs.

## Addendum A: calibration break for the model switch

The first run on Opus 5 replaces scores produced by Sonnet 4.6. A sample of
ten countries showed most scores move up by about half a point with no
policy cause. The history must show this as a recalibration, not as change.

1. Run the switch with `--no-gate` so the shift lands in one run.
2. Add a top-level `breaks` list to `public/history.json`:
   `[{date, model, prompt_version, reason}]`. The pipeline appends one entry
   when the run uses `--no-gate` and passes `--break-reason "<text>"`.
   Refuse `--no-gate` on a full run without a reason.
3. `src/data/history.ts` exposes the breaks. The timeline draws a marker at
   each break date with the reason in its tooltip. The per-country changelog
   labels a change dated on a break as "Recalibration: <reason>" and does not
   count it as a policy change.
4. The weekly digest (PRD 02), when it exists, opens that week's lead with
   the recalibration sentence and lists no per-country items for score-only
   changes on that date.
5. Keep all earlier snapshots unchanged. Do not re-score or offset the past;
   past web content cannot be re-researched and an offset is invented data.

## Addendum B: fixed anchors instead of a moving ceiling

The calibration block in `scripts/regulation_pipeline/prompt.py` says a
sub-indicator score of 5 means the global frontier today. That makes scores
comparable across countries but not across time: a country can fall without
changing anything because the frontier moved, and weekly runs re-estimate the
frontier every week, which adds drift. The sub-indicator definitions already
read as absolute. Make the calibration block agree with them.

1. Rewrite the calibration block so each level, and 5 in particular,
   describes an observable state a jurisdiction can be verified to be in.
   Set level 5 so that today's leading jurisdictions reach it on most
   sub-indicators and perfection is not required. Keep the reference points
   (an EU member state near 4 to 5, the United States near 3) as examples of
   the anchors, not as the definition.
2. Do not change the shape of `ResearchResult`. Only the meaning text moves.
3. Bump `PROMPT_VERSION` in `prompt.py` to a v3 tag and record the change in
   `public/methodology.html` under a "Rubric versions" heading: what changed,
   why, and the break date.
4. Ship this rewrite in the same run as the model switch so the history
   carries one break, not two.
5. A relative view (score divided by that week's maximum) is a frontend
   display option if ever wanted. It is never the stored number. Out of scope
   here; note it in the methodology page as a non-goal.

## Acceptance criteria for the addenda

- A test asserts that `--no-gate` without `--break-reason` exits non-zero on
  a full run and that a break entry is appended with it.
- Vitest covers the changelog labelling of a change on a break date.
- The timeline shows the marker in both themes.
- The methodology page documents the v3 rubric and the break.
