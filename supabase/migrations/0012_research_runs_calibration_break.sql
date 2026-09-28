-- Calibration breaks in the database (#90): a run that re-scored every
-- country with the stability gate off (a model or rubric change) records
-- the break it wrote to history.json, so API users and
-- `python -m regulation_pipeline.digest --run <id>` can tell a
-- recalibration from policy change. Null for runs that recorded no break,
-- and for every run before this migration.
alter table research_runs
  add column if not exists calibration_break jsonb
    check (calibration_break is null or jsonb_typeof(calibration_break) = 'object');

-- Comments feed PostgREST's OpenAPI output (the Swagger UI at
-- api-docs.html). Refresh public/openapi.json after applying (procedure in
-- CLAUDE.md).
comment on column research_runs.calibration_break is
  'The calibration break this run recorded, as in history.json breaks: {date, model, prompt_version, rubric, reason, complete}. Score changes dated on a break are a re-measurement, not policy change. Null when the run recorded none.';
