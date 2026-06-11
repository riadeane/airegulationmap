// Per-country score change history derived from history.json snapshots.
// Pure — no DOM, unit-tested.

import { ATTRIBUTE_LABELS } from '../constants.js';

// The five independently scored dimensions. averageScore is derived,
// so it never appears as its own changelog line.
const DIMENSION_KEYS = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

/**
 * Compute a changelog from a country's history snapshots.
 *
 * Returns entries sorted newest-first:
 *   { date, changes: [{ dimension, label, from, to }] }   — a diff entry
 *   { date, initial: true, scores: { <dimension>: score } } — the baseline
 *
 * Returns [] when there are no snapshots.
 */
export function computeChangelog(countryHistory) {
  if (!countryHistory || countryHistory.length === 0) return [];

  const sorted = [...countryHistory].sort((a, b) => a.date.localeCompare(b.date));
  const changelog = [];

  const initialScores = {};
  for (const key of DIMENSION_KEYS) {
    if (sorted[0][key] != null) initialScores[key] = sorted[0][key];
  }
  changelog.push({ date: sorted[0].date, initial: true, scores: initialScores });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const changes = [];

    for (const key of DIMENSION_KEYS) {
      if (prev[key] !== curr[key]) {
        changes.push({
          dimension: key,
          label: ATTRIBUTE_LABELS[key] || key,
          from: prev[key],
          to: curr[key],
        });
      }
    }

    if (changes.length > 0) {
      changelog.push({ date: curr.date, changes });
    }
  }

  return changelog.reverse();
}
