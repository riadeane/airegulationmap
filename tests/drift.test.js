import { describe, it, expect } from 'vitest';
import { goldTooltip } from '../src/charts/drift';
import {
  binDeltas,
  computeBlocDrift,
  computeWeeklyChanges,
  confidenceByVintage,
  confidenceTotals,
  dominantDimension,
  largestMoves,
  latestResearchRun,
  latestWeek,
  parseDriftChecks,
  parseGateCounts,
  parseResearchRun,
  percent,
  snakeDimensionLabel,
  summarizeDeltas,
} from '../src/data/drift';

const snap = (date, overrides = {}) => ({
  date,
  regulationStatus: 2,
  policyLever: 2,
  governanceType: 2,
  actorInvolvement: 2,
  enforcementLevel: 2,
  averageScore: 2.0,
  ...overrides,
});

const history = {
  schema_version: 1,
  countries: {
    // Changed twice: a small move in April, a larger one in June.
    Albania: [
      snap('2026-03-21'),
      snap('2026-04-01', { actorInvolvement: 2.25 }),
      snap('2026-06-13', { regulationStatus: 3, policyLever: 2.5, actorInvolvement: 2.0 }),
    ],
    // Changed once, on the recalibration date.
    Algeria: [
      snap('2026-03-21'),
      snap('2026-06-13', { enforcementLevel: 1 }),
    ],
    // First scored in June; never changed.
    Andorra: [snap('2026-06-13')],
    // Unsorted input; an unchanged snapshot (derived field only) is not a change.
    Angola: [
      snap('2026-04-01', { averageScore: 2.01 }),
      snap('2026-03-21'),
    ],
  },
  breaks: [{ date: '2026-06-13', model: 'claude-opus-5', prompt_version: 'v3', reason: 'Model switch' }],
};

describe('computeWeeklyChanges', () => {
  it('returns [] without history', () => {
    expect(computeWeeklyChanges(null)).toEqual([]);
    expect(computeWeeklyChanges(undefined)).toEqual([]);
    expect(computeWeeklyChanges({ schema_version: 1, countries: {} })).toEqual([]);
  });

  it('counts first assessments separately from changes, oldest run first', () => {
    const weeks = computeWeeklyChanges(history);
    expect(weeks.map(w => w.date)).toEqual(['2026-03-21', '2026-04-01', '2026-06-13']);
    expect(weeks[0]).toMatchObject({ changed: 0, firstScored: 3, countries: [], moves: [] });
    expect(weeks[1]).toMatchObject({ changed: 1, firstScored: 0, countries: ['Albania'] });
    expect(weeks[2]).toMatchObject({ changed: 2, firstScored: 1, countries: ['Albania', 'Algeria'] });
  });

  it('counts each changed country once, under the dimension that moved most', () => {
    const weeks = computeWeeklyChanges(history);
    const june = weeks[2];
    // Albania: regulationStatus +1 beats policyLever +0.5 and actorInvolvement -0.25.
    // Algeria: enforcementLevel -1 is its only move.
    expect(june.byDimension).toEqual({
      regulationStatus: 1,
      policyLever: 0,
      governanceType: 0,
      actorInvolvement: 0,
      enforcementLevel: 1,
    });
    expect(Object.values(june.byDimension).reduce((a, b) => a + b, 0)).toBe(june.changed);
  });

  it('lists every dimension move with a signed delta, largest first', () => {
    const june = computeWeeklyChanges(history)[2];
    expect(june.moves).toEqual([
      { country: 'Albania', dimension: 'regulationStatus', from: 2, to: 3, delta: 1 },
      { country: 'Algeria', dimension: 'enforcementLevel', from: 2, to: 1, delta: -1 },
      { country: 'Albania', dimension: 'policyLever', from: 2, to: 2.5, delta: 0.5 },
      { country: 'Albania', dimension: 'actorInvolvement', from: 2.25, to: 2, delta: -0.25 },
    ]);
  });

  it('marks a run dated on a calibration break with its reason', () => {
    const weeks = computeWeeklyChanges(history);
    expect(weeks[1].recalibration).toBeNull();
    expect(weeks[2].recalibration).toBe('Model switch');
  });

  it('ignores a snapshot where only the derived average moved', () => {
    const weeks = computeWeeklyChanges({ schema_version: 1, countries: { Angola: history.countries.Angola } });
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ date: '2026-03-21', firstScored: 1, changed: 0 });
  });
});

describe('dominantDimension', () => {
  it('breaks ties by rubric order', () => {
    const entry = {
      date: '2026-06-13',
      changes: [
        { dimension: 'enforcementLevel', label: 'Enforcement Level', from: 1, to: 2 },
        { dimension: 'policyLever', label: 'Policy Lever', from: 1, to: 2 },
      ],
    };
    expect(dominantDimension(entry)).toBe('policyLever');
  });

  it('falls back to the first changed dimension when no move has a size', () => {
    const entry = {
      date: '2026-06-13',
      changes: [{ dimension: 'governanceType', label: 'Governance Type', from: null, to: 3 }],
    };
    expect(dominantDimension(entry)).toBe('governanceType');
  });
});

describe('binDeltas and summarizeDeltas', () => {
  const moves = [
    { country: 'A', dimension: 'policyLever', from: 2, to: 2.25, delta: 0.25 },
    { country: 'B', dimension: 'policyLever', from: 2, to: 2.25, delta: 0.25 },
    { country: 'C', dimension: 'policyLever', from: 2, to: 1, delta: -1 },
    { country: 'D', dimension: 'policyLever', from: 2, to: 3.5, delta: 1.5 },
  ];

  it('bins moves to the nearest quarter point, ascending, without empty bins', () => {
    expect(binDeltas(moves)).toEqual([
      { delta: -1, count: 1 },
      { delta: 0.25, count: 2 },
      { delta: 1.5, count: 1 },
    ]);
    expect(binDeltas([])).toEqual([]);
  });

  it('snaps floating-point deltas onto the quarter grid', () => {
    const bins = binDeltas([{ country: 'A', dimension: 'policyLever', from: 1.75, to: 2, delta: 0.7 - 0.45 }]);
    expect(bins).toEqual([{ delta: 0.25, count: 1 }]);
  });

  it('summarises count, direction, median and largest absolute move', () => {
    expect(summarizeDeltas(moves)).toEqual({ count: 4, up: 3, down: 1, medianAbs: 0.63, largestAbs: 1.5 });
    expect(summarizeDeltas([])).toEqual({ count: 0, up: 0, down: 0, medianAbs: 0, largestAbs: 0 });
  });
});

describe('latestWeek and largestMoves', () => {
  it('picks the latest run that moved a score, skipping first-assessment-only runs', () => {
    const weeks = computeWeeklyChanges({
      schema_version: 1,
      countries: {
        Albania: [snap('2026-03-21'), snap('2026-04-01', { policyLever: 3 })],
        Zambia: [snap('2026-09-01')],
      },
    });
    expect(weeks.map(w => w.date)).toEqual(['2026-03-21', '2026-04-01', '2026-09-01']);
    expect(latestWeek(weeks)?.date).toBe('2026-04-01');
    expect(latestWeek([])).toBeNull();
  });

  it('returns the n largest moves of a run and [] for no run', () => {
    const june = computeWeeklyChanges(history)[2];
    expect(largestMoves(june, 2).map(m => `${m.country}:${m.delta}`)).toEqual(['Albania:1', 'Algeria:-1']);
    expect(largestMoves(null)).toEqual([]);
  });
});

describe('confidenceByVintage', () => {
  const regulation = {
    A: { country: 'A', lastUpdated: '2026-06-13', confidence: 'high' },
    B: { country: 'B', lastUpdated: '2026-06-13', confidence: 'Medium' },
    C: { country: 'C', lastUpdated: '2026-09-01', confidence: 'low' },
    D: { country: 'D', lastUpdated: '2026-09-01', confidence: 'low' },
    E: { country: 'E', lastUpdated: null, confidence: 'high' },
    F: { country: 'F', lastUpdated: '2026-09-01', confidence: 'unknown' },
  };

  it('groups labels by last-updated date, oldest first, skipping undated or unknown entries', () => {
    expect(confidenceByVintage(regulation)).toEqual([
      { date: '2026-06-13', counts: { high: 1, medium: 1, low: 0 }, total: 2 },
      { date: '2026-09-01', counts: { high: 0, medium: 0, low: 2 }, total: 2 },
    ]);
    expect(confidenceByVintage(null)).toEqual([]);
  });

  it('totals the cohorts and reports the latest date', () => {
    const totals = confidenceTotals(confidenceByVintage(regulation));
    expect(totals).toEqual({ date: '2026-09-01', counts: { high: 1, medium: 1, low: 2 }, total: 4 });
    expect(percent(totals.counts.low, totals.total)).toBe(50);
    expect(percent(0, 0)).toBe(0);
  });
});

describe('parseDriftChecks', () => {
  const row = {
    run_id: 'r1',
    date: '2026-09-08',
    model: 'claude-opus-5',
    prompt_version: 'v3.1-2026-09',
    countries_compared: 10,
    countries_missing: [],
    mae_by_dimension: { regulation_status: 0.4, policy_lever: 0.55 },
    within_one: 0.86,
    max_dev: 3,
    max_dev_at: { country: 'Kenya', dimension: 'enforcement_level', subindicator: 'penalties', gold: 1, run: 4 },
  };

  it('parses rows and sorts them by date', () => {
    const checks = parseDriftChecks({ schema_version: 1, checks: [{ ...row, date: '2026-09-15', run_id: 'r2' }, row] });
    expect(checks.map(c => c.runId)).toEqual(['r1', 'r2']);
    expect(checks[0]).toMatchObject({
      date: '2026-09-08',
      model: 'claude-opus-5',
      promptVersion: 'v3.1-2026-09',
      countriesCompared: 10,
      maeByDimension: { regulation_status: 0.4, policy_lever: 0.55 },
      withinOne: 0.86,
      maxDev: 3,
      maxDevAt: { country: 'Kenya', dimension: 'enforcement_level', subindicator: 'penalties', gold: 1, run: 4 },
    });
  });

  it('returns [] for a missing, empty or malformed document and skips bad rows', () => {
    expect(parseDriftChecks(null)).toEqual([]);
    expect(parseDriftChecks({ schema_version: 1, checks: [] })).toEqual([]);
    expect(parseDriftChecks({ checks: 'nope' })).toEqual([]);
    expect(parseDriftChecks({ checks: [{ date: '2026-09-08' }, 'x', { ...row, within_one: 'high' }] })).toEqual([]);
  });

  it('tolerates a row without a deviation', () => {
    const [check] = parseDriftChecks({ checks: [{ ...row, max_dev: null, max_dev_at: null, countries_missing: ['Bhutan'] }] });
    expect(check.maxDev).toBeNull();
    expect(check.maxDevAt).toBeNull();
    expect(check.countriesMissing).toEqual(['Bhutan']);
  });
});

describe('research runs', () => {
  it('parses the gate tally out of the notes', () => {
    expect(parseGateCounts('gate: applied:evidence=12 applied:persisted=3 held=7 unchanged=170')).toEqual({
      appliedEvidence: 12, appliedPersisted: 3, held: 7, unchanged: 170,
    });
    expect(parseGateCounts('aborted on fatal API error; partial results mirrored; gate: held=2 unchanged=1')).toEqual({
      appliedEvidence: 0, appliedPersisted: 0, held: 2, unchanged: 1,
    });
    expect(parseGateCounts('aborted on fatal API error; partial results mirrored')).toBeNull();
    expect(parseGateCounts('gate: nonsense')).toBeNull();
    expect(parseGateCounts(null)).toBeNull();
  });

  it('parses a research_runs row', () => {
    const run = parseResearchRun({
      id: 'abc',
      started_at: '2026-09-21T06:02:11.000Z',
      finished_at: '2026-09-21T07:10:00.000Z',
      trigger: 'schedule',
      model: 'claude-opus-5',
      prompt_version: 'v3.1-2026-09',
      grounded: true,
      countries_attempted: 196,
      countries_succeeded: 194,
      notes: 'gate: applied:evidence=12 applied:persisted=3 held=7 unchanged=172',
    });
    expect(run).toMatchObject({
      id: 'abc',
      date: '2026-09-21',
      finished: true,
      trigger: 'schedule',
      model: 'claude-opus-5',
      grounded: true,
      countriesAttempted: 196,
      countriesSucceeded: 194,
      gate: { appliedEvidence: 12, appliedPersisted: 3, held: 7, unchanged: 172 },
    });
    expect(parseResearchRun({ id: 'x' })).toBeNull();
    expect(parseResearchRun('x')).toBeNull();
  });

  it('picks the latest research run and ignores seeds and backfills', () => {
    const rows = [
      { id: 'seed', started_at: '2026-09-30T00:00:00Z', trigger: 'seed' },
      { id: 'old', started_at: '2026-09-14T06:00:00Z', trigger: 'schedule' },
      { id: 'new', started_at: '2026-09-21T06:00:00Z', trigger: 'manual', finished_at: null },
    ];
    expect(latestResearchRun(rows)?.id).toBe('new');
    expect(latestResearchRun(rows)?.finished).toBe(false);
    expect(latestResearchRun([])).toBeNull();
    expect(latestResearchRun(null)).toBeNull();
    expect(latestResearchRun([rows[0]])).toBeNull();
  });
});

describe('computeBlocDrift', () => {
  it('reports the share of each bloc that changed on every run', () => {
    const weeks = computeWeeklyChanges(history);
    const blocs = {
      EU: { name: 'European Union', members: ['Albania', 'Andorra'] },
      AU: { name: 'African Union', members: ['Algeria', 'Angola', 'Benin'] },
      EMPTY: { name: 'Empty', members: [] },
    };
    const drift = computeBlocDrift(weeks, blocs);
    expect(drift.map(b => b.code)).toEqual(['EU', 'AU']);
    expect(drift[0]).toMatchObject({ name: 'European Union', members: 2 });
    expect(drift[0].weeks).toEqual([
      { date: '2026-03-21', changed: 0, share: 0 },
      { date: '2026-04-01', changed: 1, share: 0.5 },
      { date: '2026-06-13', changed: 1, share: 0.5 },
    ]);
    expect(drift[1].weeks[2]).toEqual({ date: '2026-06-13', changed: 1, share: 1 / 3 });
    expect(computeBlocDrift(weeks, null)).toEqual([]);
  });
});

describe('snakeDimensionLabel', () => {
  it('maps drift.json keys to the app labels and passes unknown keys through', () => {
    expect(snakeDimensionLabel('regulation_status')).toBe('Regulation Status');
    expect(snakeDimensionLabel('enforcement_level')).toBe('Enforcement Level');
    expect(snakeDimensionLabel('something_else')).toBe('something_else');
  });
});

// Regression: drift tooltips are HTML, and drift.json values reached them
// unescaped (a date formatDate cannot parse passes through as-is, and an
// unknown dimension key passes through snakeDimensionLabel).
describe('goldTooltip', () => {
  it('escapes every value that comes from drift.json', () => {
    const [check] = parseDriftChecks({
      checks: [{
        date: '<img src=x onerror=alert(1)>',
        model: '<b>m</b>',
        prompt_version: '"v"',
        within_one: 0.9,
        countries_compared: 10,
        max_dev: 2,
        max_dev_at: { country: '<i>C</i>', dimension: '<svg onload=x>', subindicator: 's', gold: 1, run: 3 },
      }],
    });
    const html = goldTooltip(check);
    // The tooltip's own markup (<strong>, <b>, <br>) stays; data never adds tags.
    expect(html).not.toMatch(/<(img|i|svg)\b|<b>m/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;m&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;C&lt;/i&gt;');
    expect(html).toContain('&lt;svg onload=x&gt;');
  });
});

