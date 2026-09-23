-- Gold set and drift check (PRD 08, September 2026).
--
-- Ten hand-verified countries in public/data/gold_set.json anchor the
-- scale. After every pipeline run the raw sub-indicators the model returned
-- for those countries (before the stability gate, so the check measures
-- the model and not the gate) are compared with the gold scores. One row
-- per run lands here, mirrored from public/data/drift.json by the pipeline
-- (gold.py); the file stays the published record and the table the
-- queryable one. The check never fails a run.

create table gold_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid unique references research_runs(id),
  checked_on date not null,
  model text,
  prompt_version text,
  countries_compared integer not null check (countries_compared >= 0),
  countries_missing text[] not null default '{}',
  -- {dimension key: mean absolute error}, e.g. {"regulation_status": 0.4, ...}
  mae_by_dimension jsonb not null check (jsonb_typeof(mae_by_dimension) = 'object'),
  within_one numeric(4,3) not null check (within_one between 0 and 1),
  max_dev smallint not null check (max_dev between 0 and 4),
  -- where the largest deviation happened: {country, dimension, subindicator, gold, run}
  max_dev_at jsonb check (max_dev_at is null or jsonb_typeof(max_dev_at) = 'object'),
  created_at timestamptz not null default now()
);

create index idx_gold_checks_checked_on on gold_checks (checked_on);

-- Same posture as every other table (0002_rls.sql): public read, writes by
-- the service role only.
alter table gold_checks enable row level security;
create policy "public read" on gold_checks for select to anon, authenticated using (true);

-- Comments feed PostgREST's OpenAPI output (the Swagger UI at
-- api-docs.html). Refresh public/openapi.json after applying (procedure in
-- CLAUDE.md).
comment on table gold_checks is
  'Gold-set drift check, one row per research run: how far the model''s raw sub-indicator scores for the ten hand-verified gold countries (public/data/gold_set.json) sit from the verified scores. The queryable twin of public/data/drift.json.';
comment on column gold_checks.id is 'Row UUID.';
comment on column gold_checks.run_id is 'FK to research_runs.id: the run whose raw results were checked; one row per run.';
comment on column gold_checks.checked_on is 'Date of the run.';
comment on column gold_checks.model is 'Claude model id the run researched with.';
comment on column gold_checks.prompt_version is 'Version tag of the research prompt the run used.';
comment on column gold_checks.countries_compared is 'Gold countries the run returned a valid result for.';
comment on column gold_checks.countries_missing is 'Gold countries absent from the run (not selected, or no valid result).';
comment on column gold_checks.mae_by_dimension is 'Mean absolute error of the run''s sub-indicator scores against the gold scores, keyed by dimension (regulation_status, policy_lever, governance_type, actor_involvement, enforcement_level).';
comment on column gold_checks.within_one is 'Share of compared sub-indicators whose run score is within one point of the gold score. Below 0.8 the run summary carries a calibration warning.';
comment on column gold_checks.max_dev is 'Largest single sub-indicator deviation, in points (0 to 4).';
comment on column gold_checks.max_dev_at is 'Where the largest deviation happened: {country, dimension, subindicator, gold, run}.';
comment on column gold_checks.created_at is 'Row creation time.';
