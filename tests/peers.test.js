import { describe, it, expect } from 'vitest';
import { nearestByMaturity, nearestByProfile, blocPeers, peerSets } from '../src/data/peers';
import { getState } from '../src/state/store';
import { startComparison } from '../src/state/interactions';
import { buildQueryString, parseUrl } from '../src/controls/url';
import { MAX_COMPARISON } from '../src/constants';

// Fixture rows in the ScoreEntry shape. The maturity index is the mean of
// the three normative dimensions, as in the dataset, so a row can share a
// maturity index with the base country while its profile differs.
function row(name, [reg, pol, gov, act, enf]) {
  const normative = [reg, pol, enf];
  const averageScore = normative.every(v => v != null)
    ? normative.reduce((a, b) => a + b, 0) / 3
    : null;
  return {
    country: name,
    regulationStatus: reg,
    policyLever: pol,
    governanceType: gov,
    actorInvolvement: act,
    enforcementLevel: enf,
    averageScore,
    lastUpdated: null,
    dataVersion: 1,
  };
}

function dataset(rows) {
  return Object.fromEntries(rows.map(r => [r.country, r]));
}

// Base sits at 3 on every dimension (maturity index 3).
const scoreData = dataset([
  row('Base',    [3, 3, 3, 3, 3]),
  row('Charlie', [3, 3.75, 3, 3, 3]),        // index 3.25 (d 0.25); profile d² 0.5625
  row('Alpha',   [4.5, 3, 3, 3, 3]),         // index 3.5  (d 0.5);  profile d² 2.25
  row('Bravo',   [3, 3, 3, 3, 1.5]),         // index 2.5  (d 0.5);  profile d² 2.25 - ties Alpha
  row('Delta',   [4.5, 4.5, 3, 3, 3]),       // index 4    (d 1);    profile d² 4.5
  row('Echo',    [5, 5, 5, 5, 5]),           // index 5    (d 2);    profile d² 20
  row('Shape',   [3, 3, 5, 5, 3]),           // index 3    (d 0);    profile d² 8 - descriptive dims only
  row('Partial', [3, 3, null, 3, 3]),        // index 3 but no full profile
  row('Blank',   [null, null, null, null, null]),
]);

describe('nearestByMaturity', () => {
  it('orders by maturity-index distance, alphabetical on ties, and excludes the selected country', () => {
    expect(nearestByMaturity('Base', scoreData, 5))
      .toEqual(['Partial', 'Shape', 'Charlie', 'Alpha', 'Bravo']);
  });

  it('keeps only the first `limit` (most similar first)', () => {
    expect(nearestByMaturity('Base', scoreData, 2)).toEqual(['Partial', 'Shape']);
  });

  it('excludes countries with no maturity index', () => {
    expect(nearestByMaturity('Base', scoreData, 20)).not.toContain('Blank');
  });

  it('is empty for an unscored or unknown country', () => {
    expect(nearestByMaturity('Blank', scoreData, 4)).toEqual([]);
    expect(nearestByMaturity('Nowhere', scoreData, 4)).toEqual([]);
  });
});

describe('nearestByProfile', () => {
  it('orders by Euclidean distance across five dimensions, alphabetical on ties', () => {
    expect(nearestByProfile('Base', scoreData, 4))
      .toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta']);
  });

  it('weights the descriptive dimensions equally with the normative ones', () => {
    // Shape shares Base's maturity index exactly but differs on the two
    // descriptive dimensions, so maturity ranks it first and profile last
    // among the full-profile rows.
    const byMaturity = nearestByMaturity('Base', scoreData, 20);
    const byProfile = nearestByProfile('Base', scoreData, 20);
    expect(byMaturity.indexOf('Shape')).toBeLessThan(byMaturity.indexOf('Charlie'));
    expect(byProfile.indexOf('Shape')).toBeGreaterThan(byProfile.indexOf('Delta'));
  });

  it('excludes the selected country and any row missing a dimension', () => {
    const all = nearestByProfile('Base', scoreData, 20);
    expect(all).not.toContain('Base');
    expect(all).not.toContain('Partial');
    expect(all).not.toContain('Blank');
  });

  it('is empty when the selected country has no full profile', () => {
    expect(nearestByProfile('Partial', scoreData, 4)).toEqual([]);
    expect(nearestByProfile('Nowhere', scoreData, 4)).toEqual([]);
  });
});

describe('blocPeers', () => {
  const blocsData = {
    EU: { name: 'European Union', members: ['Base', 'Alpha', 'Bravo', 'Delta', 'Foxtrot', 'Blank'] },
    G7: { name: 'G7', members: ['Alpha', 'Delta'] },
    ASEAN: { name: 'ASEAN', members: ['Base', 'Blank'] },
  };
  // Foxtrot ties Alpha on the maturity index.
  const data = { ...scoreData, Foxtrot: row('Foxtrot', [3, 4.5, 3, 3, 3]) };

  it('yields one set per bloc the country is in, top members by maturity index, ties alphabetical', () => {
    const sets = blocPeers('Base', blocsData, data, 4);
    expect(sets.map(s => s.label)).toEqual(['EU']);
    expect(sets[0].kind).toBe('bloc');
    expect(sets[0].criterion).toContain('European Union');
    expect(sets[0].members).toEqual(['Delta', 'Alpha', 'Foxtrot', 'Bravo']);
  });

  it('excludes the selected country and unscored members, and truncates to the limit', () => {
    const [eu] = blocPeers('Base', blocsData, data, 2);
    expect(eu.members).toEqual(['Delta', 'Alpha']);
    expect(blocPeers('Base', blocsData, data, 20)[0].members).not.toContain('Blank');
  });

  it('omits a bloc with no other scored member and blocs the country is not in', () => {
    // ASEAN has only Base and an unscored member; G7 does not include Base.
    expect(blocPeers('Base', blocsData, data, 4).map(s => s.label)).toEqual(['EU']);
  });

  it('is empty without bloc data', () => {
    expect(blocPeers('Base', null, data, 4)).toEqual([]);
  });
});

describe('peerSets', () => {
  it('lists bloc sets first, then similar maturity, then similar profile', () => {
    const blocsData = { G20: { name: 'G20', members: ['Base', 'Echo'] } };
    const sets = peerSets('Base', scoreData, blocsData, 3);
    expect(sets.map(s => s.kind)).toEqual(['bloc', 'maturity', 'profile']);
    expect(sets[1].members).toEqual(['Partial', 'Shape', 'Charlie']);
    expect(sets[2].members).toEqual(['Charlie', 'Alpha', 'Bravo']);
    for (const set of sets) expect(set.members).not.toContain('Base');
  });

  it('omits empty sets', () => {
    expect(peerSets('Blank', scoreData, null, 3)).toEqual([]);
    expect(peerSets('Partial', scoreData, null, 3).map(s => s.kind)).toEqual(['maturity']);
  });
});

describe('startComparison (a chip click)', () => {
  it('opens the comparison view with the country plus its peers, and the URL reopens it', () => {
    startComparison(['Base', 'Charlie', 'Alpha', 'Bravo']);
    const state = getState();
    expect(state.mainView).toBe('comparison');
    expect(state.comparisonCountries).toEqual(['Base', 'Charlie', 'Alpha', 'Bravo']);

    const qs = buildQueryString(state);
    expect(qs).toBe('compare=Base,Charlie,Alpha,Bravo');
    expect(parseUrl(`?${qs}`).compare).toEqual(['Base', 'Charlie', 'Alpha', 'Bravo']);
  });

  it('respects the comparison cap, keeping the most similar (first) entries', () => {
    startComparison(['Base', 'Charlie', 'Alpha', 'Bravo', 'Delta', 'Echo']);
    expect(getState().comparisonCountries).toEqual(
      ['Base', 'Charlie', 'Alpha', 'Bravo', 'Delta', 'Echo'].slice(0, MAX_COMPARISON)
    );
    expect(getState().comparisonCountries.length).toBe(MAX_COMPARISON);
  });

  it('drops duplicates before applying the cap', () => {
    startComparison(['Base', 'Base', 'Charlie']);
    expect(getState().comparisonCountries).toEqual(['Base', 'Charlie']);
  });
});
