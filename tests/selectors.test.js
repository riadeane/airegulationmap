import { describe, it, expect } from 'vitest';
import { setState } from '../src/state/store';
import {
  maturityRank,
  visibleCountrySet,
  passesCountryFilters,
  scoresAtDate,
} from '../src/state/selectors';

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

describe('visibleCountrySet selector', () => {
  const base = () => ({
    scoreData: scores({ A: 5, B: 3, C: 1, NoScore: null }),
    currentAttribute: 'averageScore',
    filterMin: 1,
    filterMax: 5,
    selectedBloc: null,
    blocsData: null,
  });

  it('includes every scored country when no filter is active', () => {
    setState(base());
    expect([...visibleCountrySet()].sort()).toEqual(['A', 'B', 'C']);
  });

  it('applies the score range on the current attribute', () => {
    setState({ ...base(), filterMin: 2, filterMax: 4 });
    expect([...visibleCountrySet()]).toEqual(['B']);
  });

  it('applies the bloc filter — the bug the export path had', () => {
    setState({
      ...base(),
      blocsData: { EU: { name: 'European Union', members: ['A', 'C'] } },
      selectedBloc: 'EU',
    });
    expect([...visibleCountrySet()].sort()).toEqual(['A', 'C']);
    // Range and bloc compose.
    setState({ filterMin: 4 });
    expect([...visibleCountrySet()]).toEqual(['A']);
  });

  it('memoizes on its inputs and invalidates when one changes', () => {
    setState(base());
    const first = visibleCountrySet();
    expect(visibleCountrySet()).toBe(first); // cached: same references
    setState({ filterMax: 3 });
    const second = visibleCountrySet();
    expect(second).not.toBe(first);
    expect([...second].sort()).toEqual(['B', 'C']);
  });
});

describe('passesCountryFilters selector', () => {
  it('is true for everyone without a bloc, and membership-gated with one', () => {
    setState({ selectedBloc: null, blocsData: null });
    expect(passesCountryFilters('Anywhere')).toBe(true);
    setState({
      blocsData: { G2: { name: 'Pair', members: ['A', 'B'] } },
      selectedBloc: 'G2',
    });
    expect(passesCountryFilters('A')).toBe(true);
    expect(passesCountryFilters('C')).toBe(false);
  });
});

describe('scoresAtDate selector', () => {
  const history = {
    schema_version: 1,
    countries: {
      A: [
        { date: '2026-01-01', regulationStatus: 2, policyLever: 2, governanceType: 2, actorInvolvement: 2, enforcementLevel: 2, averageScore: 2 },
        { date: '2026-05-01', regulationStatus: 4, policyLever: 4, governanceType: 4, actorInvolvement: 4, enforcementLevel: 4, averageScore: 4 },
      ],
    },
  };

  it('returns null at "Latest" (no timeline date)', () => {
    setState({ history, timelineDate: null });
    expect(scoresAtDate()).toBeNull();
  });

  it('resolves the step function for the scrubbed date and memoizes', () => {
    setState({ history, timelineDate: '2026-03-01' });
    const at = scoresAtDate();
    expect(at.A.averageScore).toBe(2);
    expect(scoresAtDate()).toBe(at); // cached
    setState({ timelineDate: '2026-06-01' });
    expect(scoresAtDate().A.averageScore).toBe(4);
  });
});
