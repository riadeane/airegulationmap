import { describe, it, expect } from 'vitest';
import { buildSearchIndex, searchRegulationText } from '../src/data/searchIndex.js';
import { matchCountryNames } from '../src/data/countryMatch.js';

const regulationData = {
  France: {
    regulationStatus: 'The EU AI Act applies; a regulatory sandbox program launched in 2024.',
    policyLever: 'Binding legislation with risk-based obligations.',
    governanceType: null,
    actorInvolvement: 'short', // < 10 chars — must be skipped
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
