import { describe, it, expect } from 'vitest';
import { buildScoresAtDate, extractSortedDates } from '../src/data/history';

const history = {
  schema_version: 1,
  countries: {
    Germany: [
      { date: '2026-03-21', regulationStatus: 4, averageScore: 4.0 },
      { date: '2026-05-01', regulationStatus: 5, averageScore: 4.5 },
    ],
    Algeria: [
      { date: '2026-04-01', regulationStatus: 2, averageScore: 2.0 },
    ],
  },
};

describe('buildScoresAtDate', () => {
  it('picks the latest snapshot at or before the target date', () => {
    const result = buildScoresAtDate(history, '2026-04-15');
    expect(result.Germany.regulationStatus).toBe(4);
    expect(result.Algeria.regulationStatus).toBe(2);
  });

  it('includes a snapshot dated exactly on the target date', () => {
    const result = buildScoresAtDate(history, '2026-05-01');
    expect(result.Germany.regulationStatus).toBe(5);
  });

  it('carries the earliest snapshot backward before a country first appears', () => {
    // Algeria's first snapshot is 2026-04-01. Scrubbing earlier than that
    // must not make it vanish from the map — we show its earliest known
    // state rather than dropping it (snapshots are change-points, so there
    // is no recorded change before the first one).
    const result = buildScoresAtDate(history, '2026-03-25');
    expect(result.Germany.regulationStatus).toBe(4);
    expect(result.Algeria).toBeDefined();
    expect(result.Algeria.regulationStatus).toBe(2);
  });
});

describe('extractSortedDates', () => {
  it('returns unique dates sorted ascending', () => {
    expect(extractSortedDates(history)).toEqual([
      '2026-03-21', '2026-04-01', '2026-05-01',
    ]);
  });

  it('dedupes dates shared across countries', () => {
    const h = {
      countries: {
        A: [{ date: '2026-01-01' }],
        B: [{ date: '2026-01-01' }, { date: '2026-02-01' }],
      },
    };
    expect(extractSortedDates(h)).toEqual(['2026-01-01', '2026-02-01']);
  });
});
