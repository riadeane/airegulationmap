import { describe, it, expect } from 'vitest';
import { parseUrl, buildQueryString } from '../src/controls/url';

// buildQueryString is the pure half of the permalink seam (no
// window/document), so both directions round-trip under node.

function appState(overrides = {}) {
  return {
    currentAttribute: 'averageScore',
    scoreData: {},
    regulationData: {},
    filterMin: 1,
    filterMax: 5,
    selectedCountry: null,
    sortedCountryNames: [],
    comparisonCountries: [],
    timelineDate: null,
    history: null,
    selectedBloc: null,
    blocsData: null,
    subscores: null,
    searchQuery: '',
    filterConfidence: null,
    filterOfficialOnly: false,
    mainView: 'map',
    scatterX: 'enforcementLevel',
    scatterY: 'regulationStatus',
    ...overrides,
  };
}

describe('parseUrl — score-range filter', () => {
  it('parses valid min/max bounds', () => {
    expect(parseUrl('?min=2&max=4.5')).toEqual({ filterMin: 2, filterMax: 4.5 });
  });

  it('snaps bounds to the sliders’ quarter-point steps', () => {
    expect(parseUrl('?min=2.3')).toEqual({ filterMin: 2.25 });
    expect(parseUrl('?max=3.9')).toEqual({ filterMax: 4 });
  });

  it('ignores out-of-range and non-numeric bounds', () => {
    expect(parseUrl('?min=0.5')).toEqual({});
    expect(parseUrl('?max=6')).toEqual({});
    expect(parseUrl('?min=abc&max=')).toEqual({});
  });

  it('drops an inverted pair entirely', () => {
    expect(parseUrl('?min=4&max=2')).toEqual({});
  });
});

describe('buildQueryString', () => {
  it('omits everything at defaults', () => {
    expect(buildQueryString(appState())).toBe('');
  });

  it('emits only the non-default filter bounds', () => {
    expect(buildQueryString(appState({ filterMin: 2 }))).toBe('min=2');
    expect(buildQueryString(appState({ filterMax: 4 }))).toBe('max=4');
    expect(buildQueryString(appState({ filterMin: 1.5, filterMax: 4.75 }))).toBe('min=1.5&max=4.75');
  });

  it('round-trips the filter range through parseUrl', () => {
    const qs = buildQueryString(appState({ filterMin: 2.25, filterMax: 3.75 }));
    expect(parseUrl('?' + qs)).toEqual({ filterMin: 2.25, filterMax: 3.75 });
  });

  it('keeps the existing view params working alongside the range', () => {
    const qs = buildQueryString(appState({
      selectedCountry: 'Germany',
      currentAttribute: 'enforcementLevel',
      selectedBloc: 'EU',
      timelineDate: '2026-03-01',
      filterMin: 3,
    }));
    const parsed = parseUrl('?' + qs);
    expect(parsed).toEqual({
      country: 'Germany',
      mode: 'enforcementLevel',
      bloc: 'EU',
      date: '2026-03-01',
      filterMin: 3,
    });
  });

  it('prefers a committed comparison over the selected country', () => {
    const qs = buildQueryString(appState({
      mainView: 'comparison',
      comparisonCountries: ['Germany', 'France'],
      selectedCountry: 'Japan',
    }));
    expect(qs).toBe('compare=Germany,France');
  });

  it('appends the theme only when supplied', () => {
    expect(buildQueryString(appState(), 'dark')).toBe('theme=dark');
    expect(buildQueryString(appState(), null)).toBe('');
  });

  it('round-trips a committed search query', () => {
    const qs = buildQueryString(appState({ searchQuery: 'facial recognition' }));
    expect(parseUrl('?' + qs)).toEqual({ q: 'facial recognition' });
  });

  it('caps an oversized q param instead of dropping it', () => {
    const long = 'x'.repeat(300);
    expect(parseUrl(`?q=${long}`).q).toHaveLength(100);
  });

  it('round-trips the confidence and official-only filters', () => {
    const qs = buildQueryString(appState({
      filterConfidence: ['high', 'medium'],
      filterOfficialOnly: true,
    }));
    expect(parseUrl('?' + qs)).toEqual({
      filterConfidence: ['high', 'medium'],
      filterOfficialOnly: true,
    });
  });

  it('normalizes an all-levels conf param to no filter and drops junk levels', () => {
    expect(parseUrl('?conf=high,medium,low')).toEqual({});
    expect(parseUrl('?conf=bogus')).toEqual({});
    expect(parseUrl('?conf=HIGH,bogus')).toEqual({ filterConfidence: ['high'] });
    expect(parseUrl('?official=yes')).toEqual({});
  });
});
