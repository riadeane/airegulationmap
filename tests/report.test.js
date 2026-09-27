import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildReportBody, buildReportUrl, reportTitle,
  ISSUE_NEW_URL, ISSUE_TEMPLATE, ISSUE_LABEL, MAX_BODY_LENGTH, MAX_ENCODED_ENTRY_LENGTH,
} from '../src/controls/report';
import { normalizeSubscores } from '../src/data/subscores';

// The "Report an issue" body is built from the data the panel shows. These
// cover its content, the length cap, and the order in which it sheds
// detail when a wordy entry would push the GitHub URL past the cap.

const URL_CHILE = 'https://airegulationmap.org/?country=Chile';
const ACCESSED = '2026-09-23';

const SCORE = {
  country: 'Chile',
  regulationStatus: 3,
  policyLever: 2.25,
  governanceType: 2.25,
  actorInvolvement: 3.5,
  averageScore: 2.42,
  enforcementLevel: 2,
  lastUpdated: '2026-06-13',
  dataVersion: 2,
};

const SOURCES = [
  'https://cms.law/en/int/expert-guides/ai-regulation-scanner/chile',
  'https://www.bcn.cl/leychile/navegar?idNorma=1202434',
  'https://oecd.ai/en/dashboards/policy-initiatives/santiago-declaration-1416',
];

const REGULATION = {
  country: 'Chile',
  regulationStatus: 'Bill under Senate review.',
  policyLever: null,
  governanceType: null,
  actorInvolvement: null,
  enforcementLevel: null,
  specificLaws: 'Law 21.663',
  // Duplicate and placeholder cells are dropped, as in the panel's list.
  sources: [...SOURCES, SOURCES[0], 'n/a'].join(' | '),
  lastUpdated: '2026-06-12',
  confidence: 'medium',
};

const V2_SUBSCORES = normalizeSubscores({
  schema_version: 1,
  countries: {
    Chile: {
      date: '2026-06-13',
      regulation_status: { binding_force: 3, scope: 3, implementation: 2, ai_specificity: 4 },
    },
  },
}).countries.Chile;

const V21_SUBSCORES = normalizeSubscores({
  schema_version: 1,
  methodology: 'v2.1',
  countries: {
    Chile: {
      date: '2026-09-01',
      regulation_status: {
        binding_force: { score: 3, rationale: 'Law 21.663 binds | the AI bill does not yet.' },
        scope: { score: 3, rationale: 'Sectoral coverage only.' },
      },
      enforcement_level: {
        actions_taken: { score: 2, rationale: '' },
      },
    },
  },
}).countries.Chile;

const base = {
  country: 'Chile',
  score: SCORE,
  regulation: REGULATION,
  subscores: V2_SUBSCORES,
  url: URL_CHILE,
  accessed: ACCESSED,
};

function longSources(count, length = 100) {
  return Array.from({ length: count }, (_, i) =>
    `https://example.org/${String(i).padStart(3, '0')}/${'x'.repeat(length)}`
  );
}

function longRationales(length) {
  const cell = (n) => ({ score: 3, rationale: `R${n} ${'r'.repeat(length)}` });
  return normalizeSubscores({
    schema_version: 1,
    methodology: 'v2.1',
    countries: {
      Chile: {
        date: '2026-09-01',
        regulation_status: { binding_force: cell(1), scope: cell(2), implementation: cell(3), ai_specificity: cell(4) },
        policy_lever: { binding_instruments: cell(5), soft_law: cell(6), economic_tools: cell(7), institutional_capacity: cell(8) },
        governance_type: { regulator_plurality: cell(9), formal_coordination: cell(10), subnational_role: cell(11), nongovernmental_checks: cell(12) },
        actor_involvement: { industry: cell(13), civil_society: cell(14), academia: cell(15), international: cell(16) },
        enforcement_level: { sanctions_framework: cell(17), actions_taken: cell(18), dedicated_authority: cell(19), monitoring_practice: cell(20) },
      },
    },
  }).countries.Chile;
}

describe('reportTitle', () => {
  it('names the country', () => {
    expect(reportTitle('Chile')).toBe('Data: Chile');
  });
});

describe('buildReportBody', () => {
  it('carries the entry as the panel shows it', () => {
    const body = buildReportBody(base);
    expect(body).toContain('**Country:** Chile');
    expect(body).toContain('**Confidence:** Medium');
    // The scores row's date wins, as in the panel's "Data as of" line.
    expect(body).toContain('**Last updated:** 2026-06-13');
    expect(body).toContain('**Data version:** 2');
    expect(body).toContain(`**App URL:** ${URL_CHILE}`);
    expect(body).toContain(
      '**Cite as:** Deane, R. (2026). AI Regulation Map: Chile [Data visualization]. '
      + `Retrieved ${ACCESSED}, from ${URL_CHILE}`
    );
  });

  it('lists the six scores in the panel\'s order and number format', () => {
    const body = buildReportBody(base);
    const rows = body.split('\n').filter(line => /^\| [A-Z]/.test(line) && !line.startsWith('| Dimension'));
    expect(rows).toEqual([
      '| Maturity Index | 2.42 |',
      '| Regulation Status | 3 |',
      '| Policy Lever | 2.25 |',
      '| Governance Type | 2.25 |',
      '| Actor Involvement | 3.50 |',
      '| Enforcement Level | 2 |',
    ]);
  });

  it('numbers the de-duplicated source list with its count', () => {
    const body = buildReportBody(base);
    expect(body).toContain('**Sources (3):**');
    expect(body).toContain(`1. ${SOURCES[0]}`);
    expect(body).toContain(`3. ${SOURCES[2]}`);
    expect(body).not.toContain('4. ');
    expect(body).not.toContain('more not listed');
  });

  it('states the evidence coverage line only when the country has a run record', () => {
    expect(buildReportBody(base)).not.toContain('**Evidence:**');
    const withRecord = normalizeSubscores({
      schema_version: 1,
      countries: {
        Chile: {
          date: '2026-09-01',
          evidence: { grounded: true, initiatives_used: 7, search: true, model: 'claude-opus-5-5', run_id: 'r1' },
        },
      },
    }).countries.Chile;
    const body = buildReportBody({ ...base, subscores: withRecord });
    expect(body).toContain(
      '**Confidence:** Medium\n**Evidence:** Grounded in 7 verified policy initiatives and web search\n'
    );
  });

  it('degrades when the entry has no text row or no scores row', () => {
    const body = buildReportBody({ ...base, score: null, regulation: null });
    expect(body).toContain('**Confidence:** Not stated');
    expect(body).toContain('**Last updated:** unknown');
    expect(body).toContain('**Data version:** unknown');
    expect(body).toContain('| Maturity Index | N/A |');
    expect(body).toContain('**Sources:** none on the entry');
  });

  it('cites the timeline vintage when the view is historical', () => {
    const body = buildReportBody({ ...base, timelineDate: '2025-03-01' });
    expect(body).toContain('Deane, R. (2025).');
  });

  it('leaves the sub-indicator block out while the audit trail has no rationales', () => {
    expect(buildReportBody(base)).not.toContain('<details>');
    expect(buildReportBody({ ...base, subscores: null })).not.toContain('<details>');
  });

  it('adds the sub-indicator rows in a collapsed block once rationales exist', () => {
    const body = buildReportBody({ ...base, subscores: V21_SUBSCORES });
    expect(body).toContain('<details>\n<summary>Sub-indicators (assessed 2026-09-01)</summary>');
    expect(body).toContain('| Dimension | Sub-indicator | Score | Rationale |');
    // A pipe inside a rationale is escaped so it cannot split the row.
    expect(body).toContain('| Regulation Status | Binding force | 3 | Law 21.663 binds \\| the AI bill does not yet. |');
    expect(body).toContain('| Regulation Status | Scope | 3 | Sectoral coverage only. |');
    // A v2.1 cell with an empty rationale still shows its score.
    expect(body).toContain('| Enforcement Level | Actions taken | 2 |  |');
    expect(body.trimEnd().endsWith('</details>')).toBe(true);
  });

  it('keeps the whole body under the cap by truncating the source list with a count', () => {
    const sources = longSources(80);
    const body = buildReportBody({ ...base, regulation: { ...REGULATION, sources: sources.join('|') } });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(body).toContain('**Sources (80):**');
    const listed = body.split('\n').filter(line => /^\d+\. https:/.test(line)).length;
    expect(listed).toBeGreaterThanOrEqual(3);
    expect(listed).toBeLessThan(80);
    expect(body).toContain(`_${80 - listed} more not listed here to keep this issue short; the panel shows all 80._`);
    // The listed prefix is the start of the panel's list, in order.
    expect(body).toContain(`1. ${sources[0]}`);
    expect(body).toContain(`${listed}. ${sources[listed - 1]}`);
  });

  it('sheds unlisted sources before it touches the rationales', () => {
    const sources = longSources(30);
    const body = buildReportBody({
      ...base,
      regulation: { ...REGULATION, sources: sources.join('|') },
      subscores: longRationales(100),
    });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(body).toContain('| Rationale |');
    expect(body).toContain('R20 ' + 'r'.repeat(100));
    expect(body).toContain('more not listed here');
  });

  it('drops the rationales, keeping scores and a source floor, when they alone break the cap', () => {
    const sources = longSources(30);
    const body = buildReportBody({
      ...base,
      regulation: { ...REGULATION, sources: sources.join('|') },
      subscores: longRationales(200),
    });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(body).toContain('<details>');
    expect(body).not.toContain('| Rationale |');
    expect(body).not.toContain('rrrrrrrrrr');
    expect(body).toContain('| Enforcement Level | Monitoring practice | 3 |');
    expect(body).toContain('_Rationales left out to keep this issue short; the panel shows them._');
    const listed = body.split('\n').filter(line => /^\d+\. https:/.test(line)).length;
    expect(listed).toBeGreaterThanOrEqual(3);
  });

  it('never exceeds the cap even for an absurd entry', () => {
    const body = buildReportBody({
      ...base,
      regulation: { ...REGULATION, sources: longSources(60, 400).join('|') },
      subscores: longRationales(200),
    });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(body).toContain('**Country:** Chile');
  });

  it('also caps the encoded length, which punctuation and diacritics inflate', () => {
    // Rationales that are all pipes and accents encode to three characters each,
    // so a body well under the character cap would still overflow the URL.
    const cell = (n) => ({ score: 3, rationale: `R${n} ${'|é'.repeat(60)}` });
    const subscores = normalizeSubscores({
      schema_version: 1,
      methodology: 'v2.1',
      countries: {
        Chile: {
          date: '2026-09-01',
          regulation_status: { binding_force: cell(1), scope: cell(2), implementation: cell(3), ai_specificity: cell(4) },
          policy_lever: { binding_instruments: cell(5), soft_law: cell(6), economic_tools: cell(7), institutional_capacity: cell(8) },
          governance_type: { regulator_plurality: cell(9), formal_coordination: cell(10), subnational_role: cell(11), nongovernmental_checks: cell(12) },
          actor_involvement: { industry: cell(13), civil_society: cell(14), academia: cell(15), international: cell(16) },
          enforcement_level: { sanctions_framework: cell(17), actions_taken: cell(18), dedicated_authority: cell(19), monitoring_practice: cell(20) },
        },
      },
    }).countries.Chile;
    const entry = { ...base, subscores };
    const body = buildReportBody(entry);
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(new URLSearchParams({ entry: body }).toString().length - 'entry='.length)
      .toBeLessThanOrEqual(MAX_ENCODED_ENTRY_LENGTH);
    expect(buildReportUrl(entry).length).toBeLessThan(8000);
    // The scores survive; only the rationales went.
    expect(body).toContain('| Regulation Status | Binding force | 3 |');
    expect(body).not.toContain('| Rationale |');
  });
});

describe('buildReportUrl', () => {
  it('targets the new-issue page with the form template, title, label and field values', () => {
    const url = new URL(buildReportUrl(base));
    expect(url.origin + url.pathname).toBe(ISSUE_NEW_URL);
    expect(url.searchParams.get('template')).toBe(ISSUE_TEMPLATE);
    expect(url.searchParams.get('labels')).toBe(ISSUE_LABEL);
    expect(url.searchParams.get('title')).toBe('Data: Chile');
    expect(url.searchParams.get('country')).toBe('Chile');
    expect(url.searchParams.get('entry')).toBe(buildReportBody(base));
    // An issue form ignores `body`; the entry rides in its own field.
    expect(url.searchParams.has('body')).toBe(false);
  });

  it('round-trips names with spaces and diacritics', () => {
    const url = new URL(buildReportUrl({ ...base, country: "Côte d'Ivoire" }));
    expect(url.searchParams.get('title')).toBe("Data: Côte d'Ivoire");
    expect(url.searchParams.get('country')).toBe("Côte d'Ivoire");
  });
});

describe('the issue form template', () => {
  // The URL builder addresses the form by file name and field ids; a
  // rename on either side would silently stop the prefill.
  const template = readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${ISSUE_TEMPLATE}`, import.meta.url), 'utf8');

  it('declares the fields the URL builder fills and the data label', () => {
    expect(template).toContain('id: country');
    expect(template).toContain('id: entry');
    expect(template).toContain('id: what-is-wrong');
    expect(template).toContain('id: evidence');
    expect(template).toContain('type: checkboxes');
    expect(template).toContain('methodology');
    expect(template).toContain(`labels: ["${ISSUE_LABEL}"]`);
  });
});

// Regression: on a past timeline date the report sent the latest scores
// while the panel showed that date's snapshot.
describe('buildReportBody on a past timeline date', () => {
  const snapshot = {
    date: '2026-03-21',
    regulationStatus: 2,
    policyLever: 1.75,
    governanceType: 2,
    actorInvolvement: 3,
    enforcementLevel: 1.5,
    averageScore: 1.75,
  };

  it('lists the vintage scores and states the vintage', () => {
    const body = buildReportBody({
      ...base,
      timelineDate: '2026-03-21',
      vintage: { date: '2026-03-21', scores: snapshot },
    });
    expect(body).toContain('**Scores as of:** 2026-03-21');
    const rows = body.split('\n').filter(line => /^\| [A-Z]/.test(line) && !line.startsWith('| Dimension'));
    expect(rows).toEqual([
      '| Maturity Index | 1.75 |',
      '| Regulation Status | 2 |',
      '| Policy Lever | 1.75 |',
      '| Governance Type | 2 |',
      '| Actor Involvement | 3 |',
      '| Enforcement Level | 1.50 |',
    ]);
  });

  it('says N/A for a country the snapshot does not cover, never the latest', () => {
    const body = buildReportBody({ ...base, vintage: { date: '2026-03-21', scores: null } });
    expect(body).toContain('| Maturity Index | N/A |');
    expect(body).not.toContain('| Maturity Index | 2.42 |');
  });

  it('adds no vintage line at Latest', () => {
    expect(buildReportBody(base)).not.toContain('Scores as of');
  });
});

