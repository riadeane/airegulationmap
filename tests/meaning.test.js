import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTES, ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, GROUPS, LEGEND_ENDPOINTS, SCORE_OPTIONS,
  attributesIn,
} from '../src/constants';
import {
  scoreLine, legendCaption, modeAnnouncement, blocExtremes, groupCaption, levelMeaning,
  noGovernanceActivity, apiColumnDescription, apiSummaryText,
} from '../src/data/meaning';
import { SUBSCORE_LABELS, STYLE_ANCHORS } from '../src/data/subscores';
import { buildExportMeta } from '../src/controls/export';
import { peerSets } from '../src/data/peers';

// PRD 16: one vocabulary for what every score means.

describe('the score vocabulary', () => {
  it('has a full record for every attribute', () => {
    for (const key of ATTRIBUTE_KEYS) {
      const m = ATTRIBUTES[key];
      for (const field of ['label', 'question', 'low', 'high', 'notClaim', 'highMember', 'lowMember']) {
        expect(typeof m[field], `${key}.${field}`).toBe('string');
        expect(m[field].length, `${key}.${field}`).toBeGreaterThan(0);
      }
      expect(['implementation', 'style']).toContain(m.group);
      expect(m.question.endsWith('?'), key).toBe(true);
    }
  });

  it('names the composite the Implementation Index and groups the lenses', () => {
    expect(ATTRIBUTE_LABELS.averageScore).toBe('Implementation Index');
    expect(attributesIn('implementation')).toEqual(['averageScore', 'regulationStatus', 'policyLever', 'enforcementLevel']);
    expect(attributesIn('style')).toEqual(['governanceType', 'actorInvolvement']);
    expect(SCORE_OPTIONS.map(o => o.value)).toEqual([...ATTRIBUTE_KEYS]);
    expect(GROUPS.implementation.label).toBe('Implementation');
    expect(GROUPS.style.label).toBe('Governance style');
  });

  it('uses neutral endpoints that follow the v3 anchors', () => {
    expect(LEGEND_ENDPOINTS.averageScore).toEqual(['Little in force', 'Extensively in force']);
    expect(LEGEND_ENDPOINTS.regulationStatus).toEqual(['No binding AI rules', 'Binding cross-sector rules in force']);
    expect(LEGEND_ENDPOINTS.policyLever).toEqual(['Few instruments', 'Many instruments in use']);
    expect(LEGEND_ENDPOINTS.enforcementLevel).toEqual(['None observed', 'Routine, published enforcement']);
    expect(LEGEND_ENDPOINTS.governanceType).toEqual(['Centralised', 'Distributed']);
    expect(LEGEND_ENDPOINTS.actorInvolvement).toEqual(['Narrow', 'Broad']);
  });

  it('keeps every endpoint short enough for the legend at 360 px', () => {
    for (const key of ATTRIBUTE_KEYS) {
      expect(ATTRIBUTES[key].low.length + ATTRIBUTES[key].high.length, key).toBeLessThanOrEqual(56);
    }
  });
});

describe('the strings each surface shows', () => {
  it('tooltip: one extra phrase naming the lens', () => {
    expect(scoreLine('averageScore', 4.25)).toBe('Implementation Index: 4.25 / 5, how much is in force');
    expect(scoreLine('governanceType', 2, '2026-03-21')).toBe('Governance Type: 2 / 5 (2026-03-21), how, not how well');
  });

  it('legend: the question, then what the score does not claim', () => {
    expect(legendCaption('averageScore')).toEqual({
      question: 'How much AI governance is in force and operating?',
      notClaim: 'Higher means more in force, not better regulation.',
    });
    expect(legendCaption('actorInvolvement').notClaim).toMatch(/Neither end is better/);
  });

  it('live region: label, question, endpoints and the not-claim line', () => {
    expect(modeAnnouncement('enforcementLevel')).toBe(
      'Map now showing Enforcement Level. How much enforcement of AI rules is observed? '
      + 'Legend runs from None observed (1) to Routine, published enforcement (5). '
      + 'Measures enforcement activity, not whether it is fair or effective.'
    );
  });

  it('bloc card: the ends of the scale in the lens\'s words', () => {
    expect(blocExtremes('averageScore')).toEqual({ high: 'Most in force', low: 'Least in force' });
    expect(blocExtremes('governanceType')).toEqual({ high: 'Most distributed', low: 'Most centralised' });
  });

  it('panel captions', () => {
    expect(groupCaption('implementation')).toBe('Implementation: how much is in force, not how good it is');
    expect(groupCaption('style')).toBe('Governance style: how, not how well');
  });
});

describe('levelMeaning', () => {
  it('reads the v3 ladder on implementation sub-indicators', () => {
    expect(levelMeaning('implementation', 'binding_force', 5)).toBe('In place and operating');
    expect(levelMeaning('implementation', 'scope', 4)).toBe('In place, one element incomplete or not yet exercised');
    expect(levelMeaning('implementation', 'scope', 3)).toBe('Exists in part');
    expect(levelMeaning('implementation', 'scope', 2)).toBe('Non-binding or preparatory only');
    expect(levelMeaning('implementation', 'scope', 1)).toBe('No observable activity');
  });

  it('reads the descriptive anchors on governance style sub-indicators', () => {
    expect(levelMeaning('style', 'regulator_plurality', 1)).toBe('A single authority sets and enforces policy');
    expect(levelMeaning('style', 'regulator_plurality', 5)).toBe('Many independent regulators with their own remits');
    expect(levelMeaning('style', 'civil_society', 4)).toBe(
      'Between "consulted occasionally" and "standing formal roles for NGOs and unions"'
    );
  });

  it('has anchors for every governance style sub-indicator', () => {
    for (const snake of ['governance_type', 'actor_involvement']) {
      for (const [key] of SUBSCORE_LABELS[snake]) expect(STYLE_ANCHORS[key], key).toHaveLength(3);
    }
  });

  it('is null out of range or for an unknown descriptive sub-indicator', () => {
    expect(levelMeaning('implementation', 'scope', 0)).toBeNull();
    expect(levelMeaning('style', 'nope', 3)).toBeNull();
  });
});

describe('noGovernanceActivity (#96, display only)', () => {
  it('is true only when every implementation dimension is 1', () => {
    expect(noGovernanceActivity({ regulationStatus: 1, policyLever: 1, enforcementLevel: 1 })).toBe(true);
    expect(noGovernanceActivity({ regulationStatus: 1, policyLever: 1.25, enforcementLevel: 1 })).toBe(false);
    expect(noGovernanceActivity({ regulationStatus: null, policyLever: 1, enforcementLevel: 1 })).toBe(false);
    expect(noGovernanceActivity(null)).toBe(false);
  });
});

describe('API docs vocabulary', () => {
  it('describes score columns in the shared words and leaves others alone', () => {
    expect(apiColumnDescription('avg_score')).toMatch(/^Implementation Index \(implementation\), 1 to 5\./);
    expect(apiColumnDescription('avg_score')).toMatch(/not better regulation/);
    expect(apiColumnDescription('governance_type')).toMatch(/1 = Centralised, 5 = Distributed\. Neither end is better/);
    expect(apiColumnDescription('country')).toBeNull();
    expect(apiSummaryText('five dimensions plus the maturity composite, methodology'))
      .toBe('five dimensions plus the implementation index, methodology');
  });
});

describe('JSON export meta', () => {
  it('describes each score column, keyed by the unchanged column names', () => {
    const meta = buildExportMeta('2026-09-28');
    expect(meta.exported).toBe('2026-09-28');
    expect(Object.keys(meta.fields)).toEqual([
      'Average Score', 'Regulation Status (Score)', 'Policy Lever (Score)',
      'Enforcement Level (Score)', 'Governance Type (Score)', 'Actor Involvement (Score)',
    ]);
    expect(meta.fields['Average Score']).toEqual({
      label: 'Implementation Index',
      group: 'Implementation',
      question: 'How much AI governance is in force and operating?',
      scale: { min: 1, max: 5, low: 'Little in force', high: 'Extensively in force' },
      notClaim: 'Higher means more in force, not better regulation.',
    });
    expect(meta.fields['Governance Type (Score)'].group).toBe('Governance style');
  });
});

describe('peer chips', () => {
  it('describe bloc peers as closest in implementation index, never highest', () => {
    const row = (country, avg) => ({ country, averageScore: avg, regulationStatus: avg, policyLever: avg, enforcementLevel: avg, governanceType: 3, actorInvolvement: 3 });
    const scoreData = { A: row('A', 3), B: row('B', 5), C: row('C', 3.25) };
    const sets = peerSets('A', scoreData, { X: { name: 'Bloc X', members: ['A', 'B', 'C'] } }, 3);
    expect(sets[0].criterion).toBe('Other Bloc X members closest in implementation index');
    expect(sets[0].members).toEqual(['C', 'B']);
    expect(sets.map(s => s.label)).toContain('Similar implementation');
  });
});
