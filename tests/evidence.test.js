import { describe, it, expect } from 'vitest';
import {
  normalizeEvidence,
  evidenceSentence,
  matchesEvidenceFilter,
  parseEvidenceFilter,
  EVIDENCE_FILTERS,
  EVIDENCE_FILTER_LABELS,
} from '../src/data/evidence';

// The evidence record (PRD 14) as subscores.json stores it: snake_case keys,
// initiatives_used null when the run did not consult the evidence database.

const RUN_ID = '3f0c8a52-6c1e-4b9e-9a57-0d2a1f6b7e11';

function raw(overrides = {}) {
  return {
    grounded: true,
    initiatives_used: 7,
    search: true,
    model: 'claude-opus-5-5',
    run_id: RUN_ID,
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    grounded: true,
    initiativesUsed: 7,
    search: true,
    model: 'claude-opus-5-5',
    runId: RUN_ID,
    ...overrides,
  };
}

describe('normalizeEvidence', () => {
  it('maps a valid grounded record to camelCase', () => {
    expect(normalizeEvidence(raw())).toEqual(record());
  });

  it('keeps a count of 0: the evidence database held nothing for the country', () => {
    expect(normalizeEvidence(raw({ grounded: false, initiatives_used: 0 })))
      .toEqual(record({ grounded: false, initiativesUsed: 0 }));
  });

  it('keeps a null count: the run did not consult the evidence database', () => {
    expect(normalizeEvidence(raw({ grounded: false, initiatives_used: null })))
      .toEqual(record({ grounded: false, initiativesUsed: null }));
    // A missing key reads the same as null.
    const withoutCount = raw({ grounded: false });
    delete withoutCount.initiatives_used;
    expect(normalizeEvidence(withoutCount).initiativesUsed).toBeNull();
  });

  it('rejects non-objects and wrongly typed fields', () => {
    expect(normalizeEvidence(null)).toBeNull();
    expect(normalizeEvidence(undefined)).toBeNull();
    expect(normalizeEvidence('grounded')).toBeNull();
    expect(normalizeEvidence(7)).toBeNull();
    expect(normalizeEvidence(raw({ grounded: 'true' }))).toBeNull();
    expect(normalizeEvidence(raw({ search: 1 }))).toBeNull();
    expect(normalizeEvidence(raw({ initiatives_used: '7' }))).toBeNull();
    expect(normalizeEvidence(raw({ initiatives_used: 2.5 }))).toBeNull();
    expect(normalizeEvidence(raw({ initiatives_used: -1 }))).toBeNull();
  });

  it('rejects a record whose grounded flag disagrees with the count', () => {
    expect(normalizeEvidence(raw({ grounded: false, initiatives_used: 3 }))).toBeNull();
    expect(normalizeEvidence(raw({ grounded: true, initiatives_used: 0 }))).toBeNull();
    expect(normalizeEvidence(raw({ grounded: true, initiatives_used: null }))).toBeNull();
  });

  it('trims model and run_id, and nulls blank or non-string values', () => {
    const trimmed = normalizeEvidence(raw({ model: '  claude-sonnet-5 ', run_id: ` ${RUN_ID}\n` }));
    expect(trimmed.model).toBe('claude-sonnet-5');
    expect(trimmed.runId).toBe(RUN_ID);
    const blank = normalizeEvidence(raw({ model: '   ', run_id: 42 }));
    expect(blank.model).toBeNull();
    expect(blank.runId).toBeNull();
  });
});

describe('evidenceSentence', () => {
  it('names the count and web search for a grounded record', () => {
    const s = evidenceSentence(record());
    expect(s.text).toBe('Grounded in 7 verified policy initiatives and web search');
    expect(s).toEqual({
      before: 'Grounded in 7 ',
      link: 'verified policy initiatives',
      after: ' and web search',
      text: 'Grounded in 7 verified policy initiatives and web search',
    });
  });

  it('uses the singular for one initiative, and says when there was no web search', () => {
    const s = evidenceSentence(record({ initiativesUsed: 1, search: false }));
    expect(s.text).toBe('Grounded in 1 verified policy initiative; no web search');
    expect(s.link).toBe('verified policy initiative');
    expect(s.before + s.link + s.after).toBe(s.text);
  });

  it('keeps the plural for a grounded record without web search', () => {
    expect(evidenceSentence(record({ initiativesUsed: 15, search: false })).text)
      .toBe('Grounded in 15 verified policy initiatives; no web search');
  });

  it('says "no verified initiatives on record" only when the database was consulted', () => {
    const consulted = evidenceSentence(record({ grounded: false, initiativesUsed: 0 }));
    expect(consulted.text).toBe('Web search only; no verified initiatives on record');
    expect(consulted.link).toBeNull();
    expect(consulted.before).toBe(consulted.text);
    expect(consulted.after).toBe('');

    const notConsulted = evidenceSentence(record({ grounded: false, initiativesUsed: null }));
    expect(notConsulted.text).toBe('Web search only; verified initiatives not consulted');
    expect(notConsulted.link).toBeNull();
  });

  it('has "No web search" twins for both ungrounded cases', () => {
    expect(evidenceSentence(record({ grounded: false, initiativesUsed: 0, search: false })).text)
      .toBe('No web search; no verified initiatives on record');
    expect(evidenceSentence(record({ grounded: false, initiativesUsed: null, search: false })).text)
      .toBe('No web search; verified initiatives not consulted');
  });

  it('ends without a period and carries no evaluative adjectives', () => {
    const variants = [
      record(),
      record({ initiativesUsed: 1, search: false }),
      record({ grounded: false, initiativesUsed: 0 }),
      record({ grounded: false, initiativesUsed: null }),
      record({ grounded: false, initiativesUsed: 0, search: false }),
      record({ grounded: false, initiativesUsed: null, search: false }),
    ];
    for (const r of variants) {
      const { text } = evidenceSentence(r);
      expect(text.endsWith('.')).toBe(false);
      expect(text).not.toMatch(/\b(strong|weak|robust|thin|limited)\b/i);
    }
  });
});

describe('matchesEvidenceFilter', () => {
  const grounded = record();
  const searchOnly = record({ grounded: false, initiativesUsed: 0 });
  const notConsulted = record({ grounded: false, initiativesUsed: null });
  const noSearch = record({ grounded: false, initiativesUsed: 0, search: false });

  it('lets every country through "any", including one with no run record', () => {
    for (const r of [grounded, searchOnly, notConsulted, noSearch, null, undefined]) {
      expect(matchesEvidenceFilter(r, 'any')).toBe(true);
    }
  });

  it('"grounded" keeps only records that embedded verified initiatives', () => {
    expect(matchesEvidenceFilter(grounded, 'grounded')).toBe(true);
    expect(matchesEvidenceFilter(record({ search: false }), 'grounded')).toBe(true);
    expect(matchesEvidenceFilter(searchOnly, 'grounded')).toBe(false);
    expect(matchesEvidenceFilter(notConsulted, 'grounded')).toBe(false);
  });

  it('"search" keeps web search without initiatives, whether or not the database was consulted', () => {
    expect(matchesEvidenceFilter(searchOnly, 'search')).toBe(true);
    expect(matchesEvidenceFilter(notConsulted, 'search')).toBe(true);
    expect(matchesEvidenceFilter(grounded, 'search')).toBe(false);
    expect(matchesEvidenceFilter(noSearch, 'search')).toBe(false);
  });

  it('excludes a country with no run record from both narrowing facets', () => {
    expect(matchesEvidenceFilter(null, 'grounded')).toBe(false);
    expect(matchesEvidenceFilter(undefined, 'search')).toBe(false);
  });
});

describe('parseEvidenceFilter', () => {
  it('accepts the two narrowing facets, case- and whitespace-insensitively', () => {
    expect(parseEvidenceFilter('grounded')).toBe('grounded');
    expect(parseEvidenceFilter('search')).toBe('search');
    expect(parseEvidenceFilter(' Grounded ')).toBe('grounded');
    expect(parseEvidenceFilter('SEARCH')).toBe('search');
  });

  it('returns null for "any", junk, and absent values', () => {
    expect(parseEvidenceFilter('any')).toBeNull();
    expect(parseEvidenceFilter('search-only')).toBeNull();
    expect(parseEvidenceFilter('')).toBeNull();
    expect(parseEvidenceFilter(null)).toBeNull();
    expect(parseEvidenceFilter(undefined)).toBeNull();
  });

  it('has a label for every facet', () => {
    expect(EVIDENCE_FILTERS).toEqual(['any', 'grounded', 'search']);
    for (const f of EVIDENCE_FILTERS) expect(EVIDENCE_FILTER_LABELS[f]).toBeTruthy();
  });
});
