-- Gold-set provenance on each drift check (#99). Correcting a gold score, or
-- verifying a draft entry, changes what a check means; without these a
-- series computed against drafts looks like one computed against verified
-- scores. Nullable: checks recorded before this migration have none.
alter table gold_checks
  add column if not exists gold_verified integer check (gold_verified is null or gold_verified >= 0),
  add column if not exists gold_version text,
  add column if not exists grounded_countries integer
    check (grounded_countries is null or grounded_countries >= 0);

-- Comments feed PostgREST's OpenAPI output (the Swagger UI at
-- api-docs.html). Refresh public/openapi.json after applying (procedure in
-- CLAUDE.md).
comment on column gold_checks.gold_verified is
  'How many of the compared countries had a verified gold entry; the rest were drafts awaiting the maintainer''s hand-check. Null for checks recorded before September 2026.';
comment on column gold_checks.gold_version is
  'The first 12 hex digits of the SHA-256 of public/data/gold_set.json when the check ran: checks with different versions were computed against different gold scores. Null for checks recorded before September 2026.';
comment on column gold_checks.grounded_countries is
  'On a grounded run, how many compared countries'' prompts carried verified policy initiatives (the rest fell back to the plain prompt). Null on runs that were not grounded.';
