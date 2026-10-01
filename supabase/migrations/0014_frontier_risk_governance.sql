-- Frontier Risk Governance (PRD 15): a seventh, separately presented lens.
-- Each country is scored on a track (H frontier host, C compute or
-- chokepoint, G global) assigned by the maintainer in
-- public/data/frontier_tracks.json. The lens is not part of avg_score.
--
-- country_scores gains the lens score, the track it was scored on and the
-- whole subscores.json "frontier" block; country_summaries its text and its
-- own source list; gold_checks the drift row's frontier block. All nullable:
-- a country not yet scored on the lens has none, and checks recorded before
-- the lens have none. score_history needs no change: its scores jsonb
-- already carries the frontierRisk and frontierTrack snapshot keys.
alter table country_scores
  add column if not exists frontier_risk numeric(3,2)
    check (frontier_risk between 1 and 5),
  add column if not exists frontier_track text
    check (frontier_track is null or frontier_track in ('H', 'C', 'G')),
  add column if not exists frontier_subscores jsonb
    check (frontier_subscores is null or jsonb_typeof(frontier_subscores) = 'object');

alter table country_summaries
  add column if not exists frontier_risk_text text,
  add column if not exists frontier_sources_raw text;

alter table gold_checks
  add column if not exists frontier jsonb
    check (frontier is null or jsonb_typeof(frontier) = 'object');

-- create or replace view can only append columns, so the column list and
-- joins below reproduce 0009_public_export_rationales.sql exactly and the
-- lens's columns go at the end. Comments on the existing view columns
-- survive the replace.
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
  s.rationales,
  s.frontier_risk,
  s.frontier_track,
  s.frontier_subscores,
  su.frontier_risk_text,
  su.frontier_sources_raw
from countries c
left join country_scores s on s.country_id = c.id
left join country_summaries su on su.country_id = c.id;

-- Comments feed PostgREST's OpenAPI output (the Swagger UI at
-- api-docs.html). Refresh public/openapi.json after applying (procedure in
-- CLAUDE.md).
comment on column country_scores.frontier_risk is
  'Frontier Risk Governance (PRD 15): the mean of the sub-indicators that apply on the country''s track, capped at the lowest of them plus one. Null when any of them is insufficient evidence, or (with frontier_track null) when the country has not been scored on the lens. Not part of avg_score. Measured against a stated standard; not a measure of how safe a country is.';
comment on column country_scores.frontier_track is
  'The track the frontier score was made on: H (home to a frontier developer), C (frontier-scale compute or an advanced-chip chokepoint), G (global). Null until the country is first scored on the lens.';
comment on column country_scores.frontier_subscores is
  'The four frontier sub-indicators as {score, rationale}: developer_obligations, evaluation_oversight, incident_emergency_preparedness, international_coordination. score is 1-5, null (insufficient evidence) or "na" (does not apply on the track). Also date, track and rubric; eu_level on developer_obligations for EU members; computed on international_coordination (derived from public lists).';
comment on column country_summaries.frontier_risk_text is
  'Frontier Risk Governance: one to three sentences on how the country governs catastrophic risk from frontier AI.';
comment on column country_summaries.frontier_sources_raw is
  'Source URLs behind the frontier claims (pipe separated), kept apart from sources_raw.';
comment on column gold_checks.frontier is
  'Frontier Risk Governance agreement with the gold set: {compared, missing, mae, bias, within_one, skipped, gold_verified} over the researched frontier sub-indicators. Null when the gold set had no frontier entries in the run.';
comment on column public_export.frontier_risk is
  'Frontier Risk Governance (PRD 15): the capped mean of the sub-indicators that apply on the track. Null for insufficient evidence or a country not yet scored on the lens (see frontier_track). Not part of avg_score.';
comment on column public_export.frontier_track is
  'H (home to a frontier developer), C (frontier-scale compute or an advanced-chip chokepoint) or G (global); null until first scored on the lens.';
comment on column public_export.frontier_subscores is
  'The four frontier sub-indicators as {score, rationale}; score is 1-5, null (insufficient evidence) or "na" (does not apply on the track).';
comment on column public_export.frontier_risk_text is
  'How the country governs catastrophic risk from frontier AI, in one to three sentences.';
comment on column public_export.frontier_sources_raw is
  'Source URLs behind the frontier claims (pipe separated).';
