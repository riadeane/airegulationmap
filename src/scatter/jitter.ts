// Deterministic per-country jitter so dots on the integer 5×5 score
// grid spread out without stacking — and land in the SAME spot on
// every render, reload, and shared link. FNV-1a hash, two decorrelated
// lanes for x and y. Pure, unit-tested.

// Total band width in score units (±0.06). Sized for methodology v2's
// quarter-point data: jitter must stay well under the 0.25 step so it
// separates ties without blurring real score differences. (The old
// ±0.18 band was tuned for integer-only data.)
const SPREAD = 0.12;

export interface Jitter {
  dx: number;
  dy: number;
}

export function jitterFor(name: string): Jitter {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((Math.imul(h, 0x9e3779b1) >>> 0) % 1000) / 1000;
  return {
    dx: (a - 0.5) * SPREAD,
    dy: (b - 0.5) * SPREAD,
  };
}
