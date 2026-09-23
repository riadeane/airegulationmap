import { describe, it, expect } from 'vitest';
import { citationsFor } from '../src/controls/citation';

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

// With an archived release (public/data/release.json) every style names
// the version tag and, once minted, the DOI, so a footnote points at a
// retrievable snapshot rather than "the site".
const RELEASE = {
  tag: 'data-2026-W23',
  date: '2026-06-08',
  doi: '10.5281/zenodo.1234567',
  conceptDoi: '10.5281/zenodo.1234566',
  sandbox: false,
};

describe('citationsFor with an archived release', () => {
  it('names the version tag and the DOI in all three styles', () => {
    const { apa, chicago, mla } = citationsFor({ ...base, country: 'Germany', release: RELEASE });
    expect(apa).toBe(
      'Deane, R. (2026). AI Regulation Map: Germany (Version data-2026-W23) [Data visualization]. https://doi.org/10.5281/zenodo.1234567. Retrieved 2026-06-11, from https://airegulationmap.org/?country=Germany'
    );
    expect(chicago).toBe(
      'Deane, Ria. 2026. "AI Regulation Map: Germany." Version data-2026-W23. https://doi.org/10.5281/zenodo.1234567. Accessed 11 June 2026. https://airegulationmap.org/?country=Germany.'
    );
    expect(mla).toBe(
      'Deane, Ria. "AI Regulation Map: Germany." AI Regulation Map, version data-2026-W23, 2026, https://doi.org/10.5281/zenodo.1234567. Accessed 11 June 2026. https://airegulationmap.org/?country=Germany.'
    );
  });

  it('keeps the version but no DOI while minting is pending', () => {
    const pending = { ...RELEASE, doi: null };
    const { apa, chicago, mla } = citationsFor({ ...base, country: 'Germany', release: pending });
    for (const text of [apa, chicago, mla]) {
      expect(text).toContain('data-2026-W23');
      expect(text).not.toContain('doi.org');
    }
    expect(apa).toBe(
      'Deane, R. (2026). AI Regulation Map: Germany (Version data-2026-W23) [Data visualization]. Retrieved 2026-06-11, from https://airegulationmap.org/?country=Germany'
    );
    expect(mla).toBe(
      'Deane, Ria. "AI Regulation Map: Germany." AI Regulation Map, version data-2026-W23, 2026, https://airegulationmap.org/?country=Germany. Accessed 11 June 2026.'
    );
  });

  it('never quotes a sandbox DOI', () => {
    const { apa, chicago, mla } = citationsFor({ ...base, country: 'Germany', release: { ...RELEASE, sandbox: true } });
    for (const text of [apa, chicago, mla]) {
      expect(text).toContain('data-2026-W23');
      expect(text).not.toContain('10.5281');
    }
  });

  it('dates the citation by the release when there is no timeline date', () => {
    const late = { ...base, accessed: '2027-01-03' };
    const yearEnd = { ...RELEASE, tag: 'data-2026-W53', date: '2026-12-28' };
    const { apa, chicago } = citationsFor({ ...late, country: 'Germany', release: yearEnd });
    expect(apa).toContain('Deane, R. (2026).');
    expect(apa).toContain('Retrieved 2027-01-03');
    expect(chicago).toContain('Deane, Ria. 2026.');
    // A historical view is still dated by the timeline.
    const { apa: historical } = citationsFor({ ...late, country: 'Germany', timelineDate: '2024-05-01', release: yearEnd });
    expect(historical).toContain('Deane, R. (2024).');
  });

  it('carries the version into comparison and dimension views', () => {
    const { apa } = citationsFor({ ...base, compareCountries: ['France', 'Japan'], mode: 'enforcementLevel', release: RELEASE });
    expect(apa).toContain('AI Regulation Map: France, Japan comparison (Enforcement Level) (Version data-2026-W23)');
  });

  it('falls back to the plain format without a release', () => {
    const plain = citationsFor({ ...base, country: 'Germany' });
    expect(citationsFor({ ...base, country: 'Germany', release: null })).toEqual(plain);
    expect(plain.apa).not.toContain('Version');
    expect(plain.apa).not.toContain('doi.org');
  });
});
