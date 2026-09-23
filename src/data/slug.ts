// URL slug for a country page: /country/<slug>/.
//
// The slug is derived from the canonical dataset name (scores.csv) so the
// build step and the app agree without a lookup table. Lowercase ASCII
// letters and digits, hyphen-separated: "Côte d'Ivoire" -> "cote-divoire",
// "Dem. Rep. Congo" -> "dem-rep-congo". The build step writes the reverse
// map to public/data/country_slugs.json.

export function countrySlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .replace(/['’]/g, '')         // d'Ivoire -> dIvoire, not d-ivoire
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Site-relative path of a country's static page. */
export function countryPagePath(name: string): string {
  return `/country/${countrySlug(name)}/`;
}
