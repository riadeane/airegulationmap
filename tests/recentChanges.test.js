import { describe, it, expect } from 'vitest';
import { computeRecentChanges, formatSignedDelta } from '../src/data/changelog';

const TODAY = '2026-09-23';

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

const history = (countries, breaks) => ({
  schema_version: 1,
  countries,
  ...(breaks ? { breaks } : {}),
});

describe('computeRecentChanges', () => {
  it('returns [] for missing history or no countries', () => {
    expect(computeRecentChanges(null, TODAY)).toEqual([]);
    expect(computeRecentChanges(undefined, TODAY)).toEqual([]);
    expect(computeRecentChanges(history({}), TODAY)).toEqual([]);
  });

  it('lists a country whose scores changed inside the window', () => {
    const h = history({
      Japan: [snap('2026-06-13'), snap('2026-09-21', { enforcementLevel: 2.5 })],
    });
    expect(computeRecentChanges(h, TODAY)).toEqual([
      {
        country: 'Japan',
        dimension: 'enforcementLevel',
        label: 'Enforcement Level',
        delta: 0.5,
        date: '2026-09-21',
      },
    ]);
  });

  it('ignores changes dated before the window or after today', () => {
    const h = history({
      Old: [snap('2026-06-13'), snap('2026-09-01', { policyLever: 3 })],
      Future: [snap('2026-06-13'), snap('2026-09-24', { policyLever: 3 })],
    });
    expect(computeRecentChanges(h, TODAY)).toEqual([]);
  });

  it('includes the window boundaries: seven days ago and today', () => {
    const h = history({
      Edge: [snap('2026-06-13'), snap('2026-09-16', { policyLever: 3 })],
      Today: [snap('2026-06-13'), snap('2026-09-23', { policyLever: 3 })],
      Gone: [snap('2026-06-13'), snap('2026-09-15', { policyLever: 3 })],
    });
    expect(computeRecentChanges(h, TODAY).map(c => c.country)).toEqual(['Edge', 'Today']);
  });

  it('honours a custom window length', () => {
    const h = history({
      A: [snap('2026-06-13'), snap('2026-09-10', { policyLever: 3 })],
    });
    expect(computeRecentChanges(h, TODAY, 7)).toEqual([]);
    expect(computeRecentChanges(h, TODAY, 14)).toHaveLength(1);
  });

  it('picks the dimension with the largest move and signs the delta', () => {
    const h = history({
      Brazil: [
        snap('2026-06-13'),
        snap('2026-09-21', { regulationStatus: 2.25, enforcementLevel: 1.25 }),
      ],
    });
    expect(computeRecentChanges(h, TODAY)[0]).toMatchObject({
      dimension: 'enforcementLevel',
      delta: -0.75,
    });
  });

  it('breaks a tie between dimensions by rubric order', () => {
    const h = history({
      Tie: [snap('2026-06-13'), snap('2026-09-21', { policyLever: 2.5, enforcementLevel: 2.5 })],
    });
    expect(computeRecentChanges(h, TODAY)[0].dimension).toBe('policyLever');
  });

  it('sorts by absolute delta, largest first, then by name', () => {
    const h = history({
      Small: [snap('2026-06-13'), snap('2026-09-21', { policyLever: 2.25 })],
      Down: [snap('2026-06-13'), snap('2026-09-21', { policyLever: 1 })],
      Up: [snap('2026-06-13'), snap('2026-09-21', { policyLever: 2.5 })],
      Alpha: [snap('2026-06-13'), snap('2026-09-21', { policyLever: 2.5 })],
    });
    expect(computeRecentChanges(h, TODAY).map(c => c.country)).toEqual([
      'Down', 'Alpha', 'Up', 'Small',
    ]);
  });

  it('nets several changes inside the window and dates the newest', () => {
    const h = history({
      Twice: [
        snap('2026-06-13'),
        snap('2026-09-17', { policyLever: 2.5 }),
        snap('2026-09-21', { policyLever: 2.25 }),
      ],
    });
    expect(computeRecentChanges(h, TODAY)[0]).toMatchObject({
      dimension: 'policyLever',
      delta: 0.25,
      date: '2026-09-21',
    });
  });

  it('drops a country that moved and moved back', () => {
    const h = history({
      Wobble: [
        snap('2026-06-13'),
        snap('2026-09-17', { policyLever: 2.5 }),
        snap('2026-09-21', { policyLever: 2 }),
      ],
    });
    expect(computeRecentChanges(h, TODAY)).toEqual([]);
  });

  it('does not count a new country whose first snapshot is in the window', () => {
    const h = history({ New: [snap('2026-09-21', { policyLever: 4 })] });
    expect(computeRecentChanges(h, TODAY)).toEqual([]);
  });

  it('ignores a snapshot where only the derived average changed', () => {
    const h = history({
      Same: [snap('2026-06-13'), snap('2026-09-21', { averageScore: 2.01 })],
    });
    expect(computeRecentChanges(h, TODAY)).toEqual([]);
  });

  it('ignores a dimension with no previous value (no delta to show)', () => {
    const h = history({
      Sparse: [
        snap('2026-06-13', { policyLever: null }),
        snap('2026-09-21', { policyLever: 3 }),
      ],
    });
    expect(computeRecentChanges(h, TODAY)).toEqual([]);
  });

  it('excludes changes dated on a calibration break', () => {
    const breaks = [
      { date: '2026-09-21', model: 'claude-opus-5', prompt_version: 'v3-2026-09', reason: 'Model switch' },
    ];
    const h = history({
      Recal: [snap('2026-06-13'), snap('2026-09-21', { policyLever: 3 })],
      Real: [snap('2026-06-13'), snap('2026-09-22', { policyLever: 3 })],
    }, breaks);
    expect(computeRecentChanges(h, TODAY).map(c => c.country)).toEqual(['Real']);
  });
});

describe('formatSignedDelta', () => {
  it('signs positive and negative moves', () => {
    expect(formatSignedDelta(0.25)).toBe('+0.25');
    expect(formatSignedDelta(1)).toBe('+1');
    expect(formatSignedDelta(-0.5)).toBe('−0.5');
  });

  it('rounds floating-point noise to two decimals', () => {
    expect(formatSignedDelta(0.1 + 0.2)).toBe('+0.3');
    expect(formatSignedDelta(-(0.7 - 0.45))).toBe('−0.25');
  });
});
