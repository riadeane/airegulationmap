import { describe, it, expect } from 'vitest';
import { computeBlocStats, computeBlocEvidenceShare, blocEvidenceShareText } from '../src/data/blocs';

const scoreData = {
  France: { averageScore: 4, enforcementLevel: 4 },
  Germany: { averageScore: 4.5, enforcementLevel: 5 },
  Italy: { averageScore: 3.5, enforcementLevel: null },
  Andorra: { averageScore: null },
};

describe('computeBlocStats', () => {
  it('computes average, min/max, and population standard deviation', () => {
    const stats = computeBlocStats(['France', 'Germany', 'Italy'], scoreData, 'averageScore');
    expect(stats.average).toBe(4);          // (4 + 4.5 + 3.5) / 3
    expect(stats.min).toBe(3.5);
    expect(stats.max).toBe(4.5);
    expect(stats.stdDev).toBe(0.41);        // sqrt(((0)^2 + (0.5)^2 + (-0.5)^2) / 3)
    expect(stats.memberCount).toBe(3);
    expect(stats.scoredCount).toBe(3);
  });

  it('identifies highest and lowest scoring members', () => {
    const stats = computeBlocStats(['France', 'Germany', 'Italy'], scoreData, 'averageScore');
    expect(stats.highest).toEqual({ name: 'Germany', score: 4.5 });
    expect(stats.lowest).toEqual({ name: 'Italy', score: 3.5 });
  });

  it('excludes null scores and unknown countries from the math but not memberCount', () => {
    const stats = computeBlocStats(['France', 'Italy', 'Andorra', 'Atlantis'], scoreData, 'enforcementLevel');
    expect(stats.scoredCount).toBe(1);      // only France has enforcement
    expect(stats.memberCount).toBe(4);
    expect(stats.average).toBe(4);
    expect(stats.stdDev).toBe(0);
  });

  it('returns null when no member has a score', () => {
    expect(computeBlocStats(['Andorra', 'Atlantis'], scoreData, 'enforcementLevel')).toBeNull();
    expect(computeBlocStats([], scoreData, 'averageScore')).toBeNull();
  });
});

describe('computeBlocEvidenceShare', () => {
  const grounded = { grounded: true, initiativesUsed: 7, search: true, model: null, runId: null };
  const searchOnly = { grounded: false, initiativesUsed: 0, search: true, model: null, runId: null };
  const notConsulted = { grounded: false, initiativesUsed: null, search: true, model: null, runId: null };
  const records = {
    France: grounded,
    Germany: grounded,
    Italy: searchOnly,
    Spain: notConsulted,
  };
  const evidenceOf = name => records[name] ?? null;

  it('divides grounded members by members with a run record', () => {
    expect(computeBlocEvidenceShare(['France', 'Germany', 'Italy', 'Spain'], evidenceOf)).toEqual({
      memberCount: 4, recorded: 4, grounded: 2, share: 0.5,
    });
  });

  it('leaves members without a record out of the denominator, not out of memberCount', () => {
    const share = computeBlocEvidenceShare(['France', 'Italy', 'Andorra', 'Atlantis'], evidenceOf);
    expect(share).toEqual({ memberCount: 4, recorded: 2, grounded: 1, share: 0.5 });
  });

  it('counts a run that did not consult the evidence database as ungrounded', () => {
    expect(computeBlocEvidenceShare(['Spain'], evidenceOf)).toEqual({
      memberCount: 1, recorded: 1, grounded: 0, share: 0,
    });
  });

  it('returns null when no member has a run record', () => {
    expect(computeBlocEvidenceShare(['Andorra', 'Atlantis'], evidenceOf)).toBeNull();
    expect(computeBlocEvidenceShare([], evidenceOf)).toBeNull();
    expect(computeBlocEvidenceShare(['France'], () => undefined)).toBeNull();
  });

  it('computes the share as a fraction', () => {
    const three = computeBlocEvidenceShare(['France', 'Italy', 'Spain'], evidenceOf);
    expect(three.share).toBeCloseTo(1 / 3);
    expect(computeBlocEvidenceShare(['France', 'Germany'], evidenceOf).share).toBe(1);
  });
});

describe('blocEvidenceShareText', () => {
  it('reads "of N members" when every member has a run record', () => {
    expect(blocEvidenceShareText({ memberCount: 27, recorded: 27, grounded: 12, share: 12 / 27 }))
      .toBe('Grounded in verified initiatives: 12 of 27 members (44%)');
  });

  it('qualifies the denominator while some members have no record', () => {
    expect(blocEvidenceShareText({ memberCount: 27, recorded: 20, grounded: 12, share: 12 / 20 }))
      .toBe('Grounded in verified initiatives: 12 of 20 members with a run record (60%)');
  });

  it('rounds the percentage to an integer', () => {
    expect(blocEvidenceShareText({ memberCount: 3, recorded: 3, grounded: 2, share: 2 / 3 }))
      .toBe('Grounded in verified initiatives: 2 of 3 members (67%)');
    expect(blocEvidenceShareText({ memberCount: 3, recorded: 3, grounded: 0, share: 0 }))
      .toBe('Grounded in verified initiatives: 0 of 3 members (0%)');
  });
});
