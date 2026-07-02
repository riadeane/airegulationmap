// Post-boot hydration from the Supabase public_export view.
//
// The pipeline dual-writes, so the static files are normally exactly as
// fresh as the database — this fetch usually confirms that and does
// nothing. It exists for the cases where they diverge (a mirror-only
// hotfix, a paused deploy) and, as a side effect, keeps the free-tier
// project warm and the live read path continuously exercised. State is
// replaced only when the database is STRICTLY newer.

import { getState, setState } from '../state/store';
import { parseScore } from './loader';
import type { ScoreData, RegulationData, ScoreEntry, RegulationEntry } from './loader';
import { restGet } from './supabase';

/** Columns fetched from public_export — prose included, subscores excluded
 * (the sub-indicator panel reads the static subscores.json). */
export const EXPORT_COLUMNS =
  'country,regulation_status,policy_lever,governance_type,actor_involvement,'
  + 'enforcement_level,avg_score,confidence,data_version,scored_at,'
  + 'regulation_status_text,policy_lever_text,governance_type_text,'
  + 'actor_involvement_text,enforcement_level_text,specific_laws,sources_raw,summarized_at';

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
}

/** Map one public_export row into the exact shapes the CSV loader
 * produces — scores through the same parseScore validation boundary. */
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
 * regulation data in the store. Returns true when a replacement happened. */
export async function hydrateFromSupabase(): Promise<boolean> {
  const rows = await restGet(`public_export?select=${EXPORT_COLUMNS}&limit=1000`);
  if (!Array.isArray(rows) || rows.length === 0) return false;

  const scoreData: ScoreData = {};
  const regulationData: RegulationData = {};
  for (const raw of rows as ExportRow[]) {
    const mapped = mapExportRow(raw);
    if (!mapped) continue;
    scoreData[mapped.score.country] = mapped.score;
    regulationData[mapped.reg.country] = mapped.reg;
  }
  if (Object.keys(scoreData).length === 0) return false;

  if (!isStrictlyNewer(scoreData, getState().scoreData)) return false;

  console.info('supabase: database is newer than the static snapshot — hydrating.');
  setState({
    scoreData,
    regulationData,
    sortedCountryNames: Object.keys(scoreData).sort(),
  });
  return true;
}
