// Renders the SCORE HISTORY section of the country panel from
// history.json snapshots. DOM built programmatically — never innerHTML
// with data-derived strings.

import { getState } from '../state/store';
import { computeChangelog } from '../data/changelog';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(iso) {
  return dateFormat.format(new Date(iso + 'T00:00:00'));
}

function renderEmptyMessage(container, text) {
  const p = document.createElement('p');
  p.className = 'changelog-empty';
  p.textContent = text;
  container.appendChild(p);
}

function renderChangeEntry(entry) {
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

    const up = c.to > c.from;
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

function renderInitialEntry(entry) {
  const entryDiv = document.createElement('div');
  entryDiv.className = 'changelog-entry changelog-initial';

  const time = document.createElement('time');
  time.className = 'changelog-date';
  time.dateTime = entry.date;
  time.textContent = `${formatDate(entry.date)} — initial assessment`;
  entryDiv.appendChild(time);

  return entryDiv;
}

export function renderChangelog(countryName) {
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
}
