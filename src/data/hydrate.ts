// Post-boot hydration from the Supabase public_export view.
//
// The pipeline dual-writes, so the static files are normally exactly as
// fresh as the database - this fetch usually confirms that and does
// nothing. It exists for the cases where they diverge (a mirror-only
// hotfix, a paused deploy) and, as a side effect, keeps the free-tier
// project warm and the live read path continuously exercised. State is
// replaced only when the database is STRICTLY newer.

import { getState, setState } from '../state/store';
import { parseScore } from './loader';
import type { ScoreData, RegulationData, ScoreEntry, RegulationEntry } from './loader';
import { normalizeEvidence } from './evidence';
import type { EvidenceRecord } from './evidence';
import type { SubscoresData } from './subscores';
import { restGet } from './supabase';

/** Columns fetched from public_export - prose and the evidence record
 * included, subscores excluded (the sub-indicator panel reads the static
 * subscores.json, so a hydrated entry keeps the older breakdown). */
export const EXPORT_COLUMNS =
  'country,regulation_status,policy_lever,governance_type,actor_involvement,'
  + 'enforcement_level,avg_score,confidence,data_version,scored_at,'
  + 'regulation_status_text,policy_lever_text,governance_type_text,'
  + 'actor_involvement_text,enforcement_level_text,specific_laws,sources_raw,summarized_at,'
  + 'grounded,initiatives_used,web_search';

interface ExportRow {
  country: string;
  regulation_status: number | string | null;
  policy_lever: number | string | null;
  governance_type: number | string | null;
  actor_involvement: number | string | null;
  enforcement_level: number | string | null;
  avg_score: number | string | null;
  confidence: string | null;
  data_version: number | null;
  scored_at: string | null;
  regulation_status_text: string | null;
  policy_lever_text: string | null;
  governance_type_text: string | null;
  actor_involvement_text: string | null;
  enforcement_level_text: string | null;
  specific_laws: string | null;
  sources_raw: string | null;
  summarized_at: string | null;
  // Evidence coverage (migration 0008). All three null = no run record.
  grounded?: boolean | null;
  initiatives_used?: number | null;
  web_search?: boolean | null;
}

/** The evidence record a public_export row carries, in the shape
 * subscores.json gives it. The view has no model or run id, so both are
 * null. Null when the row has no record (or an inconsistent one). */
export function evidenceFromRow(row: ExportRow): EvidenceRecord | null {
  if (row.grounded == null && row.web_search == null) return null;
  return normalizeEvidence({
    grounded: row.grounded,
    initiatives_used: row.initiatives_used ?? null,
    search: row.web_search,
    model: null,
    run_id: null,
  });
}

/** Map one public_export row into the exact shapes the CSV loader
 * produces - scores through the same parseScore validation boundary. */
export function mapExportRow(row: ExportRow): { score: ScoreEntry; reg: RegulationEntry } | null {
  if (!row.country) return null;
  const score: ScoreEntry = {
    country: row.country,
    regulationStatus: parseScore(row.regulation_status),
    policyLever: parseScore(row.policy_lever),
    governanceType: parseScore(row.governance_type),
    actorInvolvement: parseScore(row.actor_involvement),
    averageScore: parseScore(row.avg_score),
    enforcementLevel: parseScore(row.enforcement_level),
    lastUpdated: row.scored_at || null,
    dataVersion: row.data_version != null && row.data_version >= 1 ? row.data_version : 1,
  };
  const reg: RegulationEntry = {
    country: row.country,
    regulationStatus: row.regulation_status_text || null,
    policyLever: row.policy_lever_text || null,
    governanceType: row.governance_type_text || null,
    actorInvolvement: row.actor_involvement_text || null,
    enforcementLevel: row.enforcement_level_text || null,
    specificLaws: row.specific_laws || null,
    sources: row.sources_raw || null,
    lastUpdated: row.summarized_at || null,
    confidence: row.confidence || null,
  };
  return { score, reg };
}

// Evidence records from the last hydration, for the countries whose entry
// it replaced with a different research pass (null = the database row has
// no record). subscores.json may land before or after hydration, so both
// paths run it through withHydratedEvidence().
let hydratedEvidence: ReadonlyMap<string, EvidenceRecord | null> | null = null;

/** Overlay the hydrated evidence records on a subscores object, so the
 * panel sentence, the Evidence facet and the bloc share describe the run
 * behind the hydrated text. Returns the input unchanged when there is
 * nothing to overlay. Countries missing from subscores.json get no entry:
 * the sub-indicator panel needs the file's breakdown to render one. */
export function withHydratedEvidence(subscores: SubscoresData | null): SubscoresData | null {
  if (!subscores || !hydratedEvidence || hydratedEvidence.size === 0) return subscores;
  const countries = { ...subscores.countries };
  for (const [name, record] of hydratedEvidence) {
    const entry = countries[name];
    if (!entry) continue;
    const next = { ...entry };
    if (record) next.evidence = record;
    else delete next.evidence;
    countries[name] = next;
  }
  return { ...subscores, countries };
}

/** Test hook: forget the last hydration's evidence records. */
export function resetHydratedEvidence(): void {
  hydratedEvidence = null;
}

function maxLastUpdated(scoreData: ScoreData): string {
  let max = '';
  for (const entry of Object.values(scoreData)) {
    if (entry.lastUpdated && entry.lastUpdated > max) max = entry.lastUpdated;
  }
  return max;
}

/** True when `candidate` is strictly newer than the loaded data. Exported
 * for tests. ISO dates compare lexicographically. */
export function isStrictlyNewer(candidate: ScoreData, current: ScoreData): boolean {
  const a = maxLastUpdated(candidate);
  const b = maxLastUpdated(current);
  return !!a && a > b;
}

/** Fetch, compare, and (only if strictly newer) replace the score and
 * regulation data in the store. Returns true when a replacement happened.
 *
 * Two-phase: a one-row freshness probe first (the dual-write mirror keeps
 * the database and the static snapshot in lockstep, so the normal outcome
 * is "not newer" - no reason to download half a megabyte of prose to
 * discard it), then the full fetch only when the probe says newer. */
export async function hydrateFromSupabase(): Promise<boolean> {
  const probe = await restGet(
    'public_export?select=scored_at&order=scored_at.desc.nullslast&limit=1'
  );
  if (!Array.isArray(probe) || probe.length === 0) return false;
  const dbLatest = (probe[0] as { scored_at?: string | null }).scored_at || '';
  const staticLatest = maxLastUpdated(getState().scoreData);
  if (!dbLatest || dbLatest <= staticLatest) return false;

  const rows = await restGet(`public_export?select=${EXPORT_COLUMNS}&limit=1000`);
  if (!Array.isArray(rows) || rows.length === 0) return false;

  const current = getState().scoreData;
  const scoreData: ScoreData = {};
  const regulationData: RegulationData = {};
  const evidence = new Map<string, EvidenceRecord | null>();
  for (const raw of rows as ExportRow[]) {
    const mapped = mapExportRow(raw);
    if (!mapped) continue;
    const name = mapped.score.country;
    scoreData[name] = mapped.score;
    regulationData[name] = mapped.reg;
    // Same research date as the static entry = the same pass, whose record
    // in subscores.json also names the model and run: keep that one.
    if (mapped.score.lastUpdated !== current[name]?.lastUpdated) {
      evidence.set(name, evidenceFromRow(raw));
    }
  }
  if (Object.keys(scoreData).length === 0) return false;

  if (!isStrictlyNewer(scoreData, current)) return false;

  console.info('supabase: database is newer than the static snapshot; hydrating.');
  hydratedEvidence = evidence;
  setState({
    scoreData,
    regulationData,
    sortedCountryNames: Object.keys(scoreData).sort(),
    subscores: withHydratedEvidence(getState().subscores),
  });
  return true;
}
