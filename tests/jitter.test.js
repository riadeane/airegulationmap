import { describe, it, expect } from 'vitest';
import { jitterFor } from '../src/scatter/jitter';

describe('jitterFor', () => {
  it('is deterministic for the same country name', () => {
    expect(jitterFor('Germany')).toEqual(jitterFor('Germany'));
    expect(jitterFor('Côte d\'Ivoire')).toEqual(jitterFor('Côte d\'Ivoire'));
  });

  it('differs between countries', () => {
    expect(jitterFor('Germany')).not.toEqual(jitterFor('France'));
  });

  it('stays well under the 0.25 quarter-point data step on both axes', () => {
    const names = ['Germany', 'France', 'China', 'United States of America', 'S. Sudan', 'Fiji'];
    for (const name of names) {
      const { dx, dy } = jitterFor(name);
      expect(Math.abs(dx)).toBeLessThanOrEqual(0.06);
      expect(Math.abs(dy)).toBeLessThanOrEqual(0.06);
    }
  });

  it('decorrelates the two lanes (dx !== dy in general)', () => {
    const samples = ['Germany', 'France', 'China', 'Brazil', 'Kenya'];
    const identical = samples.filter(n => {
      const { dx, dy } = jitterFor(n);
      return dx === dy;
    });
    expect(identical.length).toBeLessThan(samples.length);
  });
});
