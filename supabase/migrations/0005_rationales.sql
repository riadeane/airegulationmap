-- Methodology v2.1 (September 2026): every sub-indicator carries a
-- one-sentence rationale that states the fact its score rests on.
-- Rationales live in their own jsonb column so country_scores.subscores
-- keeps the integer shape existing API consumers read. Keys mirror
-- subscores minus "date": {dimension: {sub_indicator: "sentence"}}.
-- The pipeline is the single writer; pydantic enforces 1-200 characters
-- per sentence before a row reaches the mirror.

alter table country_scores
  add column rationales jsonb
    check (rationales is null or jsonb_typeof(rationales) = 'object');

comment on table country_scores is
  'Latest scores per country: five dimensions plus the maturity composite, methodology v2 sub-indicators with their v2.1 rationales, and research confidence.';
comment on column country_scores.rationales is
  'Methodology v2.1: one-sentence model rationale per sub-indicator, keyed dimension -> sub-indicator (same keys as subscores, no date). Null for countries not yet re-researched under v2.1.';
-- subscores.json now nests {score, rationale}; this column keeps the
-- integers only, so its comment no longer claims an identical shape.
comment on column country_scores.subscores is
  'Methodology v2 audit trail: four named integer sub-indicators per dimension. The scores from subscores.json; the v2.1 rationales live in the rationales column.';
