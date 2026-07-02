-- Row Level Security: the entire database is public-readable (it is a
-- published reference dataset — research_runs included, as the provenance
-- audit trail), and writable only by the service role (GitHub Actions /
-- the pipeline), which bypasses RLS. No insert/update/delete policies
-- exist on purpose.

alter table countries enable row level security;
alter table research_runs enable row level security;
alter table country_scores enable row level security;
alter table country_summaries enable row level security;
alter table score_history enable row level security;
alter table sources enable row level security;
alter table country_sources enable row level security;
alter table policy_initiatives enable row level security;
alter table sync_state enable row level security;

create policy "public read" on countries          for select to anon, authenticated using (true);
create policy "public read" on research_runs      for select to anon, authenticated using (true);
create policy "public read" on country_scores     for select to anon, authenticated using (true);
create policy "public read" on country_summaries  for select to anon, authenticated using (true);
create policy "public read" on score_history      for select to anon, authenticated using (true);
create policy "public read" on sources            for select to anon, authenticated using (true);
create policy "public read" on country_sources    for select to anon, authenticated using (true);
create policy "public read" on policy_initiatives for select to anon, authenticated using (true);
create policy "public read" on sync_state         for select to anon, authenticated using (true);
