import { describe, it, expect } from 'vitest';
import { mapExportRow, isStrictlyNewer } from '../src/data/hydrate';
import { restGet, isConfigured } from '../src/data/supabase';

// The hydration path must produce EXACTLY the shapes the CSV loader
// produces, through the same score-validation boundary.

const ROW = {
  country: 'Testland',
  regulation_status: '4.25',   // PostgREST numerics can arrive as strings
  policy_lever: 3.5,
  governance_type: 2.75,
  actor_involvement: 3,
  enforcement_level: 3.5,
  avg_score: 3.75,
  confidence: 'high',
  data_version: 3,
  scored_at: '2026-06-13',
  regulation_status_text: 'Binding law.',
  policy_lever_text: 'Strategy.',
  governance_type_text: 'Central.',
  actor_involvement_text: 'Broad.',
  enforcement_level_text: 'Active.',
  specific_laws: 'AI Act (2024)',
  sources_raw: 'https://a.gov/x | https://b.com/y',
  summarized_at: '2026-06-13',
};

describe('mapExportRow', () => {
  it('produces loader-identical ScoreEntry and RegulationEntry shapes', () => {
    const { score, reg } = mapExportRow(ROW);
    expect(score).toEqual({
      country: 'Testland',
      regulationStatus: 4.25,
      policyLever: 3.5,
      governanceType: 2.75,
      actorInvolvement: 3,
      averageScore: 3.75,
      enforcementLevel: 3.5,
      lastUpdated: '2026-06-13',
      dataVersion: 3,
    });
    expect(reg).toEqual({
      country: 'Testland',
      regulationStatus: 'Binding law.',
      policyLever: 'Strategy.',
      governanceType: 'Central.',
      actorInvolvement: 'Broad.',
      enforcementLevel: 'Active.',
      specificLaws: 'AI Act (2024)',
      sources: 'https://a.gov/x | https://b.com/y',
      lastUpdated: '2026-06-13',
      confidence: 'high',
    });
  });

  it('nulls out-of-range scores through the shared boundary', () => {
    const { score } = mapExportRow({ ...ROW, regulation_status: 9, policy_lever: 'junk' });
    expect(score.regulationStatus).toBeNull();
    expect(score.policyLever).toBeNull();
  });

  it('rejects rows without a country', () => {
    expect(mapExportRow({ ...ROW, country: '' })).toBeNull();
  });
});

describe('isStrictlyNewer', () => {
  const data = (name, lastUpdated) => ({ [name]: { country: name, lastUpdated } });

  it('true only when the candidate max date is strictly greater', () => {
    expect(isStrictlyNewer(data('A', '2026-07-01'), data('A', '2026-06-01'))).toBe(true);
    expect(isStrictlyNewer(data('A', '2026-06-01'), data('A', '2026-06-01'))).toBe(false);
    expect(isStrictlyNewer(data('A', '2026-05-01'), data('A', '2026-06-01'))).toBe(false);
  });

  it('a candidate without dates never wins', () => {
    expect(isStrictlyNewer(data('A', null), data('A', '2026-06-01'))).toBe(false);
    expect(isStrictlyNewer(data('A', null), data('A', null))).toBe(false);
  });
});

describe('restGet (unconfigured)', () => {
  it('is a null no-op without env vars — no fetch attempted', async () => {
    expect(isConfigured()).toBe(false);
    expect(await restGet('public_export?select=country')).toBeNull();
  });
});
