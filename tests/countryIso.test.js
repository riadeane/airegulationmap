import { describe, it, expect } from 'vitest';
import { normalizeCountryIso, formatIsoCodes, isoNumericIndex } from '../src/data/countryIso';
import { resolveFeatureNames } from '../src/map/geometryNames';

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

describe('isoNumericIndex', () => {
  it('maps each ISO numeric (leading zeros dropped) to the dataset name', () => {
    const index = isoNumericIndex({
      countries: {
        'Solomon Islands': { iso3: 'SLB', iso2: 'SB', numeric: '090' },
        Germany: { iso3: 'DEU', iso2: 'DE', numeric: '276' },
        Kosovo: { iso3: 'XKX', iso2: 'XK', numeric: null },
      },
    });
    expect(index).toEqual({ 90: 'Solomon Islands', 276: 'Germany' });
  });

  it('returns an empty index for a missing file', () => {
    expect(isoNumericIndex(null)).toEqual({});
  });
});

describe('resolveFeatureNames', () => {
  const geo = (name, id) => ({ type: 'Feature', id, properties: { name }, geometry: null });

  it('renames atlas geometries to the dataset name through the ISO id', () => {
    const features = [
      geo('Eq. Guinea', '226'),
      geo('Solomon Is.', '090'),
      geo('Germany', '276'),
      geo('Antarctica', '010'),
      geo('Somaliland', undefined),
    ];
    const datasetNames = new Set(['Equatorial Guinea', 'Solomon Islands', 'Germany']);
    const byNumeric = { 226: 'Equatorial Guinea', 90: 'Solomon Islands', 276: 'Germany' };
    resolveFeatureNames(features, datasetNames, byNumeric);
    expect(features.map(f => f.properties.name)).toEqual([
      'Equatorial Guinea', 'Solomon Islands', 'Germany', 'Antarctica', 'Somaliland',
    ]);
  });

  it('keeps an atlas name that already matches the dataset', () => {
    const features = [geo('Kosovo', undefined)];
    resolveFeatureNames(features, new Set(['Kosovo']), {});
    expect(features[0].properties.name).toBe('Kosovo');
  });
});
