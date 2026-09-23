import { describe, it, expect } from 'vitest';
import { normalizeSubscores } from '../src/data/subscores';
import { withSubindicators } from '../src/controls/export';

// subscores.json mixes two entry shapes: v2 (bare integers) and v2.1
// ({ score, rationale }). The loader must accept both and hand the panel
// one normalized shape.

const V2_ENTRY = {
  date: '2026-06-13',
  regulation_status: { binding_force: 4, scope: 3, implementation: 4, ai_specificity: 5 },
};

const V21_ENTRY = {
  date: '2026-09-01',
  regulation_status: {
    binding_force: { score: 5, rationale: 'AI Act (Regulation 2024/1689) in force since 1 August 2024.' },
    scope: { score: 4, rationale: '  Horizontal coverage across sectors.  ' },
  },
  enforcement_level: {
    actions_taken: { score: 2, rationale: '' },
  },
};

describe('normalizeSubscores', () => {
  it('accepts v2 entries and reports no rationale', () => {
    const data = normalizeSubscores({ schema_version: 1, countries: { Testland: V2_ENTRY } });
    expect(data.methodology).toBeUndefined();
    expect(data.countries.Testland.date).toBe('2026-06-13');
    expect(data.countries.Testland.regulation_status.binding_force).toEqual({ score: 4, rationale: null });
    expect(data.countries.Testland.regulation_status.ai_specificity).toEqual({ score: 5, rationale: null });
  });

  it('accepts v2.1 entries and keeps the trimmed rationale', () => {
    const data = normalizeSubscores({ schema_version: 1, methodology: 'v2.1', countries: { Newland: V21_ENTRY } });
    expect(data.methodology).toBe('v2.1');
    const block = data.countries.Newland.regulation_status;
    expect(block.binding_force).toEqual({
      score: 5,
      rationale: 'AI Act (Regulation 2024/1689) in force since 1 August 2024.',
    });
    expect(block.scope.rationale).toBe('Horizontal coverage across sectors.');
    // An empty rationale is the same as no rationale.
    expect(data.countries.Newland.enforcement_level.actions_taken).toEqual({ score: 2, rationale: null });
  });

  it('handles both shapes in one file', () => {
    const data = normalizeSubscores({ schema_version: 1, countries: { Testland: V2_ENTRY, Newland: V21_ENTRY } });
    expect(Object.keys(data.countries).sort()).toEqual(['Newland', 'Testland']);
  });

  it('nulls malformed cells and rejects a file without countries', () => {
    const data = normalizeSubscores({ schema_version: 1, countries: {
      Odd: { date: '2026-01-01', policy_lever: { soft_law: 'three', economic_tools: { rationale: 'no score' }, binding_instruments: null } },
    } });
    expect(data.countries.Odd.policy_lever).toEqual({ soft_law: null, economic_tools: null, binding_instruments: null });
    expect(normalizeSubscores({ schema_version: 1 })).toBeNull();
    expect(normalizeSubscores(null)).toBeNull();
  });
});

describe('withSubindicators', () => {
  it('attaches the audit trail only for countries that have one', () => {
    const rows = [{ Country: 'Testland', 'Average Score': 4 }, { Country: 'Nowhere', 'Average Score': 1 }];
    const subscores = normalizeSubscores({ schema_version: 1, countries: { Testland: V21_ENTRY } }).countries;
    const out = withSubindicators(rows, subscores);
    expect(out[0]['Sub-indicators'].regulation_status.binding_force.score).toBe(5);
    expect(out[1]['Sub-indicators']).toBeUndefined();
    // The plain rows are untouched, so the CSV path is unaffected.
    expect(rows[0]['Sub-indicators']).toBeUndefined();
  });

  it('is a no-op when subscores.json never loaded', () => {
    const rows = [{ Country: 'Testland' }];
    expect(withSubindicators(rows, undefined)).toEqual(rows);
  });
});
