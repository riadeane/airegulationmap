import { describe, it, expect } from 'vitest';
import { INSUFFICIENT_EVIDENCE_LABEL, isInsufficient } from '../src/constants';
import { parseScoresCsv } from '../src/data/loader';
import { normalizeSubscores } from '../src/data/subscores';
import { fillColor, fillState, anyInsufficient } from '../src/map/fill';
import { computeBlocStats, countInsufficient, blocCoverageText } from '../src/data/blocs';
import { computeChangelog, formatChangeValue, changeDirection } from '../src/data/changelog';
import { computeWeeklyChanges } from '../src/data/drift';
import { radarValues } from '../src/comparison/radar';
import { buildReportBody } from '../src/controls/report';
import { withSubindicators } from '../src/controls/export';
import { buildModels, jsonLd, renderCountryPage } from '../scripts/build_pages';

// Rubric v3.1 (issue #162): a score row whose value is null is
// "insufficient evidence", distinct from "no data" (no row at all), and
// never drawn or counted as a 1.

const HEADER = 'Country,Regulation Status,Policy Lever,Governance Type,Actor Involvement,Average Score,Enforcement Level,Last Updated,Data Version';

describe('isInsufficient', () => {
  it('is true for null only: undefined (no row) is not insufficient', () => {
    expect(isInsufficient(null)).toBe(true);
    expect(isInsufficient(undefined)).toBe(false);
    expect(isInsufficient(1)).toBe(false);
    expect(INSUFFICIENT_EVIDENCE_LABEL).toBe('Insufficient evidence');
  });
});

describe('loader', () => {
  it('parses empty score cells as null for dimensions and the composite', () => {
    const data = parseScoresCsv(`${HEADER}\nFiji,3,,2,3.5,,,2026-10-05,4\n`);
    const fiji = data.Fiji;
    expect(fiji.policyLever).toBeNull();
    expect(fiji.enforcementLevel).toBeNull();
    expect(fiji.averageScore).toBeNull();
    expect(fiji.regulationStatus).toBe(3);
    expect(Number.isNaN(fiji.policyLever)).toBe(false);
    // The row exists, so the null reads as insufficient evidence; a
    // country with no row reads as no data.
    expect(isInsufficient(data.Fiji?.policyLever)).toBe(true);
    expect(isInsufficient(data.Atlantis?.policyLever)).toBe(false);
  });
});

describe('subscores', () => {
  it('keeps an explicit null score with its rationale; skips a garbled one', () => {
    const data = normalizeSubscores({
      schema_version: 1,
      countries: {
        Fiji: {
          date: '2026-10-05',
          enforcement_level: {
            actions_taken: { score: null, rationale: 'Searched the gazette; nothing found.' },
            monitoring_practice: { score: 'x', rationale: 'Bad.' },
            sanctions_framework: { score: 2, rationale: 'Penalties in the data law.' },
          },
        },
      },
    });
    const block = data.countries.Fiji.enforcement_level;
    expect(block.actions_taken).toEqual({ score: null, rationale: 'Searched the gazette; nothing found.' });
    expect(block.monitoring_practice).toBeNull();
    expect(block.sanctions_framework.score).toBe(2);
  });
});

describe('map fill', () => {
  const colorScale = (v) => `ramp(${v})`;
  const colors = { noData: 'grey-no-data', insufficient: 'grey-insufficient' };

  it('never returns the colour for 1 for a null value', () => {
    const entry = { averageScore: null, policyLever: 1 };
    expect(fillColor(entry, 'averageScore', colorScale, colors)).toBe('grey-insufficient');
    expect(fillColor(entry, 'averageScore', colorScale, colors)).not.toBe(colorScale(1));
    expect(fillColor(entry, 'policyLever', colorScale, colors)).toBe('ramp(1)');
  });

  it('tells insufficient evidence from no data', () => {
    expect(fillState({ averageScore: null }, 'averageScore')).toBe('insufficient');
    expect(fillState(undefined, 'averageScore')).toBe('no-data');
    expect(fillState({ averageScore: Number.NaN }, 'averageScore')).toBe('no-data');
    expect(fillState({ averageScore: 2.5 }, 'averageScore')).toBe('score');
    expect(fillColor(undefined, 'averageScore', colorScale, colors)).toBe('grey-no-data');
  });

  it('asks for the legend key only when a country is insufficient on the shown attribute', () => {
    const data = { A: { averageScore: 3, policyLever: null }, B: { averageScore: 2, policyLever: 2 } };
    expect(anyInsufficient(data, 'policyLever')).toBe(true);
    expect(anyInsufficient(data, 'averageScore')).toBe(false);
    expect(anyInsufficient({}, 'averageScore')).toBe(false);
  });
});

describe('bloc stats', () => {
  const scores = {
    A: { enforcementLevel: 4 },
    B: { enforcementLevel: null },
    C: { enforcementLevel: null },
  };
  const members = ['A', 'B', 'C', 'Atlantis'];

  it('excludes nulls from the math and counts them separately', () => {
    const stats = computeBlocStats(members, scores, 'enforcementLevel');
    expect(stats).toMatchObject({ average: 4, scoredCount: 1, memberCount: 4 });
    expect(countInsufficient(members, scores, 'enforcementLevel')).toBe(2);
  });

  it('says how many members have insufficient evidence', () => {
    expect(blocCoverageText(4, 1, 2)).toBe('1 of 4 members scored, 2 with insufficient evidence');
    expect(blocCoverageText(4, 1, 0)).toBe('1 of 4 members scored');
    expect(blocCoverageText(3, 0, 3)).toBe('3 members · no scores for this dimension, 3 with insufficient evidence');
  });
});

describe('changelog', () => {
  const snap = (date, overrides = {}) => ({
    date, regulationStatus: 2, policyLever: 2, governanceType: 2,
    actorInvolvement: 2, enforcementLevel: 2, averageScore: 2, ...overrides,
  });

  it('records a move to or from null, with no direction', () => {
    const [entry] = computeChangelog([
      snap('2026-06-13'),
      snap('2026-10-05', { enforcementLevel: null }),
    ]);
    const [change] = entry.changes;
    expect(change).toMatchObject({ dimension: 'enforcementLevel', from: 2, to: null });
    expect(changeDirection(change)).toBeNull();
    expect(`${formatChangeValue(change.from)} → ${formatChangeValue(change.to)}`)
      .toBe('2 → insufficient evidence');
    expect(changeDirection({ from: 2, to: 2.5 })).toBe('up');
    expect(changeDirection({ from: 2, to: 1.5 })).toBe('down');
  });

  it('treats null against null as unchanged', () => {
    const entries = computeChangelog([
      snap('2026-06-13', { enforcementLevel: null }),
      snap('2026-10-05', { enforcementLevel: null, policyLever: 3 }),
    ]);
    expect(entries[0].changes.map(c => c.dimension)).toEqual(['policyLever']);
  });

  it('drift aggregations count the country but leave the null move out of the deltas', () => {
    const weeks = computeWeeklyChanges({
      schema_version: 1,
      countries: { Fiji: [snap('2026-06-13'), snap('2026-10-05', { enforcementLevel: null })] },
    });
    const week = weeks.find(w => w.date === '2026-10-05');
    expect(week.changed).toBe(1);
    expect(week.moves).toEqual([]);
  });
});

describe('comparison radar', () => {
  it('leaves an insufficient-evidence axis as a gap, not a 0', () => {
    const values = radarValues({
      averageScore: 3, regulationStatus: 3, policyLever: null,
      governanceType: 2, actorInvolvement: 2, enforcementLevel: 4,
    });
    expect(values).toEqual([3, 3, null, 4]);
  });
});

describe('issue report', () => {
  it('writes "Insufficient evidence" for null scores and sub-indicators', () => {
    const subscores = normalizeSubscores({
      schema_version: 1,
      countries: {
        Fiji: {
          date: '2026-10-05',
          enforcement_level: {
            actions_taken: { score: null, rationale: 'Searched the gazette; nothing found.' },
          },
        },
      },
    }).countries.Fiji;
    const body = buildReportBody({
      country: 'Fiji',
      score: {
        country: 'Fiji', regulationStatus: 3, policyLever: 2, governanceType: 2,
        actorInvolvement: 3, averageScore: null, enforcementLevel: null,
        lastUpdated: '2026-10-05', dataVersion: 3,
      },
      regulation: null,
      subscores,
      url: 'https://airegulationmap.org/?country=Fiji',
      accessed: '2026-10-05',
    });
    expect(body).toContain('| Implementation Index | Insufficient evidence |');
    expect(body).toContain('| Enforcement Level | Insufficient evidence |');
    expect(body).toContain('| Enforcement Level | Actions taken | Insufficient evidence | Searched the gazette; nothing found. |');
  });
});

describe('export', () => {
  it('keeps a null sub-indicator score as JSON null', () => {
    const subscores = normalizeSubscores({
      schema_version: 1,
      countries: { Fiji: { date: '2026-10-05', enforcement_level: { actions_taken: { score: null, rationale: 'Nothing found.' } } } },
    }).countries;
    const [row] = withSubindicators([{ Country: 'Fiji', 'Enforcement Level (Score)': null }], subscores);
    const json = JSON.parse(JSON.stringify(row));
    expect(json['Enforcement Level (Score)']).toBeNull();
    expect(json['Sub-indicators'].enforcement_level.actions_taken).toEqual({ score: null, rationale: 'Nothing found.' });
  });
});

describe('static country page', () => {
  const inputs = () => ({
    scores: {
      Fiji: {
        country: 'Fiji', regulationStatus: 2, policyLever: 2.25, governanceType: 2,
        actorInvolvement: 3, averageScore: null, enforcementLevel: null,
        lastUpdated: '2026-10-05', dataVersion: 3,
      },
    },
    regulation: {
      Fiji: {
        country: 'Fiji', regulationStatus: 'A strategy exists.', policyLever: null,
        governanceType: null, actorInvolvement: null, enforcementLevel: 'Nothing found on enforcement.',
        specificLaws: null, sources: null, lastUpdated: '2026-10-05', confidence: 'low',
      },
    },
    iso: {},
    blocs: {},
    subscores: normalizeSubscores({
      schema_version: 1,
      countries: {
        Fiji: {
          date: '2026-10-05',
          enforcement_level: { actions_taken: { score: null, rationale: 'Searched the gazette; nothing found.' } },
        },
      },
    }),
  });

  it('shows "Insufficient evidence" in the score cells and the sub-indicator row', () => {
    const [model] = buildModels(inputs());
    const html = renderCountryPage(model);
    expect(html).toContain('<td class="num">Insufficient evidence</td>');
    expect(html).toMatch(/Enforcement Level <span class="dim-score">Insufficient evidence<\/span>/);
    expect(html).toContain('Implementation index: <strong>insufficient evidence</strong>');
    expect(html).not.toContain('<td class="num">n/a</td>');
  });

  it('leaves null scores out of the JSON-LD variableMeasured', () => {
    const [model] = buildModels(inputs());
    const names = jsonLd(model).variableMeasured.map(v => v.name);
    expect(names).toEqual(['Regulation Status', 'Policy Lever', 'Governance Type', 'Actor Involvement']);
    expect(jsonLd(model).variableMeasured.every(v => typeof v.value === 'number')).toBe(true);
  });
});
