import { describe, it, expect } from 'vitest';
import { canPrintBrief, briefPermalink } from '../src/controls/printBrief';

describe('canPrintBrief', () => {
  it('needs a selected country', () => {
    expect(canPrintBrief({ selectedCountry: null, mainView: 'map' })).toBe(false);
    expect(canPrintBrief({ selectedCountry: 'Germany', mainView: 'map' })).toBe(true);
  });

  it('stays on while the scatter explorer shows the panel beside it', () => {
    expect(canPrintBrief({ selectedCountry: 'Germany', mainView: 'scatter' })).toBe(true);
  });

  it('is off in the full comparison view, which hides the panel', () => {
    expect(canPrintBrief({ selectedCountry: 'Germany', mainView: 'comparison' })).toBe(false);
  });
});

describe('briefPermalink', () => {
  const origin = 'https://airegulationmap.org';

  it('links to the static country page', () => {
    expect(briefPermalink(origin, '/', 'Germany', null)).toBe('https://airegulationmap.org/country/germany/');
  });

  it('slugs multi-word and accented names the way the build step does', () => {
    expect(briefPermalink(origin, '/', 'United States of America', null))
      .toBe('https://airegulationmap.org/country/united-states-of-america/');
    expect(briefPermalink(origin, '/', "Côte d'Ivoire", null))
      .toBe('https://airegulationmap.org/country/cote-divoire/');
  });

  it('links a historical vintage to the app view with its date', () => {
    expect(briefPermalink(origin, '/', 'Germany', '2026-06-01'))
      .toBe('https://airegulationmap.org/?country=Germany&date=2026-06-01');
  });
});
