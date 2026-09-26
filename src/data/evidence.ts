// Evidence coverage per country (PRD 14): how each entry was researched.
//
// For every country a run researches, the pipeline records whether the
// prompt was grounded in verified policy initiatives (OECD.AI Policy
// Navigator / GAIIN records from the policy_initiatives table), how many it
// embedded, and whether the model had web search. The record sits beside the
// sub-scores in subscores.json (`countries.<name>.evidence`, snake_case keys)
// and in the Supabase country_scores columns grounded / initiatives_used /
// web_search. It describes the most recent research pass, the one behind the
// entry's text, sources and confidence.
//
// Pure: the panel sentence, the static country pages, the filter predicate
// and the bloc share all derive from the helpers here.

/** One country's research record, normalized from subscores.json. */
export interface EvidenceRecord {
  /** The prompt embedded at least one verified policy initiative. */
  grounded: boolean;
  /**
   * Initiatives embedded in the prompt (the pipeline caps the block at 15).
   * 0 when the run consulted the evidence database and it held none for the
   * country; null when the run did not consult the evidence database.
   */
  initiativesUsed: number | null;
  /** The model had web search for this country. */
  search: boolean;
  /** Claude model id the run researched with. */
  model: string | null;
  /** research_runs.id of the run. */
  runId: string | null;
}

/** The filter popover's Evidence facet: any, grounded, search only. */
export type EvidenceFilter = 'any' | 'grounded' | 'search';

export const EVIDENCE_FILTERS: readonly EvidenceFilter[] = ['any', 'grounded', 'search'];

/** Display labels for the Evidence facet. */
export const EVIDENCE_FILTER_LABELS: Record<EvidenceFilter, string> = {
  any: 'Any',
  grounded: 'Grounded',
  search: 'Search only',
};

/**
 * Coerce a raw `evidence` object from subscores.json into an EvidenceRecord.
 * Returns null for anything malformed, which the UI treats as "no run
 * record". `grounded` must agree with the count: the pipeline derives one
 * from the other, so a disagreement means the record cannot be trusted.
 */
export function normalizeEvidence(raw: unknown): EvidenceRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.grounded !== 'boolean' || typeof r.search !== 'boolean') return null;

  const used = r.initiatives_used;
  let initiativesUsed: number | null;
  if (used === null || used === undefined) initiativesUsed = null;
  else if (typeof used === 'number' && Number.isInteger(used) && used >= 0) initiativesUsed = used;
  else return null;

  if (r.grounded !== (initiativesUsed ?? 0) > 0) return null;

  return {
    grounded: r.grounded,
    initiativesUsed,
    search: r.search,
    model: typeof r.model === 'string' && r.model.trim() ? r.model.trim() : null,
    runId: typeof r.run_id === 'string' && r.run_id.trim() ? r.run_id.trim() : null,
  };
}

/**
 * The evidence sentence, split so a renderer can link the middle part to the
 * Policy Initiatives section. `link` is null when the sentence names no
 * initiatives; `text` is the whole sentence. Factual only: counts and
 * methods, never an adjective about the evidence.
 */
export interface EvidenceSentence {
  before: string;
  link: string | null;
  after: string;
  text: string;
}

export function evidenceSentence(record: EvidenceRecord): EvidenceSentence {
  const n = record.initiativesUsed ?? 0;
  if (record.grounded && n > 0) {
    const before = `Grounded in ${n} `;
    const link = n === 1 ? 'verified policy initiative' : 'verified policy initiatives';
    const after = record.search ? ' and web search' : '; no web search';
    return { before, link, after, text: before + link + after };
  }
  const method = record.search ? 'Web search only' : 'No web search';
  const evidence = record.initiativesUsed === 0
    ? 'no verified initiatives on record'
    : 'verified initiatives not consulted';
  const text = `${method}; ${evidence}`;
  return { before: text, link: null, after: '', text };
}

/**
 * Does a country's record satisfy the Evidence facet? "grounded" means the
 * prompt embedded verified initiatives; "search" (search only) means web
 * search without any. A country with no run record satisfies only "any",
 * the same way unknown confidence fails a confidence filter.
 */
export function matchesEvidenceFilter(
  record: EvidenceRecord | null | undefined,
  filter: EvidenceFilter
): boolean {
  if (filter === 'any') return true;
  if (!record) return false;
  return filter === 'grounded' ? record.grounded : !record.grounded && record.search;
}

/** Parse the `evidence` URL parameter. Only the two narrowing facets are
 * valid; "any" is the default and never appears in a URL. */
export function parseEvidenceFilter(raw: string | null | undefined): EvidenceFilter | null {
  const v = raw?.trim().toLowerCase();
  return v === 'grounded' || v === 'search' ? v : null;
}
