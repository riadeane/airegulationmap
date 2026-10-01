import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { csvFormat, csvParse } from 'd3-dsv';
import { getState, setState } from '../src/state/store';
import { openScatter, toggleScatter, setMainView, showMap } from '../src/state/interactions';
import {
  buildExportMeta,
  buildExportRows,
  exportCountries,
  exportFileName,
  scoresAsOf,
} from '../src/controls/export';
import { visibleCountriesIn } from '../src/state/selectors';

// #142: exports follow the timeline date, and opening the scatter view
// returns the timeline to "Latest".

const score = (country, avg, lastUpdated = '2026-09-28') => ({
  country,
  averageScore: avg,
  regulationStatus: avg,
  policyLever: avg,
  governanceType: 3,
  actorInvolvement: 2,
  enforcementLevel: avg,
  lastUpdated,
  dataVersion: 4,
});

const reg = (country, confidence = 'high') => ({
  country,
  regulationStatus: `${country} status text`,
  policyLever: `${country} lever text`,
  governanceType: `${country} governance text`,
  actorInvolvement: `${country} actor text`,
  enforcementLevel: `${country} enforcement text`,
  specificLaws: `${country} law`,
  sources: `https://example.org/${country}`,
  lastUpdated: '2026-09-28',
  confidence,
});

const snap = (date, avg, extra = {}) => ({
  date,
  regulationStatus: avg,
  policyLever: avg,
  governanceType: 1,
  actorInvolvement: 1,
  enforcementLevel: avg,
  averageScore: avg,
  ...extra,
});

const SCORE_DATA = {
  Aland: score('Aland', 4),
  Borland: score('Borland', 2),
  Newland: score('Newland', 3, '2026-09-20'),
};
const REG_DATA = {
  Aland: reg('Aland'),
  Borland: reg('Borland', 'medium'),
  Newland: reg('Newland', 'low'),
};
// Newland has no history record at all.
const SNAPSHOTS = {
  Aland: snap('2026-06-01', 2.5, { confidence: 'medium' }),
  Borland: snap('2026-07-01', null),
};
const VINTAGE = { date: '2026-06-13', snapshots: SNAPSHOTS };

const CSV_COLUMNS = [
  'Country', 'Average Score', 'Regulation Status (Score)', 'Policy Lever (Score)',
  'Governance Type (Score)', 'Actor Involvement (Score)', 'Enforcement Level (Score)',
  'Regulation Status', 'Policy Lever', 'Governance Type', 'Actor Involvement',
  'Enforcement Level', 'Specific Laws', 'Sources', 'Confidence', 'Last Updated',
  // PRD 15: appended, so no earlier column moves or is renamed.
  'Frontier Risk', 'Frontier Track',
];

describe('buildExportRows', () => {
  it('at Latest carries the latest entry, text included', () => {
    const [row] = buildExportRows(['Aland'], SCORE_DATA, REG_DATA);
    expect(Object.keys(row)).toEqual(CSV_COLUMNS);
    expect(row['Average Score']).toBe(4);
    expect(row['Regulation Status']).toBe('Aland status text');
    expect(row.Sources).toBe('https://example.org/Aland');
    expect(row.Confidence).toBe('high');
    expect(row['Last Updated']).toBe('2026-09-28');
  });

  it('on a past date carries the snapshot scores, its date and confidence, and no text', () => {
    const [row] = buildExportRows(['Aland'], SCORE_DATA, REG_DATA, VINTAGE);
    expect(Object.keys(row)).toEqual(CSV_COLUMNS);
    expect(row['Average Score']).toBe(2.5);
    expect(row['Regulation Status (Score)']).toBe(2.5);
    expect(row['Governance Type (Score)']).toBe(1);
    expect(row.Confidence).toBe('medium');
    expect(row['Last Updated']).toBe('2026-06-01');
    for (const column of ['Regulation Status', 'Policy Lever', 'Governance Type', 'Actor Involvement',
      'Enforcement Level', 'Specific Laws', 'Sources']) {
      expect(row[column], column).toBe('');
    }
  });

  it('leaves Confidence empty where the snapshot recorded none, and keeps a carried-back date', () => {
    // Borland's first snapshot is after the as-of date: carried back, as on the map.
    const [row] = buildExportRows(['Borland'], SCORE_DATA, REG_DATA, VINTAGE);
    expect(row['Average Score']).toBeNull();
    expect(row.Confidence).toBe('');
    expect(row['Last Updated']).toBe('2026-07-01');
  });

  it('falls back to the latest scores for a country history has no record of', () => {
    const [row] = buildExportRows(['Newland'], SCORE_DATA, REG_DATA, VINTAGE);
    expect(row['Average Score']).toBe(3);
    expect(row.Confidence).toBe('low');
    expect(row['Last Updated']).toBe('2026-09-20');
    expect(row['Regulation Status']).toBe('');
  });

  it('keeps the CSV header identical at Latest and on a past date', () => {
    const latest = buildExportRows(['Aland', 'Newland'], SCORE_DATA, REG_DATA);
    const past = buildExportRows(['Aland', 'Newland'], SCORE_DATA, REG_DATA, VINTAGE);
    expect(past.map(r => Object.keys(r))).toEqual(latest.map(r => Object.keys(r)));
  });
});

describe('frontier columns (PRD 15)', () => {
  const FRONTIER_SCORES = {
    Hostland: { ...score('Hostland', 3), frontierRisk: 2.5, frontierTrack: 'H' },
    Thinland: { ...score('Thinland', 2), frontierRisk: null, frontierTrack: 'G' },
    Aland: score('Aland', 4),
  };

  it('writes the score and the track, empty for a country never scored on the lens', () => {
    const rows = buildExportRows(['Hostland', 'Thinland', 'Aland'], FRONTIER_SCORES, REG_DATA);
    expect(rows.map(r => Object.keys(r).slice(-2))).toEqual(Array(3).fill(['Frontier Risk', 'Frontier Track']));
    expect(rows[0]['Frontier Risk']).toBe(2.5);
    expect(rows[0]['Frontier Track']).toBe('H');
    // Insufficient evidence: a track with a null score (an empty CSV cell).
    expect(rows[1]['Frontier Risk']).toBeNull();
    expect(rows[1]['Frontier Track']).toBe('G');
    // No data: no score and no track.
    expect(rows[2]['Frontier Risk']).toBeUndefined();
    expect(rows[2]['Frontier Track']).toBe('');
    const csv = csvParse(csvFormat(rows));
    expect(csv.map(r => [r['Frontier Risk'], r['Frontier Track']])).toEqual([['2.5', 'H'], ['', 'G'], ['', '']]);
  });

  it('follows the timeline: no frontier data before the snapshot that first carries it', () => {
    const vintage = {
      date: '2026-06-13',
      snapshots: { Hostland: snap('2026-06-01', 3), Thinland: snap('2026-06-01', 2, { frontierRisk: 1.5, frontierTrack: 'G' }) },
    };
    const [host, thin] = buildExportRows(['Hostland', 'Thinland'], FRONTIER_SCORES, REG_DATA, vintage);
    expect(host['Frontier Risk']).toBeUndefined();
    expect(host['Frontier Track']).toBe('');
    expect(thin['Frontier Risk']).toBe(1.5);
    expect(thin['Frontier Track']).toBe('G');
  });

  it('describes the frontier columns and the tracks in the meta block', () => {
    const meta = buildExportMeta('2026-10-05');
    expect(meta.fields['Frontier Risk'].label).toBe('Frontier Risk Governance');
    expect(meta.fields['Frontier Risk'].group).toBe('Frontier risk governance');
    expect(meta.frontier.trackColumn).toBe('Frontier Track');
    expect(Object.keys(meta.frontier.tracks)).toEqual(['H', 'C', 'G']);
    expect(meta.frontier.tracks.C.label).toBe('Compute or chokepoint');
    expect(meta.frontier.methodology).toBe('https://airegulationmap.org/methodology.html#frontier-risk-governance');
    expect(meta.note).toContain('not part of the implementation index');
  });
});

describe('buildExportMeta', () => {
  it('at Latest has no as-of date', () => {
    const meta = buildExportMeta('2026-09-28');
    expect(meta).not.toHaveProperty('asOf');
    expect(meta).not.toHaveProperty('vintage');
  });

  it('on a past date names the date and splits every CSV column into as-of or empty', () => {
    const meta = buildExportMeta('2026-09-28', '2026-06-13');
    expect(meta.exported).toBe('2026-09-28');
    expect(meta.asOf).toBe('2026-06-13');
    expect(meta.vintage.note).toContain('2026-06-13');
    const { asOfColumns, emptyColumns } = meta.vintage;
    expect(asOfColumns.filter(c => emptyColumns.includes(c))).toEqual([]);
    expect(CSV_COLUMNS.filter(c => c !== 'Country' && !asOfColumns.includes(c) && !emptyColumns.includes(c)))
      .toEqual([]);
    expect([...asOfColumns, ...emptyColumns]).toHaveLength(CSV_COLUMNS.length - 1);
    // The empty columns are exactly the ones a past-date row leaves empty.
    const [row] = buildExportRows(['Aland'], SCORE_DATA, REG_DATA, VINTAGE);
    expect(emptyColumns.every(c => row[c] === '')).toBe(true);
  });
});

describe('exportFileName', () => {
  it('carries the export day at Latest and the as-of date on a past date', () => {
    expect(exportFileName('filtered', 'csv', '2026-09-28', null)).toBe('ai-regulation-data-filtered-2026-09-28.csv');
    expect(exportFileName('all', 'json', '2026-09-28', '2026-06-13')).toBe('ai-regulation-data-all-as-of-2026-06-13.json');
  });
});

const FILTERS = {
  currentAttribute: 'averageScore',
  filterMin: 1,
  filterMax: 5,
  selectedBloc: null,
  blocsData: null,
  filterConfidence: null,
  filterOfficialOnly: false,
  filterEvidence: 'any',
  subscores: null,
};

describe('filtered scope on a past date', () => {
  it('applies the score range to the scores as of the date', () => {
    setState({ ...FILTERS, scoreData: SCORE_DATA, regulationData: REG_DATA, filterMin: 2, filterMax: 3 });
    const rows = scoresAsOf(SCORE_DATA, VINTAGE);
    expect(rows.Aland.averageScore).toBe(2.5);
    expect(rows.Newland.averageScore).toBe(3);
    // Latest: Aland is 4, out of range. As of the date: Aland is 2.5, in
    // range; Borland is insufficient evidence, out once the range narrows.
    expect([...visibleCountriesIn(SCORE_DATA)].sort()).toEqual(['Borland', 'Newland']);
    expect([...visibleCountriesIn(rows)].sort()).toEqual(['Aland', 'Newland']);
  });
});

describe('exportCountries', () => {
  let blobs;
  let downloads;
  let toast;

  beforeEach(() => {
    blobs = [];
    downloads = [];
    toast = { textContent: '', setAttribute() {}, classList: { add() {}, remove() {} } };
    vi.stubGlobal('document', {
      createElement: tag => (tag === 'a'
        ? { href: '', download: '', click() { downloads.push(this.download); } }
        : toast),
      getElementById: () => null,
      body: { appendChild() {} },
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob); return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    setState({
      ...FILTERS,
      scoreData: SCORE_DATA,
      regulationData: REG_DATA,
      history: {
        schema_version: 1,
        countries: {
          Aland: [snap('2026-06-01', 2.5, { confidence: 'medium' }), snap('2026-09-28', 4)],
          Borland: [snap('2026-07-01', null), snap('2026-09-28', 2)],
        },
      },
      timelineDate: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports the latest data at Latest', async () => {
    exportCountries(['Aland'], 'csv', 'all');
    expect(downloads[0]).toMatch(/^ai-regulation-data-all-\d{4}-\d{2}-\d{2}\.csv$/);
    const [row] = csvParse(await blobs[0].text());
    expect(row['Average Score']).toBe('4');
    expect(row['Regulation Status']).toBe('Aland status text');
    expect(toast.textContent).not.toContain('as of');
  });

  it('exports the scores as of the timeline date, and says so', async () => {
    setState({ timelineDate: '2026-06-01' });
    exportCountries(['Aland', 'Newland'], 'csv', 'all', 'all countries');
    expect(downloads[0]).toBe('ai-regulation-data-all-as-of-2026-06-01.csv');
    const text = await blobs[0].text();
    expect(text.split('\n')[0]).toBe(CSV_COLUMNS.join(','));
    const [aland, newland] = csvParse(text);
    expect(aland['Average Score']).toBe('2.5');
    expect(aland['Last Updated']).toBe('2026-06-01');
    expect(aland['Regulation Status']).toBe('');
    expect(newland['Average Score']).toBe('3');
    expect(toast.textContent).toContain('as of 2026-06-01');
  });

  it('names the as-of date in the JSON meta block and leaves out the latest-only detail', async () => {
    setState({
      timelineDate: '2026-06-01',
      subscores: { schema_version: 1, countries: { Aland: { date: '2026-09-28' } } },
    });
    exportCountries(['Aland'], 'json', 'all');
    expect(downloads[0]).toBe('ai-regulation-data-all-as-of-2026-06-01.json');
    const payload = JSON.parse(await blobs[0].text());
    expect(payload.meta.asOf).toBe('2026-06-01');
    expect(payload.countries[0]['Average Score']).toBe(2.5);
    expect(payload.countries[0]).not.toHaveProperty('Sub-indicators');
  });

  it('treats a date history does not know as Latest, as the map does', async () => {
    setState({ timelineDate: '2026-01-01' });
    exportCountries(['Aland'], 'json', 'all');
    expect(downloads[0]).not.toContain('as-of');
    const payload = JSON.parse(await blobs[0].text());
    expect(payload.meta).not.toHaveProperty('asOf');
    expect(payload.countries[0]['Average Score']).toBe(4);
  });
});

describe('opening the scatter view', () => {
  beforeEach(() => {
    setState({ mainView: 'map', comparisonCountries: [], timelineDate: '2026-06-01' });
  });

  it('returns the timeline to Latest', () => {
    openScatter();
    expect(getState().mainView).toBe('scatter');
    expect(getState().timelineDate).toBeNull();
  });

  it('also when toggled or set directly', () => {
    toggleScatter();
    expect(getState().timelineDate).toBeNull();
    showMap();
    setState({ timelineDate: '2026-06-01' });
    setMainView('scatter');
    expect(getState().timelineDate).toBeNull();
  });

  it('leaves the date alone for the other views', () => {
    showMap();
    expect(getState().timelineDate).toBe('2026-06-01');
    setState({ comparisonCountries: ['Aland', 'Borland'] });
    setMainView('comparison');
    expect(getState().mainView).toBe('comparison');
    expect(getState().timelineDate).toBe('2026-06-01');
  });
});
