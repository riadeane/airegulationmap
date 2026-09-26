-- Covering indexes for the run_id foreign keys (Supabase performance
-- advisor, September 2026). `digest --run <id>` and API users filtering by
-- run scan these tables, which grow every week.
create index if not exists idx_country_scores_run on country_scores (run_id);
create index if not exists idx_country_summaries_run on country_summaries (run_id);
create index if not exists idx_score_history_run on score_history (run_id);
create index if not exists idx_country_sources_run on country_sources (run_id);
