-- Follow-up to 0005: the public_export view still described its subscores
-- column as "same shape as subscores.json". The file now nests
-- {score, rationale}; the view column carries the integers only.

comment on column public_export.subscores is
  'Methodology v2 integer sub-indicators only. The v2.1 rationale sentences are in country_scores.rationales.';
