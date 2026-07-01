import { describe, it, expect } from 'vitest';
import { setState } from '../src/state/store';
import { maturityRank } from '../src/state/selectors';

// The ranking is memoized by scoreData reference; each test installs its own
// fresh scoreData object, which invalidates the cache.

function scores(map) {
  const data = {};
  for (const [name, averageScore] of Object.entries(map)) {
    data[name] = { country: name, averageScore };
  }
  return data;
}

describe('maturityRank selector', () => {
  it('ranks by descending maturity, counting only scored countries', () => {
    setState({ scoreData: scores({ A: 5, B: 3, C: 1 }) });
    expect(maturityRank('A')).toEqual({ rank: 1, total: 3 });
    expect(maturityRank('B')).toEqual({ rank: 2, total: 3 });
    expect(maturityRank('C')).toEqual({ rank: 3, total: 3 });
  });

  it('shares a rank for ties (strictly-higher count + 1)', () => {
    setState({ scoreData: scores({ A: 5, B: 4, C: 4, D: 2 }) });
    expect(maturityRank('A').rank).toBe(1);
    expect(maturityRank('B')).toEqual({ rank: 2, total: 4 });
    expect(maturityRank('C')).toEqual({ rank: 2, total: 4 }); // tie with B
    expect(maturityRank('D')).toEqual({ rank: 4, total: 4 }); // 3 strictly higher
  });

  it('returns null for an unscored or unknown country', () => {
    setState({ scoreData: scores({ A: 5, Blank: null }) });
    expect(maturityRank('Blank')).toBeNull();
    expect(maturityRank('Nowhere')).toBeNull();
  });
});
