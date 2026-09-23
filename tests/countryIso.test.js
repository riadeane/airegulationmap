import { describe, it, expect } from 'vitest';
import { normalizeCountryIso, formatIsoCodes } from '../src/data/countryIso';

const FILE = {
  _comment: 'ISO 3166-1 codes',
  schema_version: 1,
  countries: {
    Germany: { iso3: 'DEU', iso2: 'DE', numeric: '276' },
    Kosovo: { iso3: 'XKX', iso2: 'XK', numeric: null },
    Broken: { iso3: 'BRK' },
    Empty: null,
  },
};

describe('normalizeCountryIso', () => {
  it('keeps the two alpha codes per country and drops the numeric', () => {
    const data = normalizeCountryIso(FILE);
    expect(data.Germany).toEqual({ iso2: 'DE', iso3: 'DEU' });
    expect(data.Kosovo).toEqual({ iso2: 'XK', iso3: 'XKX' });
  });

  it('drops entries that lack either alpha code', () => {
    const data = normalizeCountryIso(FILE);
    expect(data.Broken).toBeUndefined();
    expect(data.Empty).toBeUndefined();
  });

  it('returns null for a file without a countries map', () => {
    expect(normalizeCountryIso(null)).toBeNull();
    expect(normalizeCountryIso({ schema_version: 1 })).toBeNull();
    expect(normalizeCountryIso('DE')).toBeNull();
  });
});

describe('formatIsoCodes', () => {
  it('joins alpha-2 and alpha-3 with a middle dot', () => {
    expect(formatIsoCodes({ iso2: 'DE', iso3: 'DEU' })).toBe('DE · DEU');
  });

  it('is empty when the country has no codes', () => {
    expect(formatIsoCodes(null)).toBe('');
    expect(formatIsoCodes(undefined)).toBe('');
  });
});
