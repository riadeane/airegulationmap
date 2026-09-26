import { describe, it, expect, afterEach, vi } from 'vitest';
import process from 'node:process';
import { citationsFor, citationViewOf } from '../src/controls/citation';
import { formatSourcesForCopy } from '../src/data/sources';
import { localIsoDate } from '../src/data/localDate';

const base = { url: 'https://airegulationmap.org/?country=Germany', accessed: '2026-06-11' };

describe('citationsFor', () => {
  it('cites a single-country view in all three styles', () => {
    const { apa, chicago, mla } = citationsFor({ ...base, country: 'Germany', mode: 'averageScore' });
    expect(apa).toBe(
      'Deane, R. (2026). AI Regulation Map: Germany [Data visualization]. Retrieved 2026-06-11, from https://airegulationmap.org/?country=Germany'
    );
    expect(chicago).toContain('Deane, Ria. 2026. "AI Regulation Map: Germany."');
    expect(chicago).toContain('Accessed 11 June 2026');
    expect(mla).toContain('"AI Regulation Map: Germany." AI Regulation Map, 2026');
  });

  it('titles a comparison view with the country list', () => {
    const { apa } = citationsFor({ ...base, compareCountries: ['France', 'Japan'] });
    expect(apa).toContain('AI Regulation Map: France, Japan comparison');
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

// Regression: the Cite and Share popovers titled the citation with the
// staged comparison set whenever it had two countries, while the permalink
// only carries `compare` when the comparison view is open.
describe('citationViewOf', () => {
  const state = {
    selectedCountry: 'Germany',
    comparisonCountries: ['France', 'Japan'],
    currentAttribute: 'averageScore',
    timelineDate: null,
  };
  const url = 'https://airegulationmap.org/?country=Germany';

  it('cites the selected country while a comparison is only staged', () => {
    const { apa } = citationsFor({ ...citationViewOf({ ...state, mainView: 'map' }, url), accessed: '2026-06-11' });
    expect(apa).toContain('AI Regulation Map: Germany [Data visualization]');
    expect(apa).not.toContain('comparison');
  });

  it('cites the comparison while its view is open', () => {
    const { apa } = citationsFor({ ...citationViewOf({ ...state, mainView: 'comparison' }, url), accessed: '2026-06-11' });
    expect(apa).toContain('AI Regulation Map: France, Japan comparison');
  });
});

// Regression: "accessed" dates used the UTC day, which near midnight is a
// day off for most readers.
describe('accessed dates use the local calendar day', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
  });

  it('is the local day, not the UTC day', () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.useFakeTimers();
    // 13:30 UTC on 25 September is 01:30 on 26 September in Auckland.
    vi.setSystemTime(new Date('2026-09-25T13:30:00Z'));
    expect(localIsoDate()).toBe('2026-09-26');
    const { apa } = citationsFor({ country: 'Germany', url: 'https://airegulationmap.org/' });
    expect(apa).toContain('Retrieved 2026-09-26');
    expect(formatSourcesForCopy([], 'Germany')).toContain('accessed 2026-09-26');
  });
});

