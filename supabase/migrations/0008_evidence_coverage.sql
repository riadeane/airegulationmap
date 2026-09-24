-- Evidence coverage per country (PRD 14, September 2026).
--
-- Grounded runs (--grounded) embed each country's verified policy
-- initiatives (OECD.AI Policy Navigator / GAIIN records from
-- policy_initiatives) in the research prompt; other countries are
-- researched from web search alone. These columns record, per country, how
-- the latest research pass was grounded, so readers can tell the two apart
-- and the maintainer can see where evidence is thin. They mirror the
-- "evidence" record beside the sub-scores in public/data/subscores.json.
-- The model is not repeated here: it is research_runs.model via run_id.
--
-- initiatives_used separates two cases the panel must not conflate:
--   0    the run consulted the evidence database and it held no initiatives
--        for the country (the plain prompt was used);
--   null the run did not consult it (not a grounded run).
-- All three columns null means no run record since PRD 14 shipped; existing
-- rows start that way and are not backfilled. The pipeline mirror is the
-- single writer and updates them on every applied result, including one the
-- stability gate holds, since they describe the pass behind the entry's text.

alter table country_scores
  add column grounded boolean,
  add column initiatives_used integer
    check (initiatives_used is null or initiatives_used >= 0),
  add column web_search boolean;

-- grounded is derived from the count, never set independently.
alter table country_scores
  add constraint country_scores_grounded_matches_count
    check (grounded is null or grounded = (coalesce(initiatives_used, 0) > 0));

-- create or replace view can only append columns, so the column list and
-- joins below reproduce 0003_views.sql exactly and the new columns go at the
-- end. Comments on the existing view columns survive the replace.
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
  s.web_search
from countries c
left join country_scores s on s.country_id = c.id
left join country_summaries su on su.country_id = c.id;

-- Comments feed PostgREST's OpenAPI output (the Swagger UI at
-- api-docs.html). Refresh public/openapi.json after applying (procedure in
-- CLAUDE.md).
comment on table country_scores is
  'Latest scores per country: five dimensions plus the maturity composite, methodology v2 sub-indicators with their v2.1 rationales, research confidence, and evidence coverage (grounded, initiatives_used, web_search).';
comment on column country_scores.grounded is
  'True when the research prompt embedded at least one verified policy initiative (OECD.AI Policy Navigator / GAIIN); always equals initiatives_used > 0. The run''s model is research_runs.model via run_id. Null when the country has no run record since evidence coverage was first recorded (September 2026); initiatives_used and web_search are then null too.';
comment on column country_scores.initiatives_used is
  'Verified policy initiatives embedded in the research prompt (capped at 15). 0 when the run consulted the evidence database and it held none for the country; null when the run did not consult it (not a grounded run) or the country has no run record.';
comment on column country_scores.web_search is
  'True when the model had web search for the country''s latest research pass. Null when the country has no run record.';

comment on view public_export is
  'Flat research export: one row per country joining scores, sub-indicators, prose, and evidence coverage. The API twin of scores.csv plus regulation_data.csv; also serves as CSV via Accept: text/csv.';
comment on column public_export.grounded is
  'True when the research prompt embedded at least one verified policy initiative (OECD.AI Policy Navigator / GAIIN); always equals initiatives_used > 0. Null when the country has no run record since evidence coverage was first recorded (September 2026).';
comment on column public_export.initiatives_used is
  'Verified policy initiatives embedded in the research prompt (capped at 15). 0 when the run consulted the evidence database and it held none for the country; null when the run did not consult it (not a grounded run) or the country has no run record.';
comment on column public_export.web_search is
  'True when the model had web search for the country''s latest research pass. Null when the country has no run record.';
