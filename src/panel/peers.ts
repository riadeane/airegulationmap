// "Compare with" row - one chip per peer set (each bloc the country is in,
// similar maturity, similar profile). A click replaces the comparison set
// with the selected country plus the set and opens the full view, so the
// URL's `compare` parameter makes the result shareable.
//
// The row renders synchronously with the rest of the panel, so it never
// pops in after the scores. It is a latest-data derivation like the rank,
// so the caller hides it while the timeline shows a historical vintage.

import { getState } from '../state/store';
import { startComparison } from '../state/interactions';
import { peerSets } from '../data/peers';
import type { PeerSet } from '../data/peers';
import { MAX_COMPARISON } from '../constants';

// The selected country takes one comparison slot; peers fill the rest.
const PEER_LIMIT = MAX_COMPARISON - 1;

function formatList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function buildChip(country: string, set: PeerSet): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'peer-chip';
  chip.dataset.kind = set.kind;
  chip.title = `${set.criterion}: ${formatList(set.members)}`;
  chip.setAttribute('aria-label', `Compare ${country} with ${formatList(set.members)}`);

  const label = document.createElement('span');
  label.className = 'peer-chip-label';
  label.textContent = set.label;

  const count = document.createElement('span');
  count.className = 'peer-chip-count';
  count.textContent = String(set.members.length);
  count.setAttribute('aria-hidden', 'true');

  chip.append(label, count);
  chip.addEventListener('click', () => startComparison([country, ...set.members]));
  return chip;
}

/** Render the row for `country`, or hide it when null. */
export function renderPeerRow(country: string | null): void {
  const section = document.getElementById('peers-section');
  const container = document.getElementById('peer-chips');
  if (!section || !container) return;
  const { scoreData, blocsData } = getState();
  const sets = country ? peerSets(country, scoreData, blocsData, PEER_LIMIT) : [];
  section.hidden = sets.length === 0;
  container.replaceChildren(...sets.map(set => buildChip(country!, set)));
}
