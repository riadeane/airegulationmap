import { describe, it, expect } from 'vitest';
import { pearsonAndFit, clipLineToBox } from '../src/scatter/stats';

describe('pearsonAndFit', () => {
  it('finds perfect positive and negative correlation', () => {
    const up = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(pearsonAndFit(up).r).toBeCloseTo(1);
    expect(pearsonAndFit(up).slope).toBeCloseTo(1);
    expect(pearsonAndFit(up).intercept).toBeCloseTo(0);

    const down = [{ x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 1 }];
    expect(pearsonAndFit(down).r).toBeCloseTo(-1);
    expect(pearsonAndFit(down).slope).toBeCloseTo(-1);
  });

  it('matches a hand-computed r for a known sample', () => {
    // cov = 8, var_x = 10, var_y = 8.8 → r = 8/√88 ≈ 0.8528.
    const pts = [
      { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 6 },
    ];
    const stats = pearsonAndFit(pts);
    expect(stats.r).toBeCloseTo(0.8528, 3);
    expect(stats.slope).toBeCloseTo(0.8, 6);
    expect(stats.n).toBe(5);
  });

  it('returns null below 3 points or with zero variance', () => {
    expect(pearsonAndFit([])).toBeNull();
    expect(pearsonAndFit([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    // Vertical stripe: no x variance.
    expect(pearsonAndFit([{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }])).toBeNull();
    // Horizontal stripe: no y variance.
    expect(pearsonAndFit([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }])).toBeNull();
  });
});

describe('clipLineToBox', () => {
  const box = { x0: 0, x1: 10, y0: 0, y1: 10 };

  it('keeps a line that crosses the whole box', () => {
    const seg = clipLineToBox({ slope: 1, intercept: 0 }, box);
    expect(seg).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 });
  });

  it('clips a steep line at the top/bottom edges', () => {
    const seg = clipLineToBox({ slope: 2, intercept: 0 }, box);
    expect(seg.x0).toBeCloseTo(0);
    expect(seg.y1).toBeCloseTo(10);
    expect(seg.x1).toBeCloseTo(5);
  });

  it('returns null when the line misses the box', () => {
    expect(clipLineToBox({ slope: 0.1, intercept: 100 }, box)).toBeNull();
  });
});
