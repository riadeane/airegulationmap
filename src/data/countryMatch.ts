// Shared country-name autocomplete matching: substring filter with
// prefix matches sorted first. Used by the header search and the
// comparison add-bar.
//
// Matching ignores case and diacritics ("cote" finds Côte d'Ivoire) and
// also tries each name's aliases ("ivory coast", "usa"), so a reader who
// types the everyday or official name still finds the dataset's spelling.
// Results always carry the dataset name.

import { foldText } from './fold';

/** Dataset name -> the other names it answers to in search. */
export type CountryAliases = Readonly<Record<string, readonly string[]>>;

/**
 * Everyday and official names the dataset spells differently. Always on,
 * so search works before (or without) country_names.json; the file's
 * alias list is merged on top once it loads. Keys are scores.csv names.
 */
export const BUILTIN_ALIASES: CountryAliases = {
  'Bosnia and Herz.': ['Bosnia and Herzegovina'],
  'Cape Verde': ['Cabo Verde'],
  'Central African Rep.': ['Central African Republic'],
  "Côte d'Ivoire": ['Ivory Coast'],
  'Czechia': ['Czech Republic'],
  'Dem. Rep. Congo': ['DR Congo', 'DRC', 'Democratic Republic of the Congo'],
  'East Timor': ['Timor-Leste'],
  'Macedonia': ['North Macedonia'],
  'Myanmar': ['Burma'],
  'Netherlands': ['Holland'],
  'Russia': ['Russian Federation'],
  'S. Sudan': ['South Sudan'],
  'South Korea': ['Republic of Korea'],
  'Swaziland': ['Eswatini'],
  'Turkey': ['Türkiye'],
  'United Arab Emirates': ['UAE'],
  'United Kingdom': ['UK', 'Great Britain', 'Britain'],
  'United States of America': ['USA', 'US', 'United States'],
  'Vatican City': ['Holy See'],
  'Vietnam': ['Viet Nam'],
};

/**
 * country_names.json maps alias -> canonical; invert it to canonical ->
 * aliases. Anything that is not a string pair is skipped.
 */
export function parseCountryAliases(raw: unknown): CountryAliases | null {
  if (!raw || typeof raw !== 'object') return null;
  const aliases = (raw as { aliases?: unknown }).aliases;
  if (!aliases || typeof aliases !== 'object') return null;
  const out: Record<string, string[]> = {};
  for (const [alias, canonical] of Object.entries(aliases as Record<string, unknown>)) {
    if (typeof canonical !== 'string' || !alias.trim()) continue;
    (out[canonical] ??= []).push(alias);
  }
  return out;
}

/** The pipeline's alias list, or null when the file is missing. */
export async function loadCountryAliases(): Promise<CountryAliases | null> {
  try {
    const response = await fetch('/data/country_names.json');
    if (!response.ok) return null;
    return parseCountryAliases(await response.json());
  } catch {
    return null;
  }
}

export interface MatchOptions {
  limit?: number;
  exclude?: Set<string> | null;
  /** Extra aliases (country_names.json), merged with BUILTIN_ALIASES. */
  aliases?: CountryAliases | null;
}

function searchKeys(name: string, aliases: CountryAliases | null): string[] {
  return [name, ...(BUILTIN_ALIASES[name] ?? []), ...(aliases?.[name] ?? [])].map(foldText);
}

export function matchCountryNames(
  names: readonly string[],
  query: string,
  { limit = 8, exclude = null, aliases = null }: MatchOptions = {}
): string[] {
  const q = foldText(query);
  if (!q) return [];
  const matches: { name: string; prefix: boolean }[] = [];
  for (const name of names) {
    if (exclude && exclude.has(name)) continue;
    const keys = searchKeys(name, aliases);
    if (!keys.some(k => k.includes(q))) continue;
    matches.push({ name, prefix: keys.some(k => k.startsWith(q)) });
  }
  return matches
    .sort((a, b) => {
      if (a.prefix && !b.prefix) return -1;
      if (!a.prefix && b.prefix) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map(m => m.name);
}
