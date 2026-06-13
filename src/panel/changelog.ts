// Renders the SCORE HISTORY section of the country panel from
// history.json snapshots. DOM built programmatically — never innerHTML
// with data-derived strings.

import { getState } from '../state/store';
import { computeChangelog } from '../data/changelog';

// Snapshots from this date onward use methodology v2 (sub-indicator
// means, frontier calibration, 3-dimension maturity composite).
const METHODOLOGY_V2_DATE = '2026-06-13';
import type { ChangelogDiffEntry, ChangelogInitialEntry } from '../data/changelog';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso + 'T00:00:00'));
}

function renderEmptyMessage(container: Element, text: string): void {
  const p = document.createElement('p');
  p.className = 'changelog-empty';
  p.textContent = text;
  container.appendChild(p);
}

function renderChangeEntry(entry: ChangelogDiffEntry): HTMLDivElement {
  const entryDiv = document.createElement('div');
  entryDiv.className = 'changelog-entry';

  const time = document.createElement('time');
  time.className = 'changelog-date';
  time.dateTime = entry.date;
  time.textContent = formatDate(entry.date);
  entryDiv.appendChild(time);

  const ul = document.createElement('ul');
  ul.className = 'changelog-changes';

  for (const c of entry.changes) {
    const li = document.createElement('li');

    const dimSpan = document.createElement('span');
    dimSpan.className = 'changelog-dim';
    dimSpan.textContent = c.label;
    li.appendChild(dimSpan);

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'changelog-arrow';
    arrowSpan.textContent = `${c.from} → ${c.to}`;
    li.appendChild(arrowSpan);

    const up = c.to! > c.from!;
    const dirSpan = document.createElement('span');
    dirSpan.className = `changelog-direction ${up ? 'up' : 'down'}`;
    dirSpan.textContent = up ? '↑' : '↓';
    dirSpan.setAttribute('aria-label', up ? 'increased' : 'decreased');
    li.appendChild(dirSpan);

    ul.appendChild(li);
  }

  entryDiv.appendChild(ul);
  return entryDiv;
}

function renderInitialEntry(entry: ChangelogInitialEntry): HTMLDivElement {
  const entryDiv = document.createElement('div');
  entryDiv.className = 'changelog-entry changelog-initial';

  const time = document.createElement('time');
  time.className = 'changelog-date';
  time.dateTime = entry.date;
  time.textContent = `${formatDate(entry.date)} — initial assessment`;
  entryDiv.appendChild(time);

  return entryDiv;
}

export function renderChangelog(countryName: string): void {
  const section = document.getElementById('changelog-section');
  const container = document.getElementById('changelog-entries');
  if (!section || !container) return;

  container.replaceChildren();

  const { history } = getState();
  const snapshots = history?.countries?.[countryName];

  // History hasn't loaded yet (it arrives async) or the country has no
  // snapshots — hide rather than show an empty frame.
  if (!snapshots || snapshots.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const changelog = computeChangelog(snapshots);

  if (changelog.length === 1) {
    // Only the initial assessment exists.
    renderEmptyMessage(container, `No score changes recorded since the initial assessment (${formatDate(changelog[0].date)}).`);
    return;
  }

  for (const entry of changelog) {
    container.appendChild(entry.initial ? renderInitialEntry(entry) : renderChangeEntry(entry));
  }

  // Methodology v2 (June 2026) changed both the scoring mechanics and
  // the calibration — without this note, a change entry crossing the
  // boundary (e.g. "Governance Type 5 → 2.25 ↓") reads as a regulatory
  // collapse rather than a re-measurement.
  const crossesV2 = snapshots.some(s => s.date < METHODOLOGY_V2_DATE)
    && changelog.some(e => !e.initial && e.date >= METHODOLOGY_V2_DATE);
  if (crossesV2) {
    const note = document.createElement('p');
    note.className = 'changelog-note';
    note.append(
      `Changes on or after ${formatDate(METHODOLOGY_V2_DATE)} partly reflect a `,
    );
    const link = document.createElement('a');
    link.href = '/methodology.html';
    link.textContent = 'methodology revision';
    note.append(link, ' (sub-indicator scoring, recalibrated scale), not only regulatory change.');
    container.appendChild(note);
  }
}
