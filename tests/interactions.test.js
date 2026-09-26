import { describe, it, expect, beforeEach } from 'vitest';
import { getState, setState } from '../src/state/store';
import { selectCountry, addToComparison, toggleComparison } from '../src/state/interactions';

// Regression: the map draws territories the dataset has no row for
// (Greenland, W. Sahara, Palestine, Puerto Rico). Selecting one produced an
// empty panel, and adding one to the comparison produced ?compare= links
// that did not survive a reload. The intents only accept dataset countries.

beforeEach(() => {
  setState({
    scoreData: { Germany: { country: 'Germany' }, France: { country: 'France' } },
    selectedCountry: null,
    comparisonCountries: [],
    mainView: 'map',
  });
});

describe('selectCountry', () => {
  it('selects a dataset country and clears with null', () => {
    selectCountry('Germany');
    expect(getState().selectedCountry).toBe('Germany');
    selectCountry(null);
    expect(getState().selectedCountry).toBeNull();
  });

  it('ignores a name with no dataset row and keeps the selection', () => {
    selectCountry('Germany');
    selectCountry('Greenland');
    expect(getState().selectedCountry).toBe('Germany');
    selectCountry('toString');
    expect(getState().selectedCountry).toBe('Germany');
  });
});

describe('comparison membership', () => {
  it('adds dataset countries only', () => {
    addToComparison('Greenland');
    toggleComparison('W. Sahara');
    addToComparison('Germany');
    toggleComparison('France');
    expect(getState().comparisonCountries).toEqual(['Germany', 'France']);
  });
});
