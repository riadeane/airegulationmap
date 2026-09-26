// ISO 3166-1 codes per dataset country name, from
// public/data/country_iso.json. The panel shows them beside the country
// name, and the printable brief carries them so a paper copy joins
// cleanly to other datasets.

export interface CountryIsoCodes {
  iso2: string;
  iso3: string;
}

export type CountryIsoData = Record<string, CountryIsoCodes>;

/**
 * Coerce a parsed country_iso.json into name -> codes. An entry without
 * both alpha codes is dropped; the panel then shows no codes for it.
 */
export function normalizeCountryIso(raw: unknown): CountryIsoData | null {
  if (!raw || typeof raw !== 'object') return null;
  const countries = (raw as { countries?: unknown }).countries;
  if (!countries || typeof countries !== 'object') return null;
  const out: CountryIsoData = {};
  for (const [name, entry] of Object.entries(countries as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const { iso2, iso3 } = entry as { iso2?: unknown; iso3?: unknown };
    if (typeof iso2 !== 'string' || typeof iso3 !== 'string') continue;
    out[name] = { iso2, iso3 };
  }
  return out;
}

/** "DE · DEU": the alpha-2 and alpha-3 codes as the panel shows them. */
export function formatIsoCodes(codes: CountryIsoCodes | null | undefined): string {
  return codes ? `${codes.iso2} · ${codes.iso3}` : '';
}

/**
 * ISO numeric -> dataset name. world-atlas geometry ids are ISO 3166-1
 * numeric, so the map joins a geometry whose atlas name differs from the
 * dataset's ("Eq. Guinea" vs "Equatorial Guinea") through this index.
 * Keys drop leading zeros so "090" and "90" meet.
 */
export function isoNumericIndex(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  const countries = (raw as { countries?: unknown }).countries;
  if (!countries || typeof countries !== 'object') return out;
  for (const [name, entry] of Object.entries(countries as Record<string, unknown>)) {
    const numeric = (entry as { numeric?: unknown } | null)?.numeric;
    if (typeof numeric !== 'string' || !numeric) continue;
    out[numericKey(numeric)] = name;
  }
  return out;
}

/** Normalise an ISO numeric or atlas id for lookups ("090" -> "90"). */
export function numericKey(id: string | number): string {
  return String(id).replace(/^0+(?=\d)/, '');
}

// One request serves both the map's id join (needed before first paint)
// and the panel's codes (loaded after).
let rawRequest: Promise<unknown> | null = null;
function fetchCountryIsoRaw(): Promise<unknown> {
  rawRequest ??= fetch('/data/country_iso.json')
    .then(response => (response.ok ? response.json() : null))
    .catch(() => null);
  return rawRequest;
}

/** ISO numeric -> dataset name, or an empty index when the file is missing. */
export async function loadIsoNumericIndex(): Promise<Record<string, string>> {
  return isoNumericIndex(await fetchCountryIsoRaw());
}

export async function loadCountryIso(): Promise<CountryIsoData | null> {
  const data = normalizeCountryIso(await fetchCountryIsoRaw());
  if (!data) console.warn('country_iso.json not available, ISO codes hidden');
  return data;
}
