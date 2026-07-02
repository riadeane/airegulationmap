-- AI Regulation Map — core schema.
--
-- Supabase is the system of record and researcher API; the static files in
-- public/ are its published snapshot (dual-write from the pipeline). Design
-- notes:
--   * country_scores.subscores is jsonb in the exact nested shape of
--     public/data/subscores.json (methodology v2: 5 dimensions × 4 named
--     sub-indicators). The single writer is the validated pipeline, so the
--     DB does not re-model what pydantic already enforces — and methodology
--     v3 needs no migration.
--   * score_history mirrors history.json's change-point semantics: the
--     pipeline REPLACES a country's snapshot rows when its history changes
--     (history.py advances the last snapshot's date in place when scores
--     are unchanged, so append-only would drift).
--   * policy_initiatives.country_id is nullable: unmatched or IGO-level
--     records (e.g. the EU's) are stored unlinked with country_raw
--     preserved — never guessed onto a country.
--   * research_runs is the provenance/audit trail: every scores/summaries/
--     history/sources row points at the run that produced it.

create table countries (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,          -- canonical dataset name (TopoJSON style)
  iso3 char(3) unique,                -- null for non-ISO entities
  iso2 char(2),
  iso_numeric char(3),                -- matches world-atlas geometry id
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table research_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('schedule', 'manual', 'seed', 'backfill')),
  model text,
  strategy text check (strategy in ('sync', 'batch')),
  prompt_version text,
  grounded boolean not null default false,
  countries_attempted integer,
  countries_succeeded integer,
  input_tokens bigint,
  output_tokens bigint,
  est_cost_usd numeric,
  git_sha text,
  notes text
);

create table country_scores (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null unique references countries(id),
  regulation_status numeric(3,2) check (regulation_status between 1 and 5),
  policy_lever numeric(3,2) check (policy_lever between 1 and 5),
  governance_type numeric(3,2) check (governance_type between 1 and 5),
  actor_involvement numeric(3,2) check (actor_involvement between 1 and 5),
  enforcement_level numeric(3,2) check (enforcement_level between 1 and 5),
  -- Maturity composite: mean of the three NORMATIVE dimensions only
  -- (regulation_status, policy_lever, enforcement_level).
  avg_score numeric(3,2) check (avg_score between 1 and 5),
  subscores jsonb check (subscores is null or jsonb_typeof(subscores) = 'object'),
  confidence text check (confidence in ('high', 'medium', 'low')),
  data_version integer not null default 1,
  run_id uuid references research_runs(id),
  scored_at date,
  updated_at timestamptz not null default now()
);

create table country_summaries (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null unique references countries(id),
  regulation_status_text text,
  policy_lever_text text,
  governance_type_text text,
  actor_involvement_text text,
  enforcement_level_text text,
  specific_laws text,
  sources_raw text,                   -- verbatim pipe-separated CSV field
  run_id uuid references research_runs(id),
  summarized_at date,
  updated_at timestamptz not null default now()
);

create table score_history (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id),
  snapshot_date date not null,
  scores jsonb not null,              -- file shape: {regulationStatus, ..., averageScore}
  run_id uuid references research_runs(id),
  unique (country_id, snapshot_date)
);

-- The accumulating deep-research sources database: every URL the research
-- pipeline cites and every evidence-record link lands here exactly once,
-- with first/last-seen tracking. title stays null until enriched; the
-- frontend upgrades its display automatically when it exists.
create table sources (
  id uuid primary key default gen_random_uuid(),
  url text unique not null,
  domain text not null,
  source_type text not null default 'other'
    check (source_type in ('official', 'intergovernmental', 'academic', 'news', 'industry', 'other')),
  title text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table country_sources (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries(id),
  source_id uuid not null references sources(id),
  dimension text not null default 'general'
    check (dimension in ('general', 'regulation_status', 'policy_lever',
                         'governance_type', 'actor_involvement', 'enforcement_level')),
  run_id uuid references research_runs(id),
  first_cited timestamptz not null default now(),
  last_cited timestamptz not null default now(),
  unique (country_id, source_id, dimension)
);

-- Evidence records (OECD Policy Navigator / GAIIN today; adapter-extensible).
create table policy_initiatives (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'oecd',
  external_id text not null,
  country_id uuid references countries(id),
  country_raw text,                   -- iso3/name/IGO label as received
  name text not null,
  category text,
  initiative_type text,
  binding text,
  status text,
  start_year integer,
  end_year integer,
  description text,
  overview text,                      -- HTML-stripped plain text
  source_url text,
  principles text[] not null default '{}',
  tags text[] not null default '{}',
  raw jsonb,                          -- full original record, for re-mapping
  first_synced timestamptz not null default now(),
  updated_at timestamptz,
  unique (source, external_id)
);

create table sync_state (
  source text primary key,
  last_synced_at timestamptz,
  last_total integer,
  cursor jsonb
);

create index idx_score_history_country on score_history (country_id);
create index idx_country_sources_country on country_sources (country_id);
create index idx_country_sources_source on country_sources (source_id);
create index idx_policy_initiatives_country on policy_initiatives (country_id);
