import { describe, it, expect } from 'vitest';
import {
  changesByCountry,
  changesWithoutItems,
  countryHref,
  dimensionLabel,
  formatDelta,
  parseDigest,
  parseDigestIndex,
  pickWeek,
  sourceHost,
  weekLabel,
} from '../src/data/digest';

const WEEK = {
  schema_version: 1,
  week: '2026-W37',
  date: '2026-09-07',
  generated_at: '2026-09-07T06:15:00+00:00',
  run_id: 'run-1',
  model: 'claude-test',
  lead: 'Two countries changed.',
  items: [
    { country: 'Germany', headline: 'Up', summary: 'Rose.', sources: ['https://www.example.gov/new'] },
    { country: 42, headline: 'bad', summary: 'bad', sources: [] },
  ],
  changes: [
    {
      country: 'Germany',
      scores: { regulation_status: { old: 3, new: 3.75 } },
      laws: null,
      confidence: { old: 'medium', new: 'high' },
      sources: ['https://www.example.gov/new'],
      new_sources: ['https://www.example.gov/new'],
    },
    {
      country: 'Chile',
      scores: { enforcement_level: { old: null, new: 2.5 } },
      laws: { old: 'A', new: 'A; B' },
      confidence: { old: null, new: 'low' },
      sources: [],
      new_sources: [],
    },
    'not a change',
  ],
};

describe('parseDigest', () => {
  it('reads the week file and skips malformed items and changes', () => {
    const d = parseDigest(WEEK);
    expect(d.week).toBe('2026-W37');
    expect(d.runId).toBe('run-1');
    expect(d.items.map((i) => i.country)).toEqual(['Germany']);
    expect(d.changes.map((c) => c.country)).toEqual(['Germany', 'Chile']);
    expect(d.changes[0].scores.regulation_status).toEqual({ old: 3, new: 3.75 });
    expect(d.changes[0].newSources).toEqual(['https://www.example.gov/new']);
    expect(d.changes[1].laws).toEqual({ old: 'A', new: 'A; B' });
    expect(d.changes[1].scores.enforcement_level.old).toBeNull();
  });

  it('rejects documents that are not digests', () => {
    expect(() => parseDigest(null)).toThrow();
    expect(() => parseDigest({ week: 'nope', date: 'x', lead: 'y' })).toThrow();
    expect(() => parseDigest({ week: '2026-W37', date: '2026-09-07' })).toThrow();
  });

  it('reads a calibration break when present', () => {
    expect(parseDigest(WEEK).calibrationBreak).toBeNull();
    const d = parseDigest({ ...WEEK, calibration_break: { date: '2026-09-07', model: 'claude-opus-5', reason: 'Model switch' } });
    expect(d.calibrationBreak).toEqual({ date: '2026-09-07', model: 'claude-opus-5', reason: 'Model switch' });
    expect(parseDigest({ ...WEEK, calibration_break: { date: 'x' } }).calibrationBreak).toBeNull();
  });

  it('accepts a no-changes digest', () => {
    const d = parseDigest({ week: '2026-W38', date: '2026-09-14', lead: 'No changes.', items: [], changes: [] });
    expect(d.items).toEqual([]);
    expect(changesWithoutItems(d)).toEqual([]);
  });
});

describe('parseDigestIndex / pickWeek', () => {
  const index = {
    weeks: [
      { week: '2026-W36', date: '2026-08-31', run_id: 'a', model: 'm', item_count: 0, change_count: 0, file: '2026-W36.json' },
      { week: '2026-W37', date: '2026-09-07', run_id: 'b', model: 'm', item_count: 2, change_count: 2, file: '2026-W37.json' },
      { week: 'garbage', file: 'x.json' },
      null,
    ],
  };

  it('sorts newest first and drops invalid entries', () => {
    expect(parseDigestIndex(index).map((w) => w.week)).toEqual(['2026-W37', '2026-W36']);
    expect(parseDigestIndex({})).toEqual([]);
    expect(parseDigestIndex(null)).toEqual([]);
  });

  it('picks the requested week when present, else the newest', () => {
    const weeks = parseDigestIndex(index);
    expect(pickWeek(weeks, '2026-W36').week).toBe('2026-W36');
    expect(pickWeek(weeks, '2026-W99').week).toBe('2026-W37');
    expect(pickWeek(weeks, null).week).toBe('2026-W37');
    expect(pickWeek([], '2026-W37')).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('labels weeks, dimensions and deltas', () => {
    expect(weekLabel('2026-W07')).toBe('Week 7, 2026');
    expect(weekLabel('odd')).toBe('odd');
    expect(dimensionLabel('regulation_status')).toBe('Regulation Status');
    expect(dimensionLabel('actor_involvement')).toBe('Actor Involvement');
    expect(dimensionLabel('unknown_thing')).toBe('unknown_thing');
    expect(formatDelta({ old: 3, new: 3.75 })).toBe('3 → 3.75');
    expect(formatDelta({ old: null, new: 2.5 })).toBe('new at 2.5');
    expect(formatDelta({ old: 2, new: null })).toBe('removed');
  });

  it('builds country links and source hosts', () => {
    expect(countryHref('United States of America')).toBe('/?country=United%20States%20of%20America');
    expect(sourceHost('https://www.example.gov/a/b?c=1')).toBe('example.gov');
    expect(sourceHost('not a url')).toBe('not a url');
  });

  it('joins prose items with their structured changes', () => {
    const d = parseDigest(WEEK);
    expect(changesByCountry(d).get('Germany').confidence).toEqual({ old: 'medium', new: 'high' });
    expect(changesWithoutItems(d).map((c) => c.country)).toEqual(['Chile']);
  });
});
