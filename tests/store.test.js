import { describe, it, expect } from 'vitest';
import { getState, setState, on } from '../src/state/store.js';

// The store is a module-level singleton, so tests share state — each test
// uses keys it owns or reads back what it just wrote.

describe('state store', () => {
  it('merges patches into the existing state', () => {
    setState({ filterMin: 2 });
    setState({ filterMax: 4 });
    expect(getState().filterMin).toBe(2);
    expect(getState().filterMax).toBe(4);
    expect(getState().currentAttribute).toBe('averageScore');
  });

  it('emits once per changed key with the new value', () => {
    const seen = [];
    on('selectedCountry', v => seen.push(v));
    setState({ selectedCountry: 'Germany' });
    setState({ selectedCountry: 'France', filterMin: 1 });
    expect(seen).toEqual(['Germany', 'France']);
  });

  it('does not emit for keys absent from the patch', () => {
    let calls = 0;
    on('timelineDate', () => calls++);
    setState({ selectedCountry: 'Japan' });
    expect(calls).toBe(0);
  });

  it('returns an unsubscribe function from on()', () => {
    let calls = 0;
    const off = on('comparisonCountries', () => calls++);
    setState({ comparisonCountries: ['Brazil'] });
    off();
    setState({ comparisonCountries: ['Brazil', 'India'] });
    expect(calls).toBe(1);
  });

  it('getState returns the live state object', () => {
    const a = getState();
    setState({ currentAttribute: 'enforcementLevel' });
    expect(a.currentAttribute).toBe('enforcementLevel');
    setState({ currentAttribute: 'averageScore' });
  });
});
