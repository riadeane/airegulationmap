import { describe, it, expect } from 'vitest';
import { setState } from '../src/state/store';
import {
  confidenceAtDate,
  isLowConfidenceAtDate,
  confidenceFallsBackAtDate,
  normalizeConfidence,
} from '../src/state/selectors';
import {
  readUncertaintyPref,
  writeUncertaintyPref,
  UNCERTAINTY_STORAGE_KEY,
} from '../src/controls/uncertainty';
import { hatchTransform, hatchedCountries } from '../src/map/hatch';
import { buildQueryString } from '../src/controls/url';

// PRD 13: the map hatches countries that are low confidence as of the
// timeline date. Each test installs fresh history/regulation objects, which
// invalidates the selectors' reference-keyed memoization.

function snap(date, extra = {}) {
  return {
    date,
    regulationStatus: 2,
    policyLever: 2,
    governanceType: 2,
    actorInvolvement: 2,
    enforcementLevel: 2,
    averageScore: 2,
    ...extra,
  };
}

function regulation(map) {
  const data = {};
  for (const [country, confidence] of Object.entries(map)) {
    data[country] = { country, confidence };
  }
  return data;
}

describe('isLowConfidenceAtDate selector', () => {
  it('uses current confidence at "Latest"', () => {
    setState({
      regulationData: regulation({ Chad: 'low', Germany: 'medium' }),
      history: { schema_version: 1, countries: { Chad: [snap('2026-03-01', { confidence: 'high' })] } },
      timelineDate: null,
    });
    // The snapshot's "high" is history; at Latest the current rating holds.
    expect(isLowConfidenceAtDate('Chad')).toBe(true);
    expect(isLowConfidenceAtDate('Germany')).toBe(false);
  });

  it('follows the snapshot shown at the date when history carries confidence', () => {
    setState({
      regulationData: regulation({ Chad: 'medium', Mali: 'low' }),
      history: {
        schema_version: 1,
        countries: {
          Chad: [snap('2026-03-01', { confidence: 'low' }), snap('2026-06-01', { confidence: 'medium' })],
          Mali: [snap('2026-03-01', { confidence: 'medium' }), snap('2026-06-01', { confidence: 'low' })],
        },
      },
      timelineDate: '2026-03-01',
    });
    expect(isLowConfidenceAtDate('Chad')).toBe(true);
    expect(isLowConfidenceAtDate('Mali')).toBe(false);

    setState({ timelineDate: '2026-06-01' });
    expect(isLowConfidenceAtDate('Chad')).toBe(false);
    expect(isLowConfidenceAtDate('Mali')).toBe(true);
  });

  it('holds a snapshot confidence until the next change-point', () => {
    setState({
      regulationData: regulation({ Chad: 'medium' }),
      history: {
        schema_version: 1,
        countries: {
          Chad: [snap('2026-03-01', { confidence: 'low' }), snap('2026-06-01', { confidence: 'medium' })],
          // Another country supplies the in-between date the slider can emit.
          Mali: [snap('2026-04-15', { confidence: 'medium' })],
        },
      },
      timelineDate: '2026-04-15',
    });
    expect(isLowConfidenceAtDate('Chad')).toBe(true);
  });

  it('falls back to current confidence when the snapshot records none', () => {
    setState({
      regulationData: regulation({ Chad: 'low', Mali: 'medium' }),
      history: {
        schema_version: 1,
        countries: {
          Chad: [snap('2026-03-01')],
          Mali: [snap('2026-03-01'), snap('2026-06-01')],
        },
      },
      timelineDate: '2026-03-01',
    });
    expect(isLowConfidenceAtDate('Chad')).toBe(true);
    expect(isLowConfidenceAtDate('Mali')).toBe(false);
  });

  it('falls back to current confidence for a country absent from history', () => {
    setState({
      regulationData: regulation({ Nauru: 'low' }),
      history: { schema_version: 1, countries: { Chad: [snap('2026-03-01', { confidence: 'medium' })] } },
      timelineDate: '2026-03-01',
    });
    expect(isLowConfidenceAtDate('Nauru')).toBe(true);
  });

  it('ignores a date the history never recorded (the timeline treats it as Latest)', () => {
    setState({
      regulationData: regulation({ Chad: 'medium' }),
      history: { schema_version: 1, countries: { Chad: [snap('2026-03-01', { confidence: 'low' })] } },
      timelineDate: '2025-01-01',
    });
    expect(isLowConfidenceAtDate('Chad')).toBe(false);
  });

  it('ignores history until it loads', () => {
    setState({ regulationData: regulation({ Chad: 'low' }), history: null, timelineDate: '2026-03-01' });
    expect(isLowConfidenceAtDate('Chad')).toBe(true);
  });

  it('normalises case and whitespace, and treats unknown values as unrated', () => {
    setState({
      regulationData: regulation({ A: ' Low ', B: 'LOW', C: 'unsure', D: '', E: null }),
      history: null,
      timelineDate: null,
    });
    expect(isLowConfidenceAtDate('A')).toBe(true);
    expect(isLowConfidenceAtDate('B')).toBe(true);
    expect(isLowConfidenceAtDate('C')).toBe(false);
    expect(isLowConfidenceAtDate('D')).toBe(false);
    expect(isLowConfidenceAtDate('E')).toBe(false);
    expect(isLowConfidenceAtDate('Nowhere')).toBe(false);
    expect(confidenceAtDate('C')).toBeNull();
  });

  it('an unrecognised snapshot confidence falls back to the current one', () => {
    setState({
      regulationData: regulation({ Chad: 'low' }),
      history: { schema_version: 1, countries: { Chad: [snap('2026-03-01', { confidence: 'n/a' })] } },
      timelineDate: '2026-03-01',
    });
    expect(confidenceAtDate('Chad')).toBe('low');
  });
});

describe('normalizeConfidence', () => {
  it('maps the three levels and nothing else', () => {
    expect(normalizeConfidence('High')).toBe('high');
    expect(normalizeConfidence(' medium')).toBe('medium');
    expect(normalizeConfidence('low')).toBe('low');
    expect(normalizeConfidence('lowish')).toBeNull();
    expect(normalizeConfidence(undefined)).toBeNull();
  });
});

describe('confidenceFallsBackAtDate selector', () => {
  it('is false at "Latest"', () => {
    setState({
      regulationData: regulation({ Chad: 'low' }),
      history: { schema_version: 1, countries: { Chad: [snap('2026-03-01')] } },
      timelineDate: null,
    });
    expect(confidenceFallsBackAtDate()).toBe(false);
  });

  it('is true on a past date when a shown snapshot records no confidence', () => {
    setState({
      regulationData: regulation({ Chad: 'low', Mali: 'low' }),
      history: {
        schema_version: 1,
        countries: {
          Chad: [snap('2026-03-01', { confidence: 'low' })],
          Mali: [snap('2026-03-01')],
        },
      },
      timelineDate: '2026-03-01',
    });
    expect(confidenceFallsBackAtDate()).toBe(true);
  });

  it('is false on a past date when every shown snapshot records confidence', () => {
    const history = {
      schema_version: 1,
      countries: {
        Chad: [snap('2026-03-01', { confidence: 'low' })],
        Mali: [snap('2026-03-01', { confidence: 'Medium' })],
      },
    };
    setState({ regulationData: regulation({ Chad: 'low' }), history, timelineDate: '2026-03-01' });
    expect(confidenceFallsBackAtDate()).toBe(false);
    // Memoized on the snapshot set: the same answer on a repeat read.
    expect(confidenceFallsBackAtDate()).toBe(false);
  });
});

describe('"Show uncertainty" preference', () => {
  function memoryStorage(initial = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: key => (key in data ? data[key] : null),
      setItem: (key, value) => { data[key] = String(value); },
    };
  }

  it('defaults to on', () => {
    expect(readUncertaintyPref(memoryStorage())).toBe(true);
    expect(readUncertaintyPref(null)).toBe(true);
  });

  it('round-trips off and on', () => {
    const storage = memoryStorage();
    writeUncertaintyPref(storage, false);
    expect(storage.data[UNCERTAINTY_STORAGE_KEY]).toBe('0');
    expect(readUncertaintyPref(storage)).toBe(false);
    writeUncertaintyPref(storage, true);
    expect(readUncertaintyPref(storage)).toBe(true);
  });

  it('reads blocked storage as the default and never throws on write', () => {
    const blocked = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(readUncertaintyPref(blocked)).toBe(true);
    expect(() => writeUncertaintyPref(blocked, false)).not.toThrow();
  });

  it('is not carried in the URL', () => {
    const base = {
      currentAttribute: 'averageScore',
      filterMin: 1,
      filterMax: 5,
      filterConfidence: null,
      filterOfficialOnly: false,
      selectedCountry: null,
      comparisonCountries: [],
      timelineDate: null,
      selectedBloc: null,
      searchQuery: '',
      mainView: 'map',
      scatterX: 'enforcementLevel',
      scatterY: 'regulationStatus',
    };
    expect(buildQueryString({ ...base, showUncertainty: false })).toBe('');
    expect(buildQueryString({ ...base, showUncertainty: true })).toBe('');
  });
});

describe('hatchTransform', () => {
  it('is a plain 45° rotation at the default zoom', () => {
    expect(hatchTransform(1)).toBe('rotate(45)');
  });

  it('counter-scales the tile so the on-screen spacing holds', () => {
    expect(hatchTransform(8)).toBe('rotate(45) scale(0.125)');
    expect(hatchTransform(2)).toBe('rotate(45) scale(0.5)');
  });

  it('snaps to quarter-octave steps, keeping spacing within about 9% of 4 px', () => {
    // Nearby zoom factors share one transform (no re-record per frame).
    expect(hatchTransform(1.05)).toBe(hatchTransform(1));
    expect(hatchTransform(1.5)).toBe(hatchTransform(1.45));
    for (let k = 1; k <= 8; k += 0.01) {
      const scale = Number(/scale\(([^)]+)\)/.exec(hatchTransform(k))?.[1] ?? 1);
      const onScreen = 4 * k * scale;
      expect(onScreen).toBeGreaterThan(4 / 1.091);
      expect(onScreen).toBeLessThan(4 * 1.091);
    }
  });

  it('treats a degenerate zoom factor as the default', () => {
    expect(hatchTransform(0)).toBe('rotate(45)');
    expect(hatchTransform(NaN)).toBe('rotate(45)');
  });
});

describe('hatchedCountries', () => {
  const scores = { Chad: 1.5, Mali: null, Niger: Number.NaN, Germany: 2.9 };
  const low = new Set(['Chad', 'Mali', 'Niger', 'Nauru']);
  const rule = show => ({
    show,
    hasScore: name => scores[name] != null && Number.isFinite(scores[name]),
    isLow: name => low.has(name),
  });

  it('hatches low-confidence countries that carry a score colour', () => {
    expect([...hatchedCountries(Object.keys(scores), rule(true))]).toEqual(['Chad']);
  });

  it('never hatches "no data" (null, NaN, or absent) countries', () => {
    const hatched = hatchedCountries(['Mali', 'Niger', 'Nauru'], rule(true));
    expect(hatched.size).toBe(0);
  });

  it('hatches nothing while "Show uncertainty" is off', () => {
    expect(hatchedCountries(Object.keys(scores), rule(false)).size).toBe(0);
  });
});
