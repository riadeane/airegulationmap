// Full-text search over the regulation text fields. ~196 countries ×
// 6 fields ≈ 1000 short entries - plain substring scan is plenty fast,
// no tokenization or library needed. Pure module, unit-tested.
//
// Matching ignores case and diacritics (see fold.ts): the index holds the
// folded text plus a map back to the original, so snippets and <mark>
// offsets still point into the prose as written.

import { foldText, foldWithMap, originalIndex } from './fold';
import type { FoldedText } from './fold';

export const SEARCHABLE_FIELDS = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
  'specificLaws',
] as const;

export type SearchableField = (typeof SEARCHABLE_FIELDS)[number];

export const FIELD_LABELS: Record<SearchableField, string> = {
  regulationStatus: 'Regulation Status',
  policyLever: 'Policy Lever',
  governanceType: 'Governance Type',
  actorInvolvement: 'Actor Involvement',
  enforcementLevel: 'Enforcement Level',
  specificLaws: 'Key Legislation',
};

/** Anything with the searchable text fields - RegulationEntry qualifies. */
type SearchableText = { [K in SearchableField]?: string | null };

export interface IndexEntry {
  country: string;
  field: SearchableField;
  /** Folded (lower-case, accent-free) text the query is matched against. */
  text: string;
  original: string;
  /** Folded index -> original index; null when folding kept positions. */
  map: number[] | null;
}

export interface SearchMatch {
  country: string;
  field: SearchableField;
  snippet: string;
  matchStart: number;
  matchLength: number;
}

export function buildSearchIndex(regulationData: Record<string, SearchableText>): IndexEntry[] {
  const index: IndexEntry[] = [];
  for (const [country, data] of Object.entries(regulationData)) {
    for (const field of SEARCHABLE_FIELDS) {
      const text = data[field];
      if (!text || text.length < 10) continue;
      const { folded, map } = foldWithMap(text);
      index.push({ country, field, text: folded, original: text, map });
    }
  }
  return index;
}

const SNIPPET_CONTEXT = 60;

/**
 * Substring search over the index. One result per country (the first
 * matching field wins). matchStart/matchLength locate the matched term
 * inside snippet so the renderer can wrap it in <mark> without
 * re-searching.
 */
export function searchRegulationText(
  index: IndexEntry[],
  query: string,
  maxResults = 20
): SearchMatch[] {
  if (!query || query.length < 3) return [];
  const q = foldText(query);
  if (!q) return [];
  const results: SearchMatch[] = [];
  const seen = new Set<string>();

  for (const entry of index) {
    if (seen.has(entry.country)) continue;
    const pos = entry.text.indexOf(q);
    if (pos === -1) continue;
    seen.add(entry.country);

    // Back to original offsets: the snippet and the mark cut the prose as
    // written, not its folded form.
    const folded: FoldedText = { folded: entry.text, map: entry.map };
    const matchFrom = originalIndex(folded, pos);
    const matchTo = originalIndex(folded, pos + q.length);
    const start = Math.max(0, matchFrom - SNIPPET_CONTEXT);
    const end = Math.min(entry.original.length, matchTo + SNIPPET_CONTEXT);
    const leadingEllipsis = start > 0;
    const snippet = (leadingEllipsis ? '…' : '')
      + entry.original.slice(start, end)
      + (end < entry.original.length ? '…' : '');

    results.push({
      country: entry.country,
      field: entry.field,
      snippet,
      matchStart: matchFrom - start + (leadingEllipsis ? 1 : 0),
      matchLength: matchTo - matchFrom,
    });

    if (results.length >= maxResults) break;
  }

  return results;
}

/**
 * The uncapped variant for the committed-search results list: every country
 * with a match (still one result per country - the first matching field
 * wins), in index order. The dropdown keeps its capped preview; this feeds
 * the full list, the count, and the exportable match set.
 */
export function searchAllMatches(index: IndexEntry[], query: string): SearchMatch[] {
  return searchRegulationText(index, query, Number.MAX_SAFE_INTEGER);
}
