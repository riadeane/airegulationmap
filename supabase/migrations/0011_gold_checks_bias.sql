-- Signed drift (#163): gold_checks gains the mean signed error per dimension
-- (run minus gold). Mean absolute error cannot show whether a model scores
-- systematically high or low; the signed mean can. Nullable: rows written
-- before this migration have no bias.
alter table gold_checks
  add column if not exists bias_by_dimension jsonb
    check (bias_by_dimension is null or jsonb_typeof(bias_by_dimension) = 'object');

-- Comments feed PostgREST's OpenAPI output (the Swagger UI at
-- api-docs.html). Refresh public/openapi.json after applying (procedure in
-- CLAUDE.md).
comment on column gold_checks.bias_by_dimension is
  'Mean signed error of the run''s sub-indicator scores against the gold scores (run minus gold), keyed by dimension. Positive means the run scores higher than the gold set. Beyond 0.5 in either direction the run summary carries a calibration warning. Null for checks recorded before September 2026.';
comment on column gold_checks.within_one is
  'Share of compared sub-indicators whose run score is within one point of the gold score. Below 0.8, or with any dimension''s bias beyond 0.5, the run summary carries a calibration warning.';
