// Full-text search over the regulation text fields. ~196 countries ×
// 6 fields ≈ 1000 short entries — plain substring scan is plenty fast,
// no tokenization or library needed. Pure module, unit-tested.

export const SEARCHABLE_FIELDS = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
  'specificLaws',
];

export const FIELD_LABELS = {
  regulationStatus: 'Regulation Status',
  policyLever: 'Policy Lever',
  governanceType: 'Governance Type',
  actorInvolvement: 'Actor Involvement',
  enforcementLevel: 'Enforcement Level',
  specificLaws: 'Key Legislation',
};

export function buildSearchIndex(regulationData) {
  const index = [];
  for (const [country, data] of Object.entries(regulationData)) {
    for (const field of SEARCHABLE_FIELDS) {
      const text = data[field];
      if (!text || text.length < 10) continue;
      index.push({
        country,
        field,
        text: text.toLowerCase(),
        original: text,
      });
    }
  }
  return index;
}

const SNIPPET_CONTEXT = 60;

/**
 * Substring search over the index. One result per country (the first
 * matching field wins). Returns:
 *   { country, field, snippet, matchStart, matchLength }
 * where matchStart/matchLength locate the matched term inside snippet
 * so the renderer can wrap it in <mark> without re-searching.
 */
export function searchRegulationText(index, query, maxResults = 20) {
  if (!query || query.length < 3) return [];
  const q = query.toLowerCase();
  const results = [];
  const seen = new Set();

  for (const entry of index) {
    if (seen.has(entry.country)) continue;
    const pos = entry.text.indexOf(q);
    if (pos === -1) continue;
    seen.add(entry.country);

    const start = Math.max(0, pos - SNIPPET_CONTEXT);
    const end = Math.min(entry.original.length, pos + q.length + SNIPPET_CONTEXT);
    const leadingEllipsis = start > 0;
    const snippet = (leadingEllipsis ? '…' : '')
      + entry.original.slice(start, end)
      + (end < entry.original.length ? '…' : '');

    results.push({
      country: entry.country,
      field: entry.field,
      snippet,
      matchStart: pos - start + (leadingEllipsis ? 1 : 0),
      matchLength: q.length,
    });

    if (results.length >= maxResults) break;
  }

  return results;
}
