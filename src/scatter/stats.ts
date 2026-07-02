// Pearson correlation + least-squares fit for the scatter trend overlay.
// Pure and unit-tested; the renderer decides how to draw the result.

export interface TrendStats {
  /** Pearson's r in [-1, 1]. */
  r: number;
  slope: number;
  intercept: number;
  /** Number of points the fit was computed from. */
  n: number;
}

/**
 * Compute Pearson's r and the least-squares line for a point set, or null
 * when no meaningful fit exists: fewer than 3 points, or zero variance on
 * either axis (a vertical/horizontal stripe has no defined correlation).
 */
export function pearsonAndFit(points: readonly { x: number; y: number }[]): TrendStats | null {
  const n = points.length;
  if (n < 3) return null;

  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const mx = sx / n;
  const my = sy / n;

  let cov = 0, vx = 0, vy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;

  const r = cov / Math.sqrt(vx * vy);
  const slope = cov / vx;
  const intercept = my - slope * mx;
  return { r, slope, intercept, n };
}

/**
 * Clip the fitted line to a bounding box, returning the visible segment's
 * endpoints or null when the line misses the box entirely.
 */
export function clipLineToBox(
  { slope, intercept }: Pick<TrendStats, 'slope' | 'intercept'>,
  box: { x0: number; x1: number; y0: number; y1: number }
): { x0: number; y0: number; x1: number; y1: number } | null {
  const candidates: { x: number; y: number }[] = [];

  for (const x of [box.x0, box.x1]) {
    const y = slope * x + intercept;
    if (y >= box.y0 && y <= box.y1) candidates.push({ x, y });
  }
  if (slope !== 0) {
    for (const y of [box.y0, box.y1]) {
      const x = (y - intercept) / slope;
      if (x >= box.x0 && x <= box.x1) candidates.push({ x, y });
    }
  }

  // De-duplicate corner hits, keep the two extremes by x.
  const unique = candidates.filter((p, i) =>
    candidates.findIndex(q => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9) === i
  );
  if (unique.length < 2) return null;
  unique.sort((a, b) => a.x - b.x);
  const first = unique[0];
  const last = unique[unique.length - 1];
  return { x0: first.x, y0: first.y, x1: last.x, y1: last.y };
}
