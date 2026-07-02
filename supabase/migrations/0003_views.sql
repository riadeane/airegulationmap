-- Researcher-facing export views, reachable via PostgREST:
--   GET /rest/v1/public_export      (Accept: text/csv for bulk download)
--   GET /rest/v1/sources_export
-- security_invoker so the anon role's RLS applies (public read).

create view public_export
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
  su.summarized_at
from countries c
left join country_scores s on s.country_id = c.id
left join country_summaries su on su.country_id = c.id;

create view sources_export
  with (security_invoker = true) as
select
  s.url,
  s.domain,
  s.source_type,
  s.title,
  s.first_seen,
  s.last_seen,
  array_remove(array_agg(distinct c.name), null) as countries
from sources s
left join country_sources cs on cs.source_id = s.id
left join countries c on c.id = cs.country_id
group by s.id;
