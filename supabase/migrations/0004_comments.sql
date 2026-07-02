-- Table and column comments. PostgREST folds these into its OpenAPI output,
-- so they double as the public API documentation (endpoint summaries and
-- per-column descriptions in the Swagger UI at api-docs.html). After changing
-- comments, refresh public/openapi.json (procedure in CLAUDE.md).

-- countries ------------------------------------------------------------------
comment on table countries is
  'Canonical country registry: one row per dataset country, with ISO 3166 codes and accepted name aliases.';
comment on column countries.id is 'Row UUID.';
comment on column countries.name is 'Canonical country name; exactly matches scores.csv and the map.';
comment on column countries.iso3 is 'ISO 3166-1 alpha-3 code (XKX for Kosovo); null where none exists.';
comment on column countries.iso2 is 'ISO 3166-1 alpha-2 code; null where none exists.';
comment on column countries.iso_numeric is 'ISO 3166-1 numeric code, zero-padded to three digits; matches the world-atlas TopoJSON geometry ids; null where none exists.';
comment on column countries.aliases is 'Accepted alternate names, used for normalization.';
comment on column countries.created_at is 'Row creation time.';
comment on column countries.updated_at is 'Last modification time.';

-- research_runs --------------------------------------------------------------
comment on table research_runs is
  'Provenance for every pipeline run: model, strategy, prompt version, counts, token usage, and estimated cost.';
comment on column research_runs.id is 'Run UUID; referenced by run_id columns elsewhere.';
comment on column research_runs.started_at is 'Run start time.';
comment on column research_runs.finished_at is 'Run end time; null if the run died before finishing.';
comment on column research_runs.trigger is 'What started the run: schedule, manual, seed, or backfill.';
comment on column research_runs.model is 'Claude model id used for research.';
comment on column research_runs.strategy is 'Request strategy: sync (one request per country) or batch (Message Batches API).';
comment on column research_runs.prompt_version is 'Version tag of the research prompt template.';
comment on column research_runs.grounded is 'True when prompts injected verified policy-initiative evidence.';
comment on column research_runs.countries_attempted is 'Countries the run tried to research.';
comment on column research_runs.countries_succeeded is 'Countries that produced a valid, persisted result.';
comment on column research_runs.input_tokens is 'Total input tokens across the run.';
comment on column research_runs.output_tokens is 'Total output tokens across the run.';
comment on column research_runs.est_cost_usd is 'Rough API cost estimate in USD.';
comment on column research_runs.git_sha is 'Pipeline code commit that produced the run.';
comment on column research_runs.notes is 'Free-form operator notes.';

-- country_scores -------------------------------------------------------------
comment on table country_scores is
  'Latest scores per country: five dimensions plus the maturity composite, methodology v2 sub-indicators, and research confidence.';
comment on column country_scores.id is 'Row UUID.';
comment on column country_scores.country_id is 'FK to countries.id; unique, one row per country.';
comment on column country_scores.regulation_status is 'Existence and maturity of AI-specific regulation, 1 to 5 (normative).';
comment on column country_scores.policy_lever is 'Breadth of policy instruments in use, 1 to 5 (normative).';
comment on column country_scores.governance_type is 'Where regulatory authority sits, 1 centralized to 5 distributed (descriptive; excluded from avg_score).';
comment on column country_scores.actor_involvement is 'Who shapes policy, 1 narrow expert circles to 5 broad participation (descriptive; excluded from avg_score).';
comment on column country_scores.enforcement_level is 'Enforcement rigor, 1 to 5 (normative).';
comment on column country_scores.avg_score is 'Maturity index: mean of the three normative dimensions (regulation_status, policy_lever, enforcement_level).';
comment on column country_scores.subscores is 'Methodology v2 audit trail: four named integer sub-indicators per dimension, same shape as subscores.json.';
comment on column country_scores.confidence is 'Research confidence: high, medium, or low.';
comment on column country_scores.data_version is 'Dataset schema version of the row.';
comment on column country_scores.run_id is 'FK to research_runs.id: the run that produced this row.';
comment on column country_scores.scored_at is 'Date the country was last researched.';
comment on column country_scores.updated_at is 'Last modification time.';

-- country_summaries ----------------------------------------------------------
comment on table country_summaries is
  'Latest research prose per country: per-dimension descriptions, key legislation, and the verbatim source list.';
comment on column country_summaries.id is 'Row UUID.';
comment on column country_summaries.country_id is 'FK to countries.id; unique, one row per country.';
comment on column country_summaries.regulation_status_text is 'Prose for the regulation status dimension.';
comment on column country_summaries.policy_lever_text is 'Prose for the policy lever dimension.';
comment on column country_summaries.governance_type_text is 'Prose for the governance type dimension.';
comment on column country_summaries.actor_involvement_text is 'Prose for the actor involvement dimension.';
comment on column country_summaries.enforcement_level_text is 'Prose for the enforcement level dimension.';
comment on column country_summaries.specific_laws is 'Key laws, bills, and frameworks, cited by name.';
comment on column country_summaries.sources_raw is 'Verbatim source URL list from the research response (newline separated).';
comment on column country_summaries.run_id is 'FK to research_runs.id: the run that produced this row.';
comment on column country_summaries.summarized_at is 'Date the prose was last researched.';
comment on column country_summaries.updated_at is 'Last modification time.';

-- score_history --------------------------------------------------------------
comment on table score_history is
  'Change-point score snapshots per country; the timeline''s raw data. One row per country per snapshot date.';
comment on column score_history.id is 'Row UUID.';
comment on column score_history.country_id is 'FK to countries.id.';
comment on column score_history.snapshot_date is 'Date of the snapshot; a row exists only when scores changed.';
comment on column score_history.scores is 'Score set at that date, same JSON shape as history.json entries.';
comment on column score_history.run_id is 'FK to research_runs.id: the run that recorded the snapshot.';

-- sources --------------------------------------------------------------------
comment on table sources is
  'Deep-research source registry: every URL cited by any research run, classified, accumulating over time.';
comment on column sources.id is 'Row UUID.';
comment on column sources.url is 'Full source URL (unique).';
comment on column sources.domain is 'Lowercased host of the URL.';
comment on column sources.source_type is 'Classification: official, intergovernmental, academic, news, industry, or other.';
comment on column sources.title is 'Human-readable page title; null until enriched.';
comment on column sources.first_seen is 'First time a research run cited this URL.';
comment on column sources.last_seen is 'Most recent time a research run cited this URL.';

-- country_sources ------------------------------------------------------------
comment on table country_sources is
  'Citation links: which sources each country''s research cited, by dimension.';
comment on column country_sources.id is 'Row UUID.';
comment on column country_sources.country_id is 'FK to countries.id.';
comment on column country_sources.source_id is 'FK to sources.id.';
comment on column country_sources.dimension is 'Score dimension the citation supports; general when unattributed.';
comment on column country_sources.run_id is 'FK to research_runs.id: the most recent run that cited it.';
comment on column country_sources.first_cited is 'First citation time for this country and source.';
comment on column country_sources.last_cited is 'Most recent citation time for this country and source.';

-- policy_initiatives ---------------------------------------------------------
comment on table policy_initiatives is
  'Verified AI policy initiatives from the OECD.AI Policy Observatory (Policy Navigator / GAIIN). Jurisdictions outside the dataset (for example the EU and other IGOs) keep country_id null.';
comment on column policy_initiatives.id is 'Row UUID.';
comment on column policy_initiatives.source is 'Evidence source identifier (currently oecd_gaiin).';
comment on column policy_initiatives.external_id is 'Record id within the evidence source; unique per source.';
comment on column policy_initiatives.country_id is 'FK to countries.id; null when the jurisdiction is not a dataset country.';
comment on column policy_initiatives.country_raw is 'Jurisdiction label exactly as the source provided it.';
comment on column policy_initiatives.name is 'Initiative title (English).';
comment on column policy_initiatives.category is 'Source taxonomy category, for example Regulations, guidelines and standards.';
comment on column policy_initiatives.initiative_type is 'Instrument type from the source taxonomy.';
comment on column policy_initiatives.binding is 'Legal force as stated by the source: Binding, Non-binding, or null when unstated.';
comment on column policy_initiatives.status is 'Lifecycle status as stated by the source.';
comment on column policy_initiatives.start_year is 'Year the initiative began, when stated.';
comment on column policy_initiatives.end_year is 'Year the initiative ended, when stated.';
comment on column policy_initiatives.description is 'Short description from the source.';
comment on column policy_initiatives.overview is 'Long-form overview from the source, HTML stripped.';
comment on column policy_initiatives.source_url is 'Official page or document URL for the initiative.';
comment on column policy_initiatives.principles is 'OECD AI Principles the source tagged.';
comment on column policy_initiatives.tags is 'Free-form tags from the source.';
comment on column policy_initiatives.raw is 'Complete original record as fetched, kept for auditability.';
comment on column policy_initiatives.first_synced is 'When the sync first stored this record.';
comment on column policy_initiatives.updated_at is 'Source-side last-update time, used for delta detection; null when the source omits it.';

-- sync_state -----------------------------------------------------------------
comment on table sync_state is
  'Evidence-sync bookkeeping, one row per external source.';
comment on column sync_state.source is 'Evidence source identifier (primary key).';
comment on column sync_state.last_synced_at is 'When the last successful sync finished.';
comment on column sync_state.last_total is 'Record count the source reported at last sync.';
comment on column sync_state.cursor is 'Adapter-specific resume state.';

-- views ----------------------------------------------------------------------
comment on view public_export is
  'Flat research export: one row per country joining scores, sub-indicators, and prose. The API twin of scores.csv plus regulation_data.csv; also serves as CSV via Accept: text/csv.';
comment on column public_export.country is 'Canonical country name.';
comment on column public_export.iso2 is 'ISO 3166-1 alpha-2 code.';
comment on column public_export.iso3 is 'ISO 3166-1 alpha-3 code.';
comment on column public_export.regulation_status is 'Existence and maturity of AI-specific regulation, 1 to 5 (normative).';
comment on column public_export.policy_lever is 'Breadth of policy instruments in use, 1 to 5 (normative).';
comment on column public_export.governance_type is 'Where regulatory authority sits, 1 centralized to 5 distributed (descriptive).';
comment on column public_export.actor_involvement is 'Who shapes policy, 1 narrow to 5 broad (descriptive).';
comment on column public_export.enforcement_level is 'Enforcement rigor, 1 to 5 (normative).';
comment on column public_export.avg_score is 'Maturity index: mean of the three normative dimensions.';
comment on column public_export.confidence is 'Research confidence: high, medium, or low.';
comment on column public_export.subscores is 'Methodology v2 sub-indicators, same shape as subscores.json.';
comment on column public_export.data_version is 'Dataset schema version of the row.';
comment on column public_export.scored_at is 'Date the scores were last researched.';
comment on column public_export.regulation_status_text is 'Prose for the regulation status dimension.';
comment on column public_export.policy_lever_text is 'Prose for the policy lever dimension.';
comment on column public_export.governance_type_text is 'Prose for the governance type dimension.';
comment on column public_export.actor_involvement_text is 'Prose for the actor involvement dimension.';
comment on column public_export.enforcement_level_text is 'Prose for the enforcement level dimension.';
comment on column public_export.specific_laws is 'Key laws, bills, and frameworks, cited by name.';
comment on column public_export.sources_raw is 'Verbatim source URL list (newline separated).';
comment on column public_export.summarized_at is 'Date the prose was last researched.';

comment on view sources_export is
  'Flat source export: every cited URL with its classification and the countries whose research cites it. Also serves as CSV via Accept: text/csv.';
comment on column sources_export.url is 'Full source URL.';
comment on column sources_export.domain is 'Lowercased host of the URL.';
comment on column sources_export.source_type is 'Classification: official, intergovernmental, academic, news, industry, or other.';
comment on column sources_export.title is 'Human-readable page title; null until enriched.';
comment on column sources_export.first_seen is 'First time a research run cited this URL.';
comment on column sources_export.last_seen is 'Most recent time a research run cited this URL.';
comment on column sources_export.countries is 'Names of countries whose research cites this source.';
