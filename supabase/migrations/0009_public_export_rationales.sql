-- Follow-up to 0005 (methodology v2.1): public_export carries the rationale
-- sentences too, so the flat export (and its CSV form) is the whole dataset.
-- Before this, a researcher had the 20 sub-indicator scores in
-- public_export.subscores but had to join country_scores for the sentences.
--
-- create or replace view can only append columns, so the column list and
-- joins below reproduce 0008_evidence_coverage.sql exactly and rationales
-- goes at the end. Comments on the existing view columns survive the replace.
create or replace view public_export
  with (security_invoker = true) as
select
  c.name as country,
  c.iso2,
  c.iso3,
  s.regulation_status,
  s.policy_lever,
  s.governance_type,
  s.actor_involvement,
  s.enforcement_level,
  s.avg_score,
  s.confidence,
  s.subscores,
  s.data_version,
  s.scored_at,
  su.regulation_status_text,
  su.policy_lever_text,
  su.governance_type_text,
  su.actor_involvement_text,
  su.enforcement_level_text,
  su.specific_laws,
  su.sources_raw,
  su.summarized_at,
  s.grounded,
  s.initiatives_used,
  s.web_search,
  s.rationales
from countries c
left join country_scores s on s.country_id = c.id
left join country_summaries su on su.country_id = c.id;

-- Comments feed PostgREST's OpenAPI output (the Swagger UI at
-- api-docs.html). Refresh public/openapi.json after applying (procedure in
-- CLAUDE.md).
comment on view public_export is
  'Flat research export: one row per country joining scores, sub-indicators with their v2.1 rationales, prose, and evidence coverage. The API twin of scores.csv plus regulation_data.csv; also serves as CSV via Accept: text/csv.';
comment on column public_export.subscores is
  'Methodology v2 integer sub-indicators only. The v2.1 rationale sentences are in the rationales column.';
comment on column public_export.rationales is
  'Methodology v2.1: one-sentence model rationale per sub-indicator, keyed dimension -> sub-indicator (same keys as subscores, no date). Null for countries not yet re-researched under v2.1.';
