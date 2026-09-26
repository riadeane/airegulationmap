import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildScoresAtDate, extractSortedDates, historyBreaks, loadHistory } from '../src/data/history';

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
    // must not make it vanish from the map - we show its earliest known
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

describe('historyBreaks', () => {
  it('returns [] when the file has no breaks or no history', () => {
    expect(historyBreaks(history)).toEqual([]);
    expect(historyBreaks(null)).toEqual([]);
  });

  it('returns the breaks oldest first without mutating the file', () => {
    const later = { date: '2026-12-07', model: 'm', prompt_version: 'v4', reason: 'later' };
    const earlier = { date: '2026-09-14', model: 'm', prompt_version: 'v3', reason: 'earlier' };
    const h = { ...history, breaks: [later, earlier] };
    expect(historyBreaks(h)).toEqual([earlier, later]);
    expect(h.breaks).toEqual([later, earlier]);
  });
});

// Regression: `return response.json()` inside the try was not awaited, so
// a malformed body rejected outside the catch and the drift page hung on
// its loading message instead of rendering its empty states.
describe('loadHistory', () => {
  afterEach(() => {
    delete globalThis.fetch;
    vi.restoreAllMocks();
  });

  it('resolves null when the body is not JSON', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });
    await expect(loadHistory()).resolves.toBeNull();
  });

  it('resolves null on an HTTP error and parses a good body', async () => {
    globalThis.fetch = () => Promise.resolve({ ok: false });
    await expect(loadHistory()).resolves.toBeNull();
    globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(history) });
    await expect(loadHistory()).resolves.toEqual(history);
  });
});

