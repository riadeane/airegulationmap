import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hydration replaces the entries with a newer research pass; the evidence
// sentence, the Evidence facet and the bloc share must then describe that
// pass, not the one behind the static subscores.json (#70).

const rows = { probe: [], full: [] };
vi.mock('../src/data/supabase', () => ({
  isConfigured: () => true,
  restGet: async path => (path.includes('limit=1&') || path.endsWith('limit=1') ? rows.probe : rows.full),
}));

const { hydrateFromSupabase, withHydratedEvidence, evidenceFromRow, resetHydratedEvidence } =
  await import('../src/data/hydrate');
const { setState, getState } = await import('../src/state/store');
const { evidenceOf } = await import('../src/state/selectors');

function exportRow(country, scoredAt, evidence = {}) {
  return {
    country,
    regulation_status: 3, policy_lever: 3, governance_type: 3, actor_involvement: 3,
    enforcement_level: 3, avg_score: 3, confidence: 'medium', data_version: 2,
    scored_at: scoredAt,
    regulation_status_text: 'x', policy_lever_text: 'x', governance_type_text: 'x',
    actor_involvement_text: 'x', enforcement_level_text: 'x', specific_laws: null,
    sources_raw: null, summarized_at: scoredAt,
    grounded: null, initiatives_used: null, web_search: null,
    ...evidence,
  };
}

const STATIC_RECORD = {
  grounded: false, initiativesUsed: null, search: true, model: 'claude-opus-5', runId: 'run-static',
};

function staticState() {
  const entry = date => ({
    country: '', regulationStatus: 3, policyLever: 3, governanceType: 3, actorInvolvement: 3,
    averageScore: 3, enforcementLevel: 3, lastUpdated: date, dataVersion: 1,
  });
  return {
    scoreData: {
      Testland: { ...entry('2026-09-01'), country: 'Testland' },
      Sameland: { ...entry('2026-09-01'), country: 'Sameland' },
    },
    regulationData: {},
  };
}

function subscores() {
  return {
    schema_version: 2,
    countries: {
      Testland: { date: '2026-09-01', evidence: STATIC_RECORD },
      Sameland: { date: '2026-09-01', evidence: STATIC_RECORD },
    },
  };
}

beforeEach(() => {
  resetHydratedEvidence();
  setState({ ...staticState(), subscores: null });
});

describe('evidenceFromRow', () => {
  it('reads the three public_export columns into a record without model or run', () => {
    expect(evidenceFromRow(exportRow('A', '2026-09-28', {
      grounded: true, initiatives_used: 4, web_search: true,
    }))).toEqual({ grounded: true, initiativesUsed: 4, search: true, model: null, runId: null });
  });

  it('is null for a row with no run record', () => {
    expect(evidenceFromRow(exportRow('A', '2026-09-28'))).toBeNull();
  });
});

describe('hydrateFromSupabase and evidence', () => {
  it('replaces the evidence of a country hydrated with a newer pass', async () => {
    setState({ subscores: subscores() });
    rows.probe = [{ scored_at: '2026-09-28' }];
    rows.full = [
      exportRow('Testland', '2026-09-28', { grounded: true, initiatives_used: 4, web_search: true }),
      exportRow('Sameland', '2026-09-01', { grounded: false, initiatives_used: null, web_search: true }),
    ];
    expect(await hydrateFromSupabase()).toBe(true);
    expect(evidenceOf('Testland')).toEqual({
      grounded: true, initiativesUsed: 4, search: true, model: null, runId: null,
    });
    // Same research date: the static record (with its model and run) stays.
    expect(evidenceOf('Sameland')).toEqual(STATIC_RECORD);
  });

  it('overlays the records when subscores.json lands after hydration', async () => {
    rows.probe = [{ scored_at: '2026-09-28' }];
    rows.full = [exportRow('Testland', '2026-09-28', { grounded: true, initiatives_used: 2, web_search: false })];
    expect(await hydrateFromSupabase()).toBe(true);
    expect(getState().subscores).toBeNull();
    setState({ subscores: withHydratedEvidence(subscores()) });
    expect(evidenceOf('Testland')?.initiativesUsed).toBe(2);
    expect(evidenceOf('Testland')?.search).toBe(false);
  });

  it('drops the record when the newer row has none', async () => {
    setState({ subscores: subscores() });
    rows.probe = [{ scored_at: '2026-09-28' }];
    rows.full = [exportRow('Testland', '2026-09-28')];
    expect(await hydrateFromSupabase()).toBe(true);
    expect(evidenceOf('Testland')).toBeNull();
  });

  it('an older export changes nothing', async () => {
    const before = subscores();
    setState({ subscores: before });
    rows.probe = [{ scored_at: '2026-08-01' }];
    rows.full = [exportRow('Testland', '2026-08-01', { grounded: true, initiatives_used: 4, web_search: true })];
    expect(await hydrateFromSupabase()).toBe(false);
    expect(getState().subscores).toBe(before);
    expect(withHydratedEvidence(before)).toBe(before);
  });
});
