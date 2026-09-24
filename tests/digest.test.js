import { describe, it, expect } from 'vitest';
import {
  breakPhrase,
  changesByCountry,
  changesWithoutItems,
  countryHref,
  dayLabel,
  dimensionLabel,
  formatDelta,
  monthLabel,
  numericColumns,
  parseDigest,
  parseDigestIndex,
  parseMonthIndex,
  parseMonthly,
  pickMonth,
  pickView,
  pickWeek,
  sourceHost,
  trendSubtitle,
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
      { kind: 'weekly', week: '2026-W37', date: '2026-09-07', run_id: 'b', model: 'm', item_count: 2, change_count: 2, file: '2026-W37.json' },
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

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300"><title>t</title></svg>';
const TABLE = { columns: ['Bloc', '1 Jul', '30 Sep', 'Change'], rows: [['European Union', '3.33', '3.38', '+0.05']] };

const MONTH = {
  schema_version: 1,
  kind: 'monthly',
  month: '2026-09',
  date: '2026-10-05',
  generated_at: '2026-10-05T07:10:00+00:00',
  run_id: null,
  model: 'claude-opus-5',
  prompt_version: 'monthly-v1-2026-09',
  period: { start: '2026-09-01', end: '2026-09-30' },
  window: { start: '2026-07-01', end: '2026-09-30', weeks: 13 },
  weeks: ['2026-W36', '2026-W37', 'W38', 7],
  calibration_breaks: [
    { date: '2026-09-14', model: 'claude-opus-5', prompt_version: 'v3', reason: 'Model switch' },
    { date: '2026-09-21' },
  ],
  lead: 'Regulation tightened in the EU.',
  sections: [
    { heading: 'Europe', text: 'The EU moved.', sources: ['https://example.gov/a', 'javascript:alert(1)', 3] },
    { heading: 'No text' },
    null,
  ],
  drift: { text: 'The drift check ran 4 times.', href: '/data/drift.json', label: 'Drift record' },
  charts: [
    { id: 'bloc-maturity', title: 'Maturity by bloc', caption: 'Mean maturity.', svg: SVG, table: TABLE, data: {} },
    { id: 'table-only', title: 'Movers', table: { columns: ['Country', 'Change'], rows: [['Chile', 0.25], 'bad', ['Peru', null]] } },
    { id: 'svg-only', title: 'Dimensions', svg: SVG },
    { id: 'no-title', svg: SVG, table: TABLE },
    { id: 'empty', title: 'Nothing to show' },
    'not a chart',
  ],
};

describe('parseMonthly', () => {
  it('reads the monthly file', () => {
    const p = parseMonthly(MONTH);
    expect(p.month).toBe('2026-09');
    expect(p.date).toBe('2026-10-05');
    expect(p.runId).toBe('');
    expect(p.promptVersion).toBe('monthly-v1-2026-09');
    expect(p.period).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(p.window).toEqual({ start: '2026-07-01', end: '2026-09-30', weeks: 13 });
    expect(p.weeks).toEqual(['2026-W36', '2026-W37']);
    expect(p.lead).toBe('Regulation tightened in the EU.');
    expect(p.drift).toEqual({ text: 'The drift check ran 4 times.', href: '/data/drift.json', label: 'Drift record' });
    expect(p.calibrationBreaks).toEqual([{ date: '2026-09-14', model: 'claude-opus-5', reason: 'Model switch' }]);
  });

  it('skips malformed sections and charts and keeps table-only or svg-only charts', () => {
    const p = parseMonthly(MONTH);
    expect(p.sections).toEqual([{ heading: 'Europe', text: 'The EU moved.', sources: ['https://example.gov/a'] }]);
    expect(p.charts.map((c) => c.id)).toEqual(['bloc-maturity', 'table-only', 'svg-only']);
    expect(p.charts[0]).toEqual({ id: 'bloc-maturity', title: 'Maturity by bloc', caption: 'Mean maturity.', svg: SVG, table: TABLE });
    expect(p.charts[1].svg).toBe('');
    expect(p.charts[1].table.rows).toEqual([['Chile', '0.25'], ['Peru', '']]);
    expect(p.charts[2].table).toEqual({ columns: [], rows: [] });
  });

  it('tolerates absent optional parts', () => {
    const p = parseMonthly({ kind: 'monthly', month: '2026-10', date: '2026-11-02', lead: '', drift: null });
    expect(p.sections).toEqual([]);
    expect(p.charts).toEqual([]);
    expect(p.calibrationBreaks).toEqual([]);
    expect(p.weeks).toEqual([]);
    expect(p.drift).toBeNull();
    expect(p.window).toBeNull();
    expect(p.period).toBeNull();
  });

  it('drops a drift link that is not http(s) or on this site', () => {
    const drift = (href) => parseMonthly({ ...MONTH, drift: { text: 'x', href, label: 'y' } }).drift.href;
    expect(drift('https://example.org/drift')).toBe('https://example.org/drift');
    expect(drift('//evil.example/drift')).toBe('');
    expect(drift('javascript:alert(1)')).toBe('');
    expect(parseMonthly({ ...MONTH, drift: { href: '/x' } }).drift).toBeNull();
  });

  it('rejects documents that are not monthly pieces', () => {
    expect(() => parseMonthly(null)).toThrow();
    expect(() => parseMonthly(WEEK)).toThrow();
    expect(() => parseMonthly({ ...MONTH, kind: 'weekly' })).toThrow();
    expect(() => parseMonthly({ ...MONTH, month: '2026-W37' })).toThrow();
    expect(() => parseMonthly({ ...MONTH, date: null })).toThrow();
    expect(() => parseMonthly({ ...MONTH, lead: undefined })).toThrow();
  });
});

describe('parseMonthIndex / pickMonth / pickView', () => {
  const index = {
    schema_version: 1,
    weeks: [
      { kind: 'weekly', week: '2026-W40', date: '2026-10-05', file: '2026-W40.json' },
      { kind: 'weekly', week: '2026-W41', date: '2026-10-12', file: '2026-W41.json' },
    ],
    months: [
      { kind: 'monthly', month: '2026-08', date: '2026-09-07', run_id: null, model: 'm', section_count: 2, chart_count: 3, file: '2026-08.json' },
      { kind: 'monthly', month: '2026-09', date: '2026-10-05', run_id: 'r', model: 'm', section_count: 3, chart_count: 3, file: '2026-09.json' },
      { month: '2026-W40', file: 'x.json' },
      { month: '2026-07' },
      null,
    ],
  };

  it('sorts months newest first and drops invalid entries', () => {
    const months = parseMonthIndex(index);
    expect(months.map((m) => m.month)).toEqual(['2026-09', '2026-08']);
    expect(months[0]).toEqual({
      month: '2026-09', date: '2026-10-05', runId: 'r', model: 'm', sectionCount: 3, chartCount: 3, file: '2026-09.json',
    });
    expect(months[1].runId).toBe('');
  });

  it('treats an index without months as empty', () => {
    expect(parseMonthIndex({ schema_version: 1, weeks: [] })).toEqual([]);
    expect(parseMonthIndex(null)).toEqual([]);
    expect(parseDigestIndex(index).map((w) => w.week)).toEqual(['2026-W41', '2026-W40']);
  });

  it('picks a month only on an exact request', () => {
    const months = parseMonthIndex(index);
    expect(pickMonth(months, '2026-08').month).toBe('2026-08');
    expect(pickMonth(months, '2026-07')).toBeNull();
    expect(pickMonth(months, null)).toBeNull();
    expect(pickMonth([], '2026-08')).toBeNull();
  });

  it('routes a requested month, else the weekly choice, else the newest month', () => {
    const weeks = parseDigestIndex(index);
    const months = parseMonthIndex(index);
    const view = (w, m, rw = null, rm = null) => {
      const v = pickView(w, m, rw, rm);
      return v && (v.kind === 'monthly' ? `month ${v.month.month}` : `week ${v.week.week}`);
    };
    expect(view(weeks, months, null, '2026-08')).toBe('month 2026-08');
    expect(view(weeks, months, '2026-W40', '2026-08')).toBe('month 2026-08');
    expect(view(weeks, months, '2026-W40', '2026-01')).toBe('week 2026-W40');
    expect(view(weeks, months)).toBe('week 2026-W41');
    expect(view([], months)).toBe('month 2026-09');
    expect(view([], [])).toBeNull();
  });
});

describe('monthly formatting helpers', () => {
  it('labels months and days', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
    expect(monthLabel('2026-13')).toBe('2026-13');
    expect(monthLabel('odd')).toBe('odd');
    expect(dayLabel('2026-09-30')).toBe('30 September 2026');
    expect(dayLabel('2026-07-01')).toBe('1 July 2026');
    expect(dayLabel('2026-00-01')).toBe('2026-00-01');
  });

  it('builds the subtitle from the chart window', () => {
    const p = parseMonthly(MONTH);
    expect(trendSubtitle(p)).toBe(
      "Movement by bloc and dimension over the 13 weeks to 30 September 2026, with the month's sourced changes.",
    );
    expect(trendSubtitle({ ...p, window: null })).toBe(
      "Movement by bloc and dimension over the trailing quarter to 30 September 2026, with the month's sourced changes.",
    );
    expect(trendSubtitle({ ...p, window: null, period: null })).toBe(
      "Movement by bloc and dimension over the trailing quarter, with the month's sourced changes.",
    );
  });

  it('phrases calibration breaks', () => {
    const b = (date, reason) => ({ date, model: '', reason });
    expect(breakPhrase([b('2026-09-14', 'Model switch')])).toBe('14 September 2026 (Model switch)');
    expect(breakPhrase([b('2026-09-07', 'A'), b('2026-09-14', 'B'), b('', 'C')])).toBe(
      '7 September 2026 (A), 14 September 2026 (B) and C',
    );
    expect(breakPhrase([])).toBe('');
  });

  it('finds the numeric table columns', () => {
    expect(numericColumns(TABLE)).toEqual([false, true, true, true]);
    expect(numericColumns({
      columns: ['Country', 'Dimension', 'Change', 'Share'],
      rows: [['Chile', 'Enforcement Level', '\u22120.25', '86%'], ['Peru', 'Policy Lever', 'n/a', '90%']],
    })).toEqual([false, false, true, true]);
    expect(numericColumns({ columns: ['Empty'], rows: [] })).toEqual([false]);
  });
});
