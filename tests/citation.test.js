import { describe, it, expect } from 'vitest';
import { citationsFor } from '../src/controls/citation.js';

const base = { url: 'https://airegulationmap.org/?country=Germany', accessed: '2026-06-11' };

describe('citationsFor', () => {
  it('cites a single-country view in all three styles', () => {
    const { apa, chicago, mla } = citationsFor({ ...base, country: 'Germany', mode: 'averageScore' });
    expect(apa).toBe(
      'Deane, R. (2026). AI Regulation Map — Germany [Data visualization]. Retrieved 2026-06-11, from https://airegulationmap.org/?country=Germany'
    );
    expect(chicago).toContain('Deane, Ria. 2026. "AI Regulation Map — Germany."');
    expect(chicago).toContain('Accessed 11 June 2026');
    expect(mla).toContain('"AI Regulation Map — Germany." AI Regulation Map, 2026');
  });

  it('titles a comparison view with the country list', () => {
    const { apa } = citationsFor({ ...base, compareCountries: ['France', 'Japan'] });
    expect(apa).toContain('AI Regulation Map — France, Japan comparison');
  });

  it('appends the dimension label for non-default score modes', () => {
    const { apa } = citationsFor({ ...base, country: 'Brazil', mode: 'enforcementLevel' });
    expect(apa).toContain('Brazil (Enforcement Level)');
  });

  it('uses the timeline date year when a historical view is cited', () => {
    const { apa, chicago } = citationsFor({ ...base, country: 'Germany', timelineDate: '2024-05-01' });
    expect(apa).toContain('(2024)');
    expect(chicago).toContain('Deane, Ria. 2024.');
    // Accessed date stays the real access date.
    expect(apa).toContain('Retrieved 2026-06-11');
  });

  it('omits the mode suffix for the default attribute', () => {
    const { apa } = citationsFor({ ...base, country: 'Germany', mode: 'averageScore' });
    expect(apa).not.toContain('(Average Score)');
  });
});
