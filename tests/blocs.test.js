import { describe, it, expect } from 'vitest';
import { computeBlocStats } from '../src/data/blocs.js';

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
