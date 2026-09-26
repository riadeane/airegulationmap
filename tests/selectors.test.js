import { describe, it, expect } from 'vitest';
import { setState } from '../src/state/store';
import {
  maturityRank,
  visibleCountrySet,
  passesCountryFilters,
  evidenceOf,
  evidenceFacetCounts,
  scoresAtDate,
  recentScoreChanges,
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
    regulationData: {},
    currentAttribute: 'averageScore',
    filterMin: 1,
    filterMax: 5,
    selectedBloc: null,
    blocsData: null,
    filterConfidence: null,
    filterOfficialOnly: false,
    filterEvidence: 'any',
    subscores: null,
  });

  it('includes every scored country when no filter is active', () => {
    setState(base());
    expect([...visibleCountrySet()].sort()).toEqual(['A', 'B', 'C']);
  });

  it('applies the score range on the current attribute', () => {
    setState({ ...base(), filterMin: 2, filterMax: 4 });
    expect([...visibleCountrySet()]).toEqual(['B']);
  });

  it('applies the bloc filter - the bug the export path had', () => {
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

  it('applies the confidence filter, excluding unknown confidence', () => {
    setState({
      ...base(),
      regulationData: {
        A: { confidence: 'high' },
        B: { confidence: 'Low' },   // case-insensitive
        C: {},                       // unknown - never passes a filter
      },
      filterConfidence: ['high', 'low'],
    });
    expect([...visibleCountrySet()].sort()).toEqual(['A', 'B']);
    setState({ filterConfidence: ['medium'] });
    expect([...visibleCountrySet()]).toEqual([]);
  });

  it('applies the official-sources-only filter', () => {
    setState({
      ...base(),
      regulationData: {
        A: { sources: 'https://legislation.gov.uk/act | https://example.com/blog' },
        B: { sources: 'https://example.com/commentary' },
        C: { sources: null },
      },
      filterOfficialOnly: true,
    });
    expect([...visibleCountrySet()]).toEqual(['A']);
  });
});

describe('passesCountryFilters selector', () => {
  it('is true for everyone without a bloc, and membership-gated with one', () => {
    // Reset every country-level filter - the store persists across tests
    // in this file, and earlier cases set confidence filters.
    setState({
      selectedBloc: null, blocsData: null, regulationData: {},
      filterConfidence: null, filterOfficialOnly: false,
      filterEvidence: 'any', subscores: null,
    });
    expect(passesCountryFilters('Anywhere')).toBe(true);
    setState({
      blocsData: { G2: { name: 'Pair', members: ['A', 'B'] } },
      selectedBloc: 'G2',
    });
    expect(passesCountryFilters('A')).toBe(true);
    expect(passesCountryFilters('C')).toBe(false);
  });
});

// The evidence facet (PRD 14). Records live in subscores.json, normalized to
// camelCase; A is grounded, B search-only (database consulted, nothing on
// record), C search-only from a run that did not consult the database, D
// researched without web search, and E has no run record at all.
describe('evidence facet', () => {
  const grounded = { grounded: true, initiativesUsed: 7, search: true, model: 'm', runId: 'r' };
  const searchOnly = { grounded: false, initiativesUsed: 0, search: true, model: 'm', runId: 'r' };
  const notConsulted = { grounded: false, initiativesUsed: null, search: true, model: 'm', runId: 'r' };
  const noSearch = { grounded: false, initiativesUsed: 0, search: false, model: 'm', runId: 'r' };

  const subscores = () => ({
    schema_version: 1,
    countries: {
      A: { date: '2026-09-21', evidence: grounded },
      B: { date: '2026-09-21', evidence: searchOnly },
      C: { date: '2026-09-21', evidence: notConsulted },
      D: { date: '2026-09-21', evidence: noSearch },
      E: { date: '2026-06-13' },
    },
  });

  const base = () => ({
    scoreData: scores({ A: 5, B: 4, C: 3, D: 2, E: 1 }),
    regulationData: {},
    currentAttribute: 'averageScore',
    filterMin: 1,
    filterMax: 5,
    selectedBloc: null,
    blocsData: null,
    filterConfidence: null,
    filterOfficialOnly: false,
    filterEvidence: 'any',
    subscores: subscores(),
  });

  it('evidenceOf reads the record, null without one or before subscores load', () => {
    setState(base());
    expect(evidenceOf('A')).toEqual(grounded);
    expect(evidenceOf('E')).toBeNull();
    expect(evidenceOf('Nowhere')).toBeNull();
    setState({ subscores: null });
    expect(evidenceOf('A')).toBeNull();
  });

  // Regression: before the first research run records evidence, the
  // narrowing facets emptied the map; the popover disables an option whose
  // count is 0.
  it('counts the countries each narrowing facet would keep', () => {
    setState(base());
    expect(evidenceFacetCounts()).toEqual({ grounded: 1, search: 2 });
    setState({ subscores: { schema_version: 1, countries: { A: { date: '2026-06-13' } } } });
    expect(evidenceFacetCounts()).toEqual({ grounded: 0, search: 0 });
    setState({ subscores: null });
    expect(evidenceFacetCounts()).toEqual({ grounded: 0, search: 0 });
  });

  it('"any" keeps every country, with or without a run record', () => {
    setState(base());
    expect([...visibleCountrySet()].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(passesCountryFilters('E')).toBe(true);
  });

  it('"grounded" keeps only countries whose research embedded verified initiatives', () => {
    setState({ ...base(), filterEvidence: 'grounded' });
    expect([...visibleCountrySet()]).toEqual(['A']);
    expect(passesCountryFilters('A')).toBe(true);
    expect(passesCountryFilters('B')).toBe(false);
    expect(passesCountryFilters('E')).toBe(false);
  });

  it('"search" keeps web search without initiatives and excludes countries with no record', () => {
    setState({ ...base(), filterEvidence: 'search' });
    expect([...visibleCountrySet()].sort()).toEqual(['B', 'C']);
    expect(passesCountryFilters('D')).toBe(false); // no web search
    expect(passesCountryFilters('E')).toBe(false); // no run record
  });

  it('composes with the confidence filter: a country must pass both', () => {
    setState({
      ...base(),
      regulationData: {
        A: { confidence: 'low' },
        B: { confidence: 'high' },
        C: { confidence: 'medium' },
        E: { confidence: 'high' },
      },
      filterConfidence: ['high', 'medium'],
      filterEvidence: 'search',
    });
    expect([...visibleCountrySet()].sort()).toEqual(['B', 'C']);
    setState({ filterEvidence: 'grounded' });
    // A is grounded but low confidence; B is high confidence but ungrounded.
    expect([...visibleCountrySet()]).toEqual([]);
  });

  it('composes with the official-sources filter and the score range', () => {
    setState({
      ...base(),
      regulationData: {
        A: { sources: 'https://legislation.gov.uk/act' },
        B: { sources: 'https://example.com/commentary' },
        C: { sources: 'https://www.gov.uk/guidance' },
      },
      filterOfficialOnly: true,
      filterEvidence: 'search',
    });
    expect([...visibleCountrySet()]).toEqual(['C']);
    setState({ filterEvidence: 'grounded' });
    expect([...visibleCountrySet()]).toEqual(['A']);
    setState({ filterMax: 4 });
    expect([...visibleCountrySet()]).toEqual([]);
  });

  it('composes with the bloc filter', () => {
    setState({
      ...base(),
      blocsData: { G3: { name: 'Three', members: ['B', 'C', 'E'] } },
      selectedBloc: 'G3',
      filterEvidence: 'search',
    });
    expect([...visibleCountrySet()].sort()).toEqual(['B', 'C']);
  });

  it('invalidates the cache when the facet changes or subscores.json lands', () => {
    // A deep link applies evidence=grounded before subscores.json loads:
    // nobody passes yet, and the late load must not serve the stale set.
    setState({ ...base(), subscores: null, filterEvidence: 'grounded' });
    const before = visibleCountrySet();
    expect([...before]).toEqual([]);
    expect(visibleCountrySet()).toBe(before); // memoized

    setState({ subscores: subscores() });
    const loaded = visibleCountrySet();
    expect(loaded).not.toBe(before);
    expect([...loaded]).toEqual(['A']);

    setState({ filterEvidence: 'search' });
    const switched = visibleCountrySet();
    expect(switched).not.toBe(loaded);
    expect([...switched].sort()).toEqual(['B', 'C']);

    setState({ filterEvidence: 'any' });
    expect(visibleCountrySet().size).toBe(5);
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

  it('resolves known snapshot dates and memoizes', () => {
    setState({ history, timelineDate: '2026-01-01' });
    const at = scoresAtDate();
    expect(at.A.averageScore).toBe(2);
    expect(scoresAtDate()).toBe(at); // cached
    setState({ timelineDate: '2026-05-01' });
    expect(scoresAtDate().A.averageScore).toBe(4);
  });

  it('falls back to null for a date the history never recorded', () => {
    // A hand-edited ?date= must not render a misleading carried-back
    // vintage - the map and panel both treat it as Latest.
    setState({ history, timelineDate: '2026-03-01' });
    expect(scoresAtDate()).toBeNull();
  });
});

describe('recentScoreChanges selector', () => {
  const snap = (date, overrides = {}) => ({
    date,
    regulationStatus: 2,
    policyLever: 2,
    governanceType: 2,
    actorInvolvement: 2,
    enforcementLevel: 2,
    averageScore: 2,
    ...overrides,
  });
  const history = () => ({
    schema_version: 1,
    countries: {
      Moved: [snap('2026-06-13'), snap('2026-09-21', { policyLever: 2.5 })],
      Still: [snap('2026-06-13')],
    },
  });

  it('is empty before history loads', () => {
    setState({ history: null });
    expect(recentScoreChanges('2026-09-23')).toEqual([]);
  });

  it('reads the store history for the given day', () => {
    setState({ history: history() });
    expect(recentScoreChanges('2026-09-23')).toEqual([
      { country: 'Moved', dimension: 'policyLever', label: 'Policy Lever', delta: 0.5, date: '2026-09-21' },
    ]);
    // A day outside the window sees nothing.
    expect(recentScoreChanges('2026-10-15')).toEqual([]);
  });

  it('memoizes on the history reference and the day', () => {
    const h = history();
    setState({ history: h });
    const first = recentScoreChanges('2026-09-23');
    expect(recentScoreChanges('2026-09-23')).toBe(first);
    expect(recentScoreChanges('2026-09-24')).not.toBe(first);
    setState({ history: history() });
    expect(recentScoreChanges('2026-09-23')).not.toBe(first);
  });
});
