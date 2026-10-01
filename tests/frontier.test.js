import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ATTRIBUTES, ATTRIBUTE_KEYS, FRONTIER_SUBINDICATORS, FRONTIER_SUBINDICATOR_KEYS, FRONTIER_TRACKS, GROUPS,
  LEGEND_ENDPOINTS, NOT_APPLICABLE_LABEL, SCORE_OPTIONS, attributesIn, hasFrontierTrack, isNotApplicable,
  parseFrontierTrack,
} from '../src/constants';
import { parseRegulationCsv, parseScoresCsv } from '../src/data/loader';
import { normalizeSubscores, DIMENSION_TO_SNAKE } from '../src/data/subscores';
import { buildScoresAtDate } from '../src/data/history';
import { computeChangelog, computeRecentChanges } from '../src/data/changelog';
import { computeWeeklyChanges } from '../src/data/drift';
import {
  apiColumnDescription, blocExtremes, frontierCellValue, frontierTrackLine, groupCaption, legendCaption,
  levelMeaning, modeAnnouncement, scoreLine,
} from '../src/data/meaning';
import { anyInsufficient, fillColor, fillState } from '../src/map/fill';
import { selectorGroups } from '../src/controls/scoreSelector';
import { getState, setState } from '../src/state/store';
import { receiveData, selectAttribute, setScatterAxes } from '../src/state/interactions';
import { buildReportBody } from '../src/controls/report';
import { withSubindicators, buildExportRows } from '../src/controls/export';
import { parseUrl, buildQueryString } from '../src/controls/url';
import { citationsFor } from '../src/controls/citation';

// Frontier Risk Governance (PRD 15 req 17, PRD 16 phase 2): the seventh
// attribute, its own lens, scored by track, with "na" and insufficient
// evidence as their own states and never the colour for 1.

const HEADER = 'Country,Regulation Status,Policy Lever,Governance Type,Actor Involvement,Average Score,'
  + 'Enforcement Level,Last Updated,Data Version,Frontier Risk,Frontier Track';

const FRONTIER_FILE = {
  date: '2026-10-05',
  track: 'H',
  rubric: 'f1',
  developer_obligations: { score: 4, rationale: 'EU AI Act GPAI obligations apply since 2 Aug 2025.', eu_level: true },
  evaluation_oversight: { score: 3, rationale: 'AI Office evaluations, limited access.' },
  incident_emergency_preparedness: { score: null, rationale: 'No source on incident reporting found.' },
  international_coordination: { score: 4, rationale: 'Network member; Bletchley and Seoul.', computed: true },
};

const GLOBAL_FILE = {
  date: '2026-10-05',
  track: 'G',
  rubric: 'f1',
  developer_obligations: { score: 'na', rationale: 'Does not apply on the global track.' },
  evaluation_oversight: { score: 'na', rationale: 'Does not apply on the global track.' },
  incident_emergency_preparedness: { score: 2, rationale: 'A draft bill only.' },
  international_coordination: { score: 3, rationale: 'Bletchley signatory.', computed: true },
};

describe('the vocabulary', () => {
  it('adds a seventh attribute on its own lens, last in display order', () => {
    expect(ATTRIBUTE_KEYS.at(-1)).toBe('frontierRisk');
    expect(attributesIn('frontier')).toEqual(['frontierRisk']);
    expect(SCORE_OPTIONS.at(-1)).toEqual({ value: 'frontierRisk', text: 'Frontier Risk Governance' });
    expect(ATTRIBUTES.frontierRisk.question).toBe(
      'How close is governance of catastrophic frontier-AI risk to the standard stated in the methodology?'
    );
    expect(LEGEND_ENDPOINTS.frontierRisk).toEqual(['Nothing observable', 'Meets the stated standard']);
    expect(ATTRIBUTES.frontierRisk.notClaim).toMatch(/not a measure of how safe a country is/);
    expect(GROUPS.frontier.label).toBe('Frontier risk governance');
    // Not part of the implementation index.
    expect(attributesIn('implementation')).not.toContain('frontierRisk');
  });

  it('names the three tracks and four sub-indicators with an anchor for every level', () => {
    expect(Object.fromEntries(Object.entries(FRONTIER_TRACKS).map(([k, v]) => [k, v.label]))).toEqual({
      H: 'Frontier host', C: 'Compute or chokepoint', G: 'Global',
    });
    for (const track of Object.values(FRONTIER_TRACKS)) expect(track.description.length).toBeGreaterThan(20);
    expect(FRONTIER_SUBINDICATOR_KEYS).toEqual([
      'developer_obligations', 'evaluation_oversight', 'incident_emergency_preparedness', 'international_coordination',
    ]);
    for (const key of FRONTIER_SUBINDICATOR_KEYS) {
      const m = FRONTIER_SUBINDICATORS[key];
      expect(Object.keys(m.levels)).toEqual(['1', '2', '3', '4', '5']);
      expect(m.tracks.length).toBeGreaterThan(0);
    }
    // Each track has at least two applicable sub-indicators.
    for (const track of ['H', 'C', 'G']) {
      expect(FRONTIER_SUBINDICATOR_KEYS.filter(k => FRONTIER_SUBINDICATORS[k].tracks.includes(track)).length)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('parses track codes and the "na" value', () => {
    expect(parseFrontierTrack(' h ')).toBe('H');
    expect(parseFrontierTrack('X')).toBeNull();
    expect(parseFrontierTrack('')).toBeNull();
    expect(parseFrontierTrack(undefined)).toBeNull();
    expect(isNotApplicable('na')).toBe(true);
    expect(isNotApplicable(1)).toBe(false);
    expect(isNotApplicable(null)).toBe(false);
  });
});

describe('loader', () => {
  it('reads the frontier score and track; an empty track leaves the score undefined (no data)', () => {
    const data = parseScoresCsv(`${HEADER}
Hostland,4,4,3,3,4,4,2026-10-05,5,2.5,H
Thinland,2,2,2,2,2,2,2026-10-05,5,,G
Quietland,2,2,2,2,2,2,2026-10-05,5,,
Strayland,2,2,2,2,2,2,2026-10-05,5,3,
`);
    expect(data.Hostland.frontierRisk).toBe(2.5);
    expect(data.Hostland.frontierTrack).toBe('H');
    // A track with an empty score: insufficient evidence.
    expect(data.Thinland.frontierRisk).toBeNull();
    expect(data.Thinland.frontierTrack).toBe('G');
    // No track: never scored on the lens, whatever the score cell says.
    expect(data.Quietland.frontierRisk).toBeUndefined();
    expect(data.Quietland.frontierTrack).toBeUndefined();
    expect(data.Strayland.frontierRisk).toBeUndefined();
    // The implementation index is untouched.
    expect(data.Hostland.averageScore).toBe(4);
  });

  it('reads a file without the frontier columns as before', () => {
    const data = parseScoresCsv('Country,Average Score,Last Updated\nOldland,3,2026-09-28\n');
    expect('frontierRisk' in data.Oldland).toBe(false);
    expect(hasFrontierTrack(data)).toBe(false);
  });

  it('reads the frontier text and sources from regulation_data.csv', () => {
    const data = parseRegulationCsv(
      'Country,Regulation Status,Confidence,Frontier Risk,Frontier Sources\n'
      + 'Hostland,Text.,high,"Frontier text, in prose.",https://a.gov/x|https://b.org/y\n'
      + 'Quietland,Text.,low,,\n'
    );
    expect(data.Hostland.frontierRisk).toBe('Frontier text, in prose.');
    expect(data.Hostland.frontierSources).toBe('https://a.gov/x|https://b.org/y');
    expect(data.Quietland.frontierRisk).toBeNull();
    expect(data.Quietland.frontierSources).toBeNull();
  });
});

describe('subscores.json frontier block', () => {
  const data = normalizeSubscores({
    schema_version: 1,
    countries: {
      Hostland: {
        date: '2026-10-05',
        regulation_status: { binding_force: { score: 4, rationale: 'Law.' } },
        frontier: FRONTIER_FILE,
        evidence: { grounded: false, initiatives_used: null, search: true, model: 'm', run_id: 'r' },
      },
      Globeland: { date: '2026-10-05', frontier: GLOBAL_FILE },
      Oddland: {
        date: '2026-10-05',
        frontier: { track: 'Z', developer_obligations: { score: 9 }, evaluation_oversight: 'x' },
      },
      Oldland: { date: '2026-06-13', regulation_status: { binding_force: 3 } },
    },
  });

  it('normalizes scores, "na", null, the EU-level and computed flags', () => {
    const block = data.countries.Hostland.frontier;
    expect(block.date).toBe('2026-10-05');
    expect(block.track).toBe('H');
    expect(block.rubric).toBe('f1');
    expect(block.developer_obligations).toEqual({
      score: 4, rationale: 'EU AI Act GPAI obligations apply since 2 Aug 2025.', eu_level: true,
    });
    expect(block.evaluation_oversight).toEqual({ score: 3, rationale: 'AI Office evaluations, limited access.' });
    expect(block.incident_emergency_preparedness.score).toBeNull();
    expect(block.international_coordination.computed).toBe(true);
    const global = data.countries.Globeland.frontier;
    expect(global.track).toBe('G');
    expect(global.developer_obligations.score).toBe('na');
    expect(global.evaluation_oversight).toEqual({ score: 'na', rationale: 'Does not apply on the global track.' });
  });

  it('drops a malformed block and leaves the dimension blocks and evidence as they were', () => {
    expect(data.countries.Oddland.frontier).toBeUndefined();
    expect(data.countries.Oldland.frontier).toBeUndefined();
    const host = data.countries.Hostland;
    expect(host.regulation_status.binding_force).toEqual({ score: 4, rationale: 'Law.' });
    expect(host.evidence.search).toBe(true);
    // The dimension walk never reads the frontier key.
    expect(Object.values(DIMENSION_TO_SNAKE)).not.toContain('frontier');
    expect(Object.keys(host).sort()).toEqual(['date', 'evidence', 'frontier', 'regulation_status']);
  });
});

describe('what each surface says', () => {
  it('tooltip, legend, live region, bloc card and panel caption', () => {
    expect(scoreLine('frontierRisk', 2.5)).toBe('Frontier Risk Governance: 2.5 / 5, against a stated standard');
    expect(legendCaption('frontierRisk')).toEqual({
      question: ATTRIBUTES.frontierRisk.question,
      notClaim: 'Measured against a stated standard; not a measure of how safe a country is.',
    });
    expect(modeAnnouncement('frontierRisk')).toBe(
      'Map now showing Frontier Risk Governance. '
      + 'How close is governance of catastrophic frontier-AI risk to the standard stated in the methodology? '
      + 'Legend runs from Nothing observable (1) to Meets the stated standard (5). '
      + 'Measured against a stated standard; not a measure of how safe a country is. '
      + 'Scored by track; capped at the weakest element.'
    );
    // The other lenses' announcements do not change.
    expect(modeAnnouncement('averageScore')).not.toContain('track');
    expect(blocExtremes('frontierRisk')).toEqual({ high: 'Closest to the standard', low: 'Furthest from the standard' });
    expect(groupCaption('frontier')).toBe('Frontier risk governance: distance to a stated standard, not how safe a country is');
  });

  it('the track in words, with the EU-level flag', () => {
    expect(frontierTrackLine('H')).toBe('Frontier host track');
    expect(frontierTrackLine('H', true)).toBe('Frontier host track, EU-level developer obligations');
    expect(frontierTrackLine('C')).toBe('Compute or chokepoint track');
    expect(frontierTrackLine('G')).toBe('Global track');
    expect(frontierTrackLine(null)).toBeNull();
    expect(frontierTrackLine(undefined)).toBeNull();
  });

  it('a sub-indicator value is a number, "Not applicable" or "Insufficient evidence", never a 1', () => {
    expect(frontierCellValue(3)).toBe('3');
    expect(frontierCellValue('na')).toBe(NOT_APPLICABLE_LABEL);
    expect(frontierCellValue(null)).toBe('Insufficient evidence');
  });

  it('level meanings come from the frontier anchors', () => {
    expect(levelMeaning('frontier', 'evaluation_oversight', 4)).toMatch(/voluntary agreements count/);
    expect(levelMeaning('frontier', 'international_coordination', 2)).toBe('Only broad AI declarations (Paris 2025, New Delhi 2026)');
    expect(levelMeaning('frontier', 'developer_obligations', 1)).toMatch(/^No binding rule/);
    expect(levelMeaning('frontier', 'nope', 3)).toBeNull();
    // The implementation ladder is not borrowed.
    expect(levelMeaning('frontier', 'incident_emergency_preparedness', 5)).not.toBe(levelMeaning('implementation', 'scope', 5));
  });

  it('API docs describe the new public_export columns', () => {
    expect(apiColumnDescription('frontier_risk')).toMatch(/^Frontier Risk Governance \(frontier risk governance\), 1 to 5\./);
    expect(apiColumnDescription('frontier_risk')).toMatch(/Not part of avg_score\.$/);
    expect(apiColumnDescription('frontier_track')).toMatch(/H \(frontier host\), C \(compute or chokepoint\) or G \(global\)/);
    expect(apiColumnDescription('frontier_subscores')).toMatch(/"na" \(does not apply on the track\)/);
    expect(apiColumnDescription('frontier_risk_text')).toMatch(/frontier AI risk/);
    expect(apiColumnDescription('frontier_sources_raw')).toMatch(/frontier_risk_text/);
  });
});

describe('map fill on the frontier lens', () => {
  const colorScale = v => `frontier-ramp(${v})`;
  const colors = { noData: 'no-data', insufficient: 'insufficient' };

  it('never gives insufficient evidence the colour for 1, and tells it from no data', () => {
    const scored = { averageScore: 3, frontierRisk: 1, frontierTrack: 'G' };
    const insufficient = { averageScore: 3, frontierRisk: null, frontierTrack: 'H' };
    const unscored = { averageScore: 3 };
    expect(fillColor(scored, 'frontierRisk', colorScale, colors)).toBe('frontier-ramp(1)');
    expect(fillColor(insufficient, 'frontierRisk', colorScale, colors)).toBe('insufficient');
    expect(fillColor(insufficient, 'frontierRisk', colorScale, colors)).not.toBe(colorScale(1));
    // A row never scored on the lens is "no data" there, not insufficient.
    expect(fillState(unscored, 'frontierRisk')).toBe('no-data');
    expect(fillState(undefined, 'frontierRisk')).toBe('no-data');
    // The same rows still paint on the other lenses.
    expect(fillColor(unscored, 'averageScore', colorScale, colors)).toBe('frontier-ramp(3)');
    expect(anyInsufficient({ A: scored, B: unscored }, 'frontierRisk')).toBe(false);
    expect(anyInsufficient({ A: scored, B: insufficient }, 'frontierRisk')).toBe(true);
  });

  it('has its own ramp tokens in both themes, distinct from the other two and from the insufficient fill', () => {
    const css = readFileSync(new URL('../src/styles/_tokens.css', import.meta.url), 'utf8');
    const lows = [...css.matchAll(/--ramp-frontier-low:\s*(oklch\([^)]+\))/g)].map(m => m[1]);
    const highs = [...css.matchAll(/--ramp-frontier-high:\s*(oklch\([^)]+\))/g)].map(m => m[1]);
    // Dark default, light by media query, light by data-theme.
    expect(lows).toHaveLength(3);
    expect(highs).toHaveLength(3);
    const hue = s => Number(s.match(/oklch\(\S+ \S+ (\d+)/)[1]);
    const light = s => Number(s.match(/oklch\(([\d.]+)%/)[1]);
    for (const [low, high] of lows.map((l, i) => [l, highs[i]])) {
      // Light (nothing observable) to dark (meets the standard).
      expect(light(low)).toBeGreaterThan(light(high) + 30);
      // Not red (~25-30), and well apart from the blue (250-262) and the stone (55-85).
      for (const h of [hue(low), hue(high)]) {
        expect(h).toBeGreaterThan(290);
        expect(h).toBeLessThan(340);
      }
    }
    const insufficient = [...css.matchAll(/--score-insufficient:\s*(oklch\([^)]+\))/g)].map(m => m[1]);
    expect(lows.every(l => !insufficient.includes(l))).toBe(true);
  });
});

describe('the selector offers the lens only with frontier data', () => {
  const WITH = { A: { country: 'A', averageScore: 3, frontierRisk: 2, frontierTrack: 'G' }, B: { country: 'B', averageScore: 2 } };
  const WITHOUT = { A: { country: 'A', averageScore: 3 }, B: { country: 'B', averageScore: 2 } };

  beforeEach(() => {
    setState({ scoreData: WITHOUT, currentAttribute: 'averageScore', scatterX: 'enforcementLevel', scatterY: 'regulationStatus' });
  });

  it('lists two groups without a track and three with one', () => {
    expect(selectorGroups(WITHOUT)).toEqual(['implementation', 'style']);
    expect(selectorGroups(WITH)).toEqual(['implementation', 'style', 'frontier']);
    expect(selectorGroups({})).toEqual(['implementation', 'style']);
  });

  it('ignores the frontier lens (map and scatter) until some country has a track', () => {
    selectAttribute('frontierRisk');
    expect(getState().currentAttribute).toBe('averageScore');
    setScatterAxes('frontierRisk', 'policyLever');
    expect(getState().scatterX).toBe('enforcementLevel');
    receiveData({ scoreData: WITH });
    selectAttribute('frontierRisk');
    expect(getState().currentAttribute).toBe('frontierRisk');
    setScatterAxes('frontierRisk', 'policyLever');
    expect(getState().scatterX).toBe('frontierRisk');
  });

  it('returns to the defaults when replacement data drops every track', () => {
    receiveData({ scoreData: WITH });
    selectAttribute('frontierRisk');
    setScatterAxes('policyLever', 'frontierRisk');
    receiveData({ scoreData: WITHOUT });
    expect(getState().currentAttribute).toBe('averageScore');
    expect(getState().scatterX).toBe('enforcementLevel');
    expect(getState().scatterY).toBe('regulationStatus');
    expect(getState().scoreData).toBe(WITHOUT);
  });
});

describe('timeline and changelog', () => {
  const base = { regulationStatus: 3, policyLever: 3, governanceType: 2, actorInvolvement: 2, enforcementLevel: 3, averageScore: 3 };
  const history = {
    schema_version: 1,
    countries: {
      Hostland: [
        { date: '2026-06-13', ...base },
        { date: '2026-10-05', ...base, frontierRisk: 2.5, frontierTrack: 'H' },
        { date: '2026-10-12', ...base, frontierRisk: 3, frontierTrack: 'H' },
      ],
      // First researched with the lens: the earliest state carries back,
      // but the frontier score does not.
      Newland: [{ date: '2026-10-05', ...base, frontierRisk: null, frontierTrack: 'G' }],
    },
  };

  it('has no frontier data before a country\'s first frontier snapshot', () => {
    const before = buildScoresAtDate(history, '2026-07-01');
    expect(before.Hostland.frontierRisk).toBeUndefined();
    expect(before.Newland.frontierRisk).toBeUndefined();
    expect(before.Newland.frontierTrack).toBeUndefined();
    expect(before.Newland.averageScore).toBe(3);
    expect(fillState(before.Newland, 'frontierRisk')).toBe('no-data');
    const after = buildScoresAtDate(history, '2026-10-05');
    expect(after.Hostland.frontierRisk).toBe(2.5);
    expect(after.Newland.frontierRisk).toBeNull();
    expect(fillState(after.Newland, 'frontierRisk')).toBe('insufficient');
  });

  it('lists frontier moves, but not the first frontier assessment', () => {
    const log = computeChangelog(history.countries.Hostland);
    const diffs = log.filter(e => !e.initial);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].changes).toEqual([{ dimension: 'frontierRisk', label: 'Frontier Risk Governance', from: 2.5, to: 3 }]);
  });

  it('counts a frontier move in "This week", labelled from the vocabulary', () => {
    const recent = computeRecentChanges(history, '2026-10-14');
    expect(recent).toEqual([{
      country: 'Hostland', dimension: 'frontierRisk', label: 'Frontier Risk Governance', delta: 0.5, date: '2026-10-12',
    }]);
    // The first frontier assessment (2026-10-05) is not news.
    expect(computeRecentChanges(history, '2026-10-06')).toEqual([]);
  });

  it('keeps the drift dashboard on the five dimensions', () => {
    const weeks = computeWeeklyChanges(history);
    expect(weeks.every(w => w.changed === 0)).toBe(true);
    expect(weeks.flatMap(w => w.moves)).toEqual([]);
  });
});

describe('issue report and JSON export', () => {
  const subscores = normalizeSubscores({
    schema_version: 1,
    countries: { Hostland: { date: '2026-10-05', frontier: { ...FRONTIER_FILE, track: 'H' } }, Globeland: { date: '2026-10-05', frontier: GLOBAL_FILE } },
  }).countries;
  const score = {
    country: 'Hostland', regulationStatus: 4, policyLever: 4, governanceType: 3, actorInvolvement: 3,
    averageScore: 4, enforcementLevel: 4, lastUpdated: '2026-10-05', dataVersion: 5, frontierRisk: 3.5, frontierTrack: 'H',
  };
  const regulation = {
    country: 'Hostland', regulationStatus: 'Law.', policyLever: null, governanceType: null, actorInvolvement: null,
    enforcementLevel: null, specificLaws: null, sources: 'https://a.gov/x', lastUpdated: '2026-10-05', confidence: 'high',
    frontierRisk: 'Frontier text.', frontierSources: 'https://a.gov/f',
  };

  it('the report lists the frontier score with its track and the four sub-indicators', () => {
    const body = buildReportBody({
      country: 'Hostland', score, regulation, subscores: subscores.Hostland, url: 'https://x', accessed: '2026-10-06',
    });
    expect(body).toContain('| Frontier Risk Governance | 3.50 (Frontier host track, EU-level developer obligations) |');
    expect(body).toContain('| Frontier Risk Governance | Developer obligations (EU-level) | 4 |');
    expect(body).toContain('| Frontier Risk Governance | Incident and emergency preparedness | Insufficient evidence |');

    const global = buildReportBody({
      country: 'Globeland', score: { ...score, country: 'Globeland', frontierRisk: 2.5, frontierTrack: 'G' },
      regulation, subscores: subscores.Globeland, url: 'https://x', accessed: '2026-10-06',
    });
    expect(global).toContain('| Frontier Risk Governance | Developer obligations | Not applicable |');
  });

  it('the report leaves the frontier row out for a country never scored on the lens', () => {
    const plain = { ...score };
    delete plain.frontierRisk;
    delete plain.frontierTrack;
    const body = buildReportBody({ country: 'Hostland', score: plain, regulation, subscores: null, url: 'https://x', accessed: '2026-10-06' });
    expect(body).not.toContain('Frontier');
  });

  it('the JSON export carries the frontier block as the file has it, with its text and sources', () => {
    const rows = buildExportRows(['Hostland', 'Globeland'], { Hostland: score }, { Hostland: regulation });
    const [host, globe] = withSubindicators(rows, subscores, { Hostland: regulation });
    expect(host['Frontier Risk']).toBe(3.5);
    expect(host.Frontier.track).toBe('H');
    expect(host.Frontier.developer_obligations).toEqual(FRONTIER_FILE.developer_obligations);
    expect(host.Frontier.text).toBe('Frontier text.');
    expect(host.Frontier.sources).toBe('https://a.gov/f');
    // The frontier block is not repeated among the dimension sub-indicators.
    expect(host['Sub-indicators']).not.toHaveProperty('frontier');
    expect(globe.Frontier.evaluation_oversight.score).toBe('na');
    expect(JSON.parse(JSON.stringify(globe)).Frontier.developer_obligations.score).toBe('na');
  });
});

describe('URL state and citation', () => {
  it('carries the lens as ?mode= and as a scatter axis', () => {
    expect(parseUrl('?mode=frontierRisk')).toEqual({ mode: 'frontierRisk' });
    expect(parseUrl('?scatter=frontierRisk,policyLever').scatter).toEqual({ x: 'frontierRisk', y: 'policyLever' });
    expect(buildQueryString({ ...getState(), currentAttribute: 'frontierRisk', selectedCountry: null, comparisonCountries: [], mainView: 'map' }, null))
      .toContain('mode=frontierRisk');
  });

  it('names the lens in the citation title', () => {
    const { apa } = citationsFor({ country: 'Kenya', mode: 'frontierRisk', url: 'https://x', accessed: '2026-10-06' });
    expect(apa).toContain('AI Regulation Map: Kenya (Frontier Risk Governance)');
  });
});
