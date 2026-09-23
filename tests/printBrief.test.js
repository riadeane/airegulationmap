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
  const base = 'https://airegulationmap.org/';

  it('links to the country alone', () => {
    expect(briefPermalink(base, 'Germany', null)).toBe('https://airegulationmap.org/?country=Germany');
  });

  it('encodes multi-word names the way the app parses them back', () => {
    expect(briefPermalink(base, 'United States of America', null))
      .toBe('https://airegulationmap.org/?country=United+States+of+America');
  });

  it('keeps the timeline date so a historical brief reproduces', () => {
    expect(briefPermalink(base, 'Germany', '2026-06-01'))
      .toBe('https://airegulationmap.org/?country=Germany&date=2026-06-01');
  });
});
