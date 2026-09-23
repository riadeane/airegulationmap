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

export async function loadCountryIso(): Promise<CountryIsoData | null> {
  try {
    const response = await fetch('/data/country_iso.json');
    if (!response.ok) return null;
    return normalizeCountryIso(await response.json());
  } catch {
    console.warn('country_iso.json not available, ISO codes hidden');
    return null;
  }
}
