import { describe, it, expect } from 'vitest';
import { setState, on } from '../src/state/store';

// Focused coverage for the emit-on-change guard: a no-op write must not
// notify listeners (it used to fan out redundant re-renders — a bare Esc
// re-writing selectedCountry:null, or writing both filter sliders when only
// one moved).

describe('store: emit only on real change', () => {
  it('does not emit when the value is unchanged', () => {
    setState({ filterMax: 5 });
    let calls = 0;
    on('filterMax', () => calls++);
    setState({ filterMax: 5 }); // same value → no emit
    setState({ filterMax: 5 });
    expect(calls).toBe(0);
    setState({ filterMax: 3 }); // real change → emit
    expect(calls).toBe(1);
  });

  it('emits only the changed keys in a multi-key patch', () => {
    setState({ filterMin: 1, filterMax: 4 });
    const changed = [];
    on('filterMin', () => changed.push('min'));
    on('filterMax', () => changed.push('max'));
    // Only filterMin actually differs from current state.
    setState({ filterMin: 2, filterMax: 4 });
    expect(changed).toEqual(['min']);
  });

  it('re-emits when a new array of equal contents is written (reference change)', () => {
    setState({ comparisonCountries: [] });
    let calls = 0;
    on('comparisonCountries', () => calls++);
    setState({ comparisonCountries: ['Chile'] });
    setState({ comparisonCountries: ['Chile'] }); // new array instance → emits
    expect(calls).toBe(2);
  });
});
