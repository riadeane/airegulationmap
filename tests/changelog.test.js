import { describe, it, expect } from 'vitest';
import { computeChangelog, isPolicyChange } from '../src/data/changelog';

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

describe('computeChangelog', () => {
  it('returns [] for missing or empty history', () => {
    expect(computeChangelog(null)).toEqual([]);
    expect(computeChangelog(undefined)).toEqual([]);
    expect(computeChangelog([])).toEqual([]);
  });

  it('emits only an initial entry for a single snapshot', () => {
    const log = computeChangelog([snap('2026-03-21')]);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ date: '2026-03-21', initial: true });
    expect(log[0].scores.regulationStatus).toBe(2);
    expect(log[0].scores.averageScore).toBeUndefined();
  });

  it('diffs consecutive snapshots and labels dimensions', () => {
    const log = computeChangelog([
      snap('2026-03-21'),
      snap('2026-04-01', { actorInvolvement: 3, enforcementLevel: 1 }),
    ]);
    expect(log).toHaveLength(2);
    const entry = log[0];
    expect(entry.date).toBe('2026-04-01');
    expect(entry.changes).toEqual([
      { dimension: 'actorInvolvement', label: 'Actor Involvement', from: 2, to: 3 },
      { dimension: 'enforcementLevel', label: 'Enforcement Level', from: 2, to: 1 },
    ]);
  });

  it('omits snapshots where no dimension changed', () => {
    const log = computeChangelog([
      snap('2026-03-21'),
      snap('2026-04-01', { averageScore: 2.01 }), // derived field only
      snap('2026-05-01', { policyLever: 4 }),
    ]);
    expect(log).toHaveLength(2);
    expect(log[0].date).toBe('2026-05-01');
    expect(log[1].initial).toBe(true);
  });

  it('sorts newest-first and handles unsorted input', () => {
    const log = computeChangelog([
      snap('2026-05-01', { regulationStatus: 4 }),
      snap('2026-03-21'),
      snap('2026-04-01', { regulationStatus: 3 }),
    ]);
    expect(log.map(e => e.date)).toEqual(['2026-05-01', '2026-04-01', '2026-03-21']);
    expect(log[0].changes[0]).toMatchObject({ from: 3, to: 4 });
    expect(log[1].changes[0]).toMatchObject({ from: 2, to: 3 });
  });
});

describe('computeChangelog with calibration breaks', () => {
  const breaks = [
    { date: '2026-09-14', model: 'claude-opus-5', prompt_version: 'v3-2026-09', reason: 'Model switch to Opus 5' },
  ];

  it('labels a change dated on a break as a recalibration', () => {
    const log = computeChangelog([
      snap('2026-06-13'),
      snap('2026-09-14', { regulationStatus: 2.5 }),
    ], breaks);
    expect(log[0]).toMatchObject({
      date: '2026-09-14',
      recalibration: 'Model switch to Opus 5',
    });
    expect(log[0].changes).toEqual([
      { dimension: 'regulationStatus', label: 'Regulation Status', from: 2, to: 2.5 },
    ]);
  });

  it('leaves changes on other dates unlabelled', () => {
    const log = computeChangelog([
      snap('2026-06-13'),
      snap('2026-09-21', { regulationStatus: 2.5 }),
    ], breaks);
    expect(log[0].recalibration).toBeUndefined();
    expect('recalibration' in log[0]).toBe(false);
  });

  it('does not count a recalibration as a policy change', () => {
    const log = computeChangelog([
      snap('2026-06-13'),
      snap('2026-09-14', { regulationStatus: 2.5 }),
      snap('2026-09-28', { policyLever: 3 }),
    ], breaks);
    expect(log.map(isPolicyChange)).toEqual([true, false, false]);
    expect(log.filter(isPolicyChange)).toHaveLength(1);
  });

  it('defaults to no breaks', () => {
    const log = computeChangelog([snap('2026-06-13'), snap('2026-09-14', { policyLever: 3 })]);
    expect(isPolicyChange(log[0])).toBe(true);
  });
});
