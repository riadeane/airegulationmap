import { describe, it, expect, beforeEach } from 'vitest';
import { getState, setState } from '../src/state/store';
import {
  selectCountry, addToComparison, toggleComparison, selectBloc, resetFilters, receiveData,
} from '../src/state/interactions';

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

// #150: controls write through intents. The bloc intent carries the one new
// rule (only a known bloc), and "Reset filters" is one atomic write.
describe('bloc and filter intents', () => {
  beforeEach(() => {
    setState({ blocsData: { EU: { name: 'European Union', members: ['Germany', 'France'] } }, selectedBloc: null });
  });

  it('selects a known bloc, ignores an unknown key, and clears with null', () => {
    selectBloc('EU');
    expect(getState().selectedBloc).toBe('EU');
    selectBloc('Atlantis');
    expect(getState().selectedBloc).toBe('EU');
    selectBloc(null);
    expect(getState().selectedBloc).toBeNull();
  });

  it('resetFilters clears every filter and the bloc, not the uncertainty hatch', () => {
    selectBloc('EU');
    setState({
      filterMin: 2, filterMax: 4, filterConfidence: ['high'], filterOfficialOnly: true,
      filterEvidence: 'grounded', showUncertainty: false,
    });
    resetFilters();
    const s = getState();
    expect([s.filterMin, s.filterMax, s.selectedBloc]).toEqual([1, 5, null]);
    expect([s.filterConfidence, s.filterOfficialOnly, s.filterEvidence]).toEqual([null, false, 'any']);
    expect(s.showUncertainty).toBe(false);
  });

  it('receiveData writes the data slices it is given', () => {
    const countryIso = { Germany: { alpha2: 'DE', alpha3: 'DEU', numeric: '276' } };
    receiveData({ countryIso });
    expect(getState().countryIso).toBe(countryIso);
  });
});
