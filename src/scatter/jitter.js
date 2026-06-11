// Deterministic per-country jitter so dots on the integer 5×5 score
// grid spread out without stacking — and land in the SAME spot on
// every render, reload, and shared link. FNV-1a hash, two decorrelated
// lanes for x and y. Pure, unit-tested.

const SPREAD = 0.36; // total band width in score units (±0.18)

export function jitterFor(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((Math.imul(h, 0x9e3779b1)) >>> 0) % 1000) / 1000;
  return {
    dx: (a - 0.5) * SPREAD,
    dy: (b - 0.5) * SPREAD,
  };
}
