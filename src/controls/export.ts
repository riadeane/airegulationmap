// CSV / JSON export of the dataset - the whole thing or the current
// filtered view. Researchers feed this straight into R / Python / Excel.
//
// Exports follow the timeline (#142). At "Latest" they carry the latest
// data. While the timeline shows a past date they carry the scores as of
// that date, the vintage the map and panel show, and the file name and
// the JSON meta block name the date. History records scores only (plus
// confidence on snapshots that carry it), so on a past date the columns
// with no historical record (the five text descriptions, Specific Laws,
// Sources) export empty and the JSON leaves out the sub-indicators and the
// evidence record: a file labelled "as of" a date never pairs its scores
// with text researched after it. The CSV columns keep their names and
// order either way.
//
// Frontier Risk Governance (PRD 15) adds two columns at the end, "Frontier
// Risk" and "Frontier Track", named as in scores.csv: both empty for a
// country never scored on the lens, a track with an empty score for
// insufficient evidence. The JSON export adds a "Frontier" block per
// country (the subscores.json block, "na" kept, with the frontier text and
// sources) at Latest.

import { csvFormat } from 'd3-dsv';
import { getState, on } from '../state/store';
import { scoresAtDate, visibleCountriesIn, visibleCountrySet } from '../state/selectors';
import type { ScoreEntry, RegulationEntry, ScoreData, RegulationData } from '../data/loader';
import type { HistorySnapshot } from '../data/history';
import type { FrontierBlock, SubscoreEntry } from '../data/subscores';
import { localIsoDate } from '../data/localDate';
import {
  ATTRIBUTES, FRONTIER_CAP_SENTENCE, FRONTIER_METHODOLOGY_PATH, FRONTIER_TRACKS, GROUPS, parseFrontierTrack,
} from '../constants';
import type { AttributeKey, FrontierTrack } from '../constants';

// Score columns in the export rows, by attribute. The column names are a
// data contract and never change (the composite stays "Average Score");
// the JSON export's `meta` block carries what each one means.
const SCORE_COLUMNS: Record<AttributeKey, string> = {
  averageScore: 'Average Score',
  regulationStatus: 'Regulation Status (Score)',
  policyLever: 'Policy Lever (Score)',
  enforcementLevel: 'Enforcement Level (Score)',
  governanceType: 'Governance Type (Score)',
  actorInvolvement: 'Actor Involvement (Score)',
  frontierRisk: 'Frontier Risk',
};

const SITE = 'https://airegulationmap.org';

export interface ExportFieldMeta {
  label: string;
  group: string;
  question: string;
  scale: { min: 1; max: 5; low: string; high: string };
  notClaim: string;
}

// An export at a past timeline date, by column in CSV order (#142): the
// columns that follow the date (see buildExportRows), and the ones history
// has no record of, which are empty.
const AS_OF_COLUMNS = [
  'Average Score', 'Regulation Status (Score)', 'Policy Lever (Score)',
  'Governance Type (Score)', 'Actor Involvement (Score)', 'Enforcement Level (Score)',
  'Confidence', 'Last Updated', 'Frontier Risk', 'Frontier Track',
];
const CURRENT_ONLY_COLUMNS = [
  'Regulation Status', 'Policy Lever', 'Governance Type', 'Actor Involvement',
  'Enforcement Level', 'Specific Laws', 'Sources',
];

/** What an export at a past timeline date carries, for the meta block. */
export interface ExportVintageMeta {
  asOfColumns: string[];
  emptyColumns: string[];
  note: string;
}

/** What the frontier columns and the JSON "Frontier" block hold (PRD 15). */
export interface ExportFrontierMeta {
  scoreColumn: string;
  trackColumn: string;
  tracks: Record<FrontierTrack, { label: string; description: string }>;
  aggregation: string;
  values: string;
  methodology: string;
}

export interface ExportMeta {
  title: string;
  exported: string;
  /** The timeline date the rows are as of; absent for the latest data. */
  asOf?: string;
  note: string;
  vintage?: ExportVintageMeta;
  explainer: string;
  fields: Record<string, ExportFieldMeta>;
  frontier: ExportFrontierMeta;
}

function frontierMeta(): ExportFrontierMeta {
  return {
    scoreColumn: SCORE_COLUMNS.frontierRisk,
    trackColumn: 'Frontier Track',
    tracks: {
      H: { ...FRONTIER_TRACKS.H },
      C: { ...FRONTIER_TRACKS.C },
      G: { ...FRONTIER_TRACKS.G },
    },
    aggregation: FRONTIER_CAP_SENTENCE,
    values: 'Both frontier columns are empty for a country not yet scored on the lens. A track with an '
      + 'empty "Frontier Risk" is insufficient evidence on that track. In the JSON "Frontier" block a '
      + 'sub-indicator score of "na" means it does not apply on the track; it is never a 1.',
    methodology: SITE + FRONTIER_METHODOLOGY_PATH,
  };
}

/**
 * The JSON export's `meta` block (PRD 16): for each score column, the
 * display label, its lens, the question it answers, what 1 and 5 mean,
 * and what it does not claim. Keyed by the export's column names. With
 * `asOf` (an export at a past timeline date) it also names the date and
 * says which columns follow it and which are empty (#142).
 */
export function buildExportMeta(date: string = localIsoDate(), asOf: string | null = null): ExportMeta {
  const fields: Record<string, ExportFieldMeta> = {};
  for (const [key, column] of Object.entries(SCORE_COLUMNS) as [AttributeKey, string][]) {
    const m = ATTRIBUTES[key];
    fields[column] = {
      label: m.label,
      group: GROUPS[m.group].label,
      question: m.question,
      scale: { min: 1, max: 5, low: m.low, high: m.high },
      notClaim: m.notClaim,
    };
  }
  const title = 'AI Regulation Map';
  const note = 'Implementation scores measure how much AI governance is in force, not whether it is good. '
    + 'Governance style scores describe how a country governs; neither end is better. '
    + '"Average Score" is the implementation index. '
    + '"Frontier Risk" rates governance of catastrophic frontier-AI risk against a stated standard, by '
    + 'track; it is not a measure of how safe a country is and is not part of the implementation index.';
  const explainer = `${SITE}/methodology.html`;
  const frontier = frontierMeta();
  if (!asOf) return { title, exported: date, note, explainer, fields, frontier };
  return {
    title,
    exported: date,
    asOf,
    note,
    vintage: {
      asOfColumns: [...AS_OF_COLUMNS],
      emptyColumns: [...CURRENT_ONLY_COLUMNS],
      note: `Scores are as of ${asOf}: for each country, the history snapshot in effect on that date, `
        + 'as the map shows it. "Last Updated" is the date of the research run that produced those '
        + 'scores; it falls after the as-of date for a country first researched later, whose earliest '
        + 'scores are carried back. "Confidence" is the confidence recorded with the snapshot, empty '
        + 'where history recorded none. History keeps no text, sources, sub-indicators or evidence '
        + 'record, so those columns are empty and those keys are left out; export at Latest for them. '
        + 'A country with no history record carries its latest scores, confidence and "Last Updated".',
    },
    explainer,
    fields,
    frontier,
  };
}

/** The timeline vintage an export is taken at: the scrubbed date and the
 *  snapshots in effect on it (scoresAtDate). Null at "Latest". */
export interface ExportVintage {
  date: string;
  snapshots: Readonly<Record<string, HistorySnapshot>>;
}

/**
 * The export rows for `countries`. At "Latest" (`vintage` null) every
 * column comes from the latest entry. On a past date a row's scores come
 * from the country's snapshot in effect on that date (the map's scores),
 * its "Last Updated" is that snapshot's date (the run that produced them)
 * and its "Confidence" the confidence recorded with it, or empty; a country
 * history has no record of keeps its latest scores, confidence and date.
 * The columns history has no record of are empty on a past date.
 *
 * A null score ("insufficient evidence", rubric v3.1) exports as an empty
 * CSV cell and a JSON null, the same as scores.csv; it is never a number.
 */
export function buildExportRows(
  countries: readonly string[],
  scoreData: ScoreData,
  regulationData: RegulationData,
  vintage: ExportVintage | null = null
) {
  return countries.map(name => {
    const latest: Partial<ScoreEntry> = scoreData[name] || {};
    const reg: Partial<RegulationEntry> = regulationData[name] || {};
    const snapshot = vintage?.snapshots[name];
    const scores: Partial<Record<AttributeKey, number | null>> = snapshot ?? latest;
    const text = (value: string | null | undefined): string => (vintage ? '' : value || '');
    return {
      'Country': name,
      'Average Score': scores.averageScore,
      'Regulation Status (Score)': scores.regulationStatus,
      'Policy Lever (Score)': scores.policyLever,
      'Governance Type (Score)': scores.governanceType,
      'Actor Involvement (Score)': scores.actorInvolvement,
      'Enforcement Level (Score)': scores.enforcementLevel,
      'Regulation Status': text(reg.regulationStatus),
      'Policy Lever': text(reg.policyLever),
      'Governance Type': text(reg.governanceType),
      'Actor Involvement': text(reg.actorInvolvement),
      'Enforcement Level': text(reg.enforcementLevel),
      'Specific Laws': text(reg.specificLaws),
      'Sources': text(reg.sources),
      'Confidence': snapshot ? snapshot.confidence || '' : reg.confidence || '',
      'Last Updated': snapshot ? snapshot.date : latest.lastUpdated || reg.lastUpdated || '',
      // Appended, so no existing column moves. Absent (an empty CSV cell, no
      // JSON key) when the country has no frontier score at this vintage.
      'Frontier Risk': scores.frontierRisk,
      'Frontier Track': parseFrontierTrack(snapshot ? snapshot.frontierTrack : latest.frontierTrack) ?? '',
    };
  });
}

// JSON only: the methodology v2 sub-indicator audit trail, with the
// v2.1 rationale sentence under each score (null for countries scored
// before rationales existed). Nested, so it has no CSV column - the CSV
// export is unchanged.
type ExportRow = ReturnType<typeof buildExportRows>[number];

/** The evidence record (PRD 14) as subscores.json and the data page name it. */
export interface EvidenceExport {
  grounded: boolean;
  initiatives_used: number | null;
  search: boolean;
  model: string | null;
  run_id: string | null;
}

type SubindicatorAudit = Omit<SubscoreEntry, 'evidence' | 'frontier'>;

/** The JSON export's "Frontier" block: the subscores.json `frontier`
 *  block as the file has it ("na" kept), with the frontier text and its
 *  sources from regulation_data.csv. */
export type FrontierExport = Partial<FrontierBlock> & {
  text: string | null;
  sources: string | null;
};

type JsonRow = ExportRow & {
  'Sub-indicators'?: SubindicatorAudit;
  'Evidence'?: EvidenceExport;
  'Frontier'?: FrontierExport;
};

// The evidence record rides in the subscores.json entry but is research
// metadata, not a sub-indicator, so the export gives it its own key and
// the file's field names. The frontier block is its own lens and gets its
// own key too, joined by its text and sources when `regulation` is given.
export function withSubindicators(
  rows: ExportRow[],
  subscores: Record<string, SubscoreEntry> | undefined,
  regulation?: RegulationData
): JsonRow[] {
  return rows.map(row => {
    const entry = subscores?.[row.Country];
    const reg = regulation?.[row.Country];
    const out: JsonRow = { ...row };
    if (entry) {
      const { evidence, ...rest } = entry;
      const audit: SubindicatorAudit & { frontier?: FrontierBlock } = rest;
      delete audit.frontier;
      out['Sub-indicators'] = audit;
      if (evidence) {
        out['Evidence'] = {
          grounded: evidence.grounded,
          initiatives_used: evidence.initiativesUsed,
          search: evidence.search,
          model: evidence.model,
          run_id: evidence.runId,
        };
      }
    }
    const block = entry?.frontier;
    const text = reg?.frontierRisk ?? null;
    const sources = reg?.frontierSources ?? null;
    if (block || text || sources) out['Frontier'] = { ...(block ?? {}), text, sources };
    return out;
  });
}

/** The export's vintage for the current view: the timeline date and its
 *  snapshots, or null at "Latest" (and for a date history does not know,
 *  where the map shows the latest data too). */
function currentVintage(): ExportVintage | null {
  const snapshots = scoresAtDate();
  const { timelineDate } = getState();
  return snapshots && timelineDate ? { date: timelineDate, snapshots } : null;
}

/** Each dataset country's scores as buildExportRows writes them on a past
 *  date: the snapshot in effect on it, else the latest row. */
export function scoresAsOf(
  scoreData: ScoreData,
  vintage: ExportVintage
): Record<string, Partial<Record<AttributeKey, number | null>>> {
  const rows: Record<string, Partial<Record<AttributeKey, number | null>>> = {};
  for (const [name, latest] of Object.entries(scoreData)) {
    rows[name] = vintage.snapshots[name] ?? latest;
  }
  return rows;
}

/** The download's file name. The date in it is the data's: the export day
 *  at "Latest", the timeline date as "as-of-<date>" on a past date. */
export function exportFileName(scopeLabel: string, format: string, exported: string, asOf: string | null): string {
  const ext = format === 'csv' ? 'csv' : 'json';
  return `ai-regulation-data-${scopeLabel}-${asOf ? `as-of-${asOf}` : exported}.${ext}`;
}

// Countries passing the active filters - the same visibility predicate the
// map and scatter use (score range AND bloc), so "filtered view" exports
// exactly what the user is looking at. On a past timeline date the score
// range applies to the scores as of that date, as on the map. Countries
// with no score for the current attribute are excluded - they're dimmed on
// the map, and "all countries" covers them.
function getFilteredCountries(vintage: ExportVintage | null): string[] {
  const visible = vintage
    ? visibleCountriesIn(scoresAsOf(getState().scoreData, vintage))
    : visibleCountrySet();
  return [...visible].sort();
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

// Transient confirmation so the download isn't silent - and so the
// researcher can see which scope (filtered vs all) they actually got.
// Doubles as an aria-live announcement for screen-reader users.
function showToast(message: string): void {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast!.classList.remove('visible'), 2800);
}

/**
 * Download the given countries as CSV/JSON. `scopeLabel` names the set in
 * the filename and the toast ("filtered", "all", "comparison", "search"),
 * so the researcher can see which scope they actually got. On a past
 * timeline date the rows are as of that date and the file name, the JSON
 * meta block and the toast say so.
 */
export function exportCountries(
  countries: readonly string[],
  format: string,
  scopeLabel: string,
  toastLabel: string = scopeLabel
): void {
  const { scoreData, regulationData, subscores } = getState();
  const vintage = currentVintage();
  const asOf = vintage?.date ?? null;
  const rows = buildExportRows(countries, scoreData, regulationData, vintage);
  const date = localIsoDate();
  const filename = exportFileName(scopeLabel, format, date, asOf);
  if (format === 'csv') {
    downloadFile(csvFormat(rows), filename, 'text/csv');
  } else {
    // Sub-indicators and the evidence record describe the latest research
    // pass only, so an export at a past date leaves them out.
    const withAudit = vintage ? rows : withSubindicators(rows, subscores?.countries, regulationData);
    const payload = { meta: buildExportMeta(date, asOf), countries: withAudit };
    downloadFile(JSON.stringify(payload, null, 2), filename, 'application/json');
  }
  showToast(
    `Exported ${rows.length} ${rows.length === 1 ? 'country' : 'countries'} · ` +
    `${toastLabel} · ${asOf ? `as of ${asOf} · ` : ''}${format.toUpperCase()}`
  );
}

function scopeCountries(scope: string | undefined): { countries: string[]; label: string; toast: string } {
  if (scope === 'all') {
    return { countries: Object.keys(getState().scoreData).sort(), label: 'all', toast: 'all countries' };
  }
  if (scope === 'comparison') {
    return { countries: [...getState().comparisonCountries], label: 'comparison', toast: 'comparison set' };
  }
  return { countries: getFilteredCountries(currentVintage()), label: 'filtered', toast: 'filtered view' };
}

export function initExport(): void {
  const btn = document.getElementById('export-btn');
  const popover = document.getElementById('export-popover');
  if (!btn || !popover) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = popover.classList.toggle('open');
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
  });

  popover.addEventListener('click', e => {
    const target = (e.target as Element).closest<HTMLButtonElement>('button[data-format]');
    if (!target || target.disabled) return;
    const { countries, label, toast } = scopeCountries(target.dataset.scope);
    exportCountries(countries, target.dataset.format!, label, toast);
    popover.classList.remove('open');
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  });

  // The comparison rows only make sense with a staged set; keep them
  // visible-but-disabled so the affordance is discoverable.
  const comparisonButtons = popover.querySelectorAll<HTMLButtonElement>('button[data-scope="comparison"]');
  const syncComparisonButtons = () => {
    const n = getState().comparisonCountries.length;
    comparisonButtons.forEach(b => {
      b.disabled = n === 0;
      const fmt = b.dataset.format === 'csv' ? 'CSV' : 'JSON';
      b.textContent = n > 0 ? `${fmt} · comparison (${n})` : `${fmt} · comparison`;
    });
  };
  on('comparisonCountries', syncComparisonButtons);
  syncComparisonButtons();
}
