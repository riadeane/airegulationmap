import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSearchIndex, searchRegulationText, searchAllMatches } from '../src/data/searchIndex';
import { matchCountryNames, parseCountryAliases, BUILTIN_ALIASES } from '../src/data/countryMatch';
import { findFolded, foldText } from '../src/data/fold';
import { parseScoresCsv } from '../src/data/loader';

const regulationData = {
  France: {
    regulationStatus: 'The EU AI Act applies; a regulatory sandbox program launched in 2024.',
    policyLever: 'Binding legislation with risk-based obligations.',
    governanceType: null,
    actorInvolvement: 'short', // < 10 chars - must be skipped
    enforcementLevel: 'CNIL enforces with administrative fines.',
    specificLaws: 'EU AI Act (2024)',
  },
  Singapore: {
    regulationStatus: 'Voluntary framework; an AI sandbox supports model testing.',
    policyLever: 'Soft-law guidance through the Model AI Governance Framework.',
    governanceType: 'Centralized under IMDA.',
    actorInvolvement: 'Industry consultation is extensive.',
    enforcementLevel: null,
    specificLaws: null,
  },
};

describe('buildSearchIndex', () => {
  it('indexes only non-empty fields of sufficient length', () => {
    const index = buildSearchIndex(regulationData);
    const franceFields = index.filter(e => e.country === 'France').map(e => e.field);
    expect(franceFields).toContain('regulationStatus');
    expect(franceFields).toContain('specificLaws');
    expect(franceFields).not.toContain('governanceType'); // null
    expect(franceFields).not.toContain('actorInvolvement'); // too short
  });
});

describe('searchRegulationText', () => {
  const index = buildSearchIndex(regulationData);

  it('returns [] for queries shorter than 3 characters', () => {
    expect(searchRegulationText(index, 'ai')).toEqual([]);
    expect(searchRegulationText(index, '')).toEqual([]);
  });

  it('matches case-insensitively and dedupes by country', () => {
    const results = searchRegulationText(index, 'SANDBOX');
    expect(results.map(r => r.country)).toEqual(['France', 'Singapore']);
  });

  it('locates the match inside the snippet via matchStart/matchLength', () => {
    const [r] = searchRegulationText(index, 'sandbox');
    const term = r.snippet.slice(r.matchStart, r.matchStart + r.matchLength);
    expect(term.toLowerCase()).toBe('sandbox');
  });

  it('adds ellipses when the snippet is windowed', () => {
    const longText = 'x'.repeat(100) + ' keyword sits here ' + 'y'.repeat(100);
    const idx = buildSearchIndex({ A: { regulationStatus: longText } });
    const [r] = searchRegulationText(idx, 'keyword');
    expect(r.snippet.startsWith('…')).toBe(true);
    expect(r.snippet.endsWith('…')).toBe(true);
    expect(r.snippet.slice(r.matchStart, r.matchStart + r.matchLength)).toBe('keyword');
  });

  it('caps results at maxResults', () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`C${i}`, { regulationStatus: 'a common phrase appears here' }])
    );
    const idx = buildSearchIndex(many);
    expect(searchRegulationText(idx, 'common phrase', 5)).toHaveLength(5);
  });

  it('searchAllMatches is the uncapped variant, still one row per country', () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`C${i}`, {
        regulationStatus: 'a common phrase appears here',
        policyLever: 'the common phrase appears again in a second field',
      }])
    );
    const idx = buildSearchIndex(many);
    const all = searchAllMatches(idx, 'common phrase');
    expect(all).toHaveLength(30);
    expect(new Set(all.map(m => m.country)).size).toBe(30);
  });
});

describe('matchCountryNames', () => {
  const names = ['France', 'Gabon', 'Georgia', 'Germany', 'Niger', 'Nigeria'];

  it('puts prefix matches before substring matches', () => {
    expect(matchCountryNames(names, 'ger')).toEqual(['Germany', 'Niger', 'Nigeria']);
  });

  it('respects the exclude set and limit', () => {
    expect(matchCountryNames(names, 'g', { limit: 2, exclude: new Set(['Gabon']) }))
      .toEqual(['Georgia', 'Germany']);
  });

  it('returns [] for an empty query', () => {
    expect(matchCountryNames(names, '')).toEqual([]);
  });
});

// Regression: the matcher was a plain toLowerCase().includes(), so "cote",
// "turkiye" and every official or everyday name the dataset spells
// differently found nothing. Checked against the real dataset names.
describe('country search ignores diacritics and knows aliases', () => {
  const datasetNames = Object.keys(
    parseScoresCsv(readFileSync(new URL('../public/scores.csv', import.meta.url), 'utf8'))
  ).sort();
  const fileAliases = parseCountryAliases(
    JSON.parse(readFileSync(new URL('../public/data/country_names.json', import.meta.url), 'utf8'))
  );

  const cases = [
    ['cote', "Côte d'Ivoire"],
    ['ivory coast', "Côte d'Ivoire"],
    ['turkiye', 'Turkey'],
    ['türkiye', 'Turkey'],
    ['czech republic', 'Czechia'],
    ['north macedonia', 'Macedonia'],
    ['eswatini', 'Swaziland'],
    ['south sudan', 'S. Sudan'],
    ['bosnia and herzegovina', 'Bosnia and Herz.'],
    ['usa', 'United States of America'],
    ['timor-leste', 'East Timor'],
    ['cabo verde', 'Cape Verde'],
    ['democratic republic of the congo', 'Dem. Rep. Congo'],
    ['central african republic', 'Central African Rep.'],
  ];

  it.each(cases)('"%s" finds %s on the built-in aliases alone', (query, name) => {
    expect(matchCountryNames(datasetNames, query)).toContain(name);
  });

  it.each(cases)('"%s" finds %s with the country_names.json aliases merged', (query, name) => {
    expect(matchCountryNames(datasetNames, query, { aliases: fileAliases })).toContain(name);
  });

  it('ranks an alias prefix match first and returns the dataset name', () => {
    expect(matchCountryNames(datasetNames, 'us')[0]).toBe('United States of America');
    expect(matchCountryNames(datasetNames, 'CÔTE')).toEqual(["Côte d'Ivoire"]);
  });

  it('keys every built-in alias to a name in scores.csv', () => {
    for (const name of Object.keys(BUILTIN_ALIASES)) expect(datasetNames).toContain(name);
  });

  it('inverts country_names.json (alias -> canonical) and skips junk', () => {
    expect(parseCountryAliases({ aliases: { 'Viet Nam': 'Vietnam', 'Czech Republic': 'Czechia', Bad: 7 } }))
      .toEqual({ Vietnam: ['Viet Nam'], Czechia: ['Czech Republic'] });
    expect(parseCountryAliases(null)).toBeNull();
  });
});

describe('full-text search ignores diacritics', () => {
  const index = buildSearchIndex({
    Ghana: { regulationStatus: "Trade talks with Côte d'Ivoire covered a shared data-protection code." },
    Iceland: { policyLever: 'Persónuvernd has published AI-and-data-protection guidance.' },
  });

  it('matches an unaccented query and marks the accented original', () => {
    const [r] = searchRegulationText(index, 'cote d');
    expect(r.country).toBe('Ghana');
    expect(r.snippet.slice(r.matchStart, r.matchStart + r.matchLength)).toBe('Côte d');
  });

  it('matches an accented query against accented text', () => {
    const [r] = searchRegulationText(index, 'PERSÓNU');
    expect(r.snippet.slice(r.matchStart, r.matchStart + r.matchLength)).toBe('Persónu');
  });

  it('keeps offsets aligned when folding shifts positions', () => {
    // A decomposed "é" (e + U+0301) folds to one character.
    const text = 'Cafe\u0301 rules and a sandbox regime.';
    const idx = buildSearchIndex({ X: { regulationStatus: text } });
    const [r] = searchRegulationText(idx, 'sandbox');
    expect(r.snippet.slice(r.matchStart, r.matchStart + r.matchLength)).toBe('sandbox');
    expect(findFolded(text, 'cafe rules')).toEqual({ start: 0, end: text.indexOf(' and') });
  });

  it('folds case, marks and curly apostrophes', () => {
    expect(foldText('Côte d’Ivoire')).toBe("cote d'ivoire");
  });
});
