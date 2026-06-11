// Shared country-name autocomplete matching: substring filter with
// prefix matches sorted first. Used by the header search and the
// comparison add-bar.

export interface MatchOptions {
  limit?: number;
  exclude?: Set<string> | null;
}

export function matchCountryNames(
  names: string[],
  query: string,
  { limit = 8, exclude = null }: MatchOptions = {}
): string[] {
  const q = query.toLowerCase();
  if (!q) return [];
  return names
    .filter(name => (!exclude || !exclude.has(name)) && name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(q);
      const bStarts = b.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.localeCompare(b);
    })
    .slice(0, limit);
}
