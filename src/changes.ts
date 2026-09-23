// The changes page (changes.html entry): renders one week's digest from
// public/digest/ and links to the others. Everything is built with DOM
// nodes, never innerHTML, so digest prose can never inject markup.

import { initTheme } from './controls/theme';
import {
  changesByCountry,
  changesWithoutItems,
  countryHref,
  dimensionLabel,
  formatDelta,
  parseDigest,
  parseDigestIndex,
  pickWeek,
  sourceHost,
  weekLabel,
  type Digest,
  type DigestChange,
  type DigestItem,
  type DigestWeek,
} from './data/digest';

const DIGEST_BASE = '/digest/';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function link(href: string, text: string, external = false): HTMLAnchorElement {
  const a = el('a', { href }, [text]);
  if (external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function renderMeta(digest: Digest): HTMLElement {
  const parts: (Node | string)[] = [`Run ${digest.date}`];
  if (digest.model) parts.push(' · model ', el('code', {}, [digest.model]));
  const count = digest.changes.length;
  parts.push(` · ${count} ${count === 1 ? 'country' : 'countries'} changed`);
  parts.push(' · ', link(`${DIGEST_BASE}${digest.week}.json`, 'JSON'));
  parts.push(' · ', link(`${DIGEST_BASE}feed.xml`, 'Atom feed'));
  return el('p', { class: 'digest-meta' }, parts);
}

function renderChangeFacts(change: DigestChange): HTMLElement {
  const dl = el('dl', { class: 'change-facts' });
  for (const [key, delta] of Object.entries(change.scores)) {
    dl.append(el('dt', {}, [dimensionLabel(key)]), el('dd', {}, [formatDelta(delta)]));
  }
  if (change.laws) {
    dl.append(
      el('dt', {}, ['Specific laws']),
      el('dd', {}, [
        change.laws.old ? `${change.laws.old} → ${change.laws.new}` : change.laws.new,
      ]),
    );
  }
  if (change.confidence.new && change.confidence.old !== change.confidence.new) {
    dl.append(
      el('dt', {}, ['Confidence']),
      el('dd', {}, [
        change.confidence.old
          ? `${change.confidence.old} → ${change.confidence.new}`
          : change.confidence.new,
      ]),
    );
  }
  return dl;
}

function renderSources(urls: string[], newSources: Set<string>): HTMLElement {
  const list = el('ul', { class: 'change-sources' });
  for (const url of urls) {
    const item = el('li', {}, [link(url, sourceHost(url), true)]);
    if (newSources.has(url)) item.append(' ', el('span', { class: 'change-new' }, ['new this run']));
    list.append(item);
  }
  return list;
}

function renderItem(item: DigestItem, change: DigestChange | undefined): HTMLElement {
  const article = el('article', { class: 'change' }, [
    el('h2', { class: 'change-country' }, [link(countryHref(item.country), item.country)]),
    el('p', { class: 'change-headline' }, [item.headline]),
    el('p', { class: 'change-summary' }, [item.summary]),
  ]);
  if (change && (Object.keys(change.scores).length || change.laws)) {
    article.append(renderChangeFacts(change));
  }
  article.append(
    el('h3', {}, ['Sources']),
    renderSources(item.sources, new Set(change?.newSources ?? [])),
  );
  return article;
}

function renderUncovered(changes: DigestChange[]): HTMLElement {
  const section = el('section', { class: 'change-uncovered' }, [
    el('h2', {}, ['Also changed']),
    el('p', {}, [
      'These countries changed in the run but have no written item: the run found no ',
      'source the item could cite, or the item was rejected for citing one it did not find.',
    ]),
  ]);
  const list = el('ul');
  for (const change of changes) {
    const deltas = Object.values(change.scores);
    const firstScored = deltas.length > 0 && deltas.every((d) => d.old === null);
    const facts = firstScored
      ? ['first scored in this run']
      : Object.entries(change.scores).map(([key, delta]) => `${dimensionLabel(key)} ${formatDelta(delta)}`);
    if (change.laws && !firstScored) facts.push('specific laws updated');
    list.append(el('li', {}, [link(countryHref(change.country), change.country), `: ${facts.join('; ')}`]));
  }
  section.append(list);
  return section;
}

function renderWeeks(weeks: DigestWeek[], current: string): HTMLElement {
  const section = el('section', { class: 'digest-weeks' }, [el('h2', {}, ['All weeks'])]);
  const list = el('ul');
  for (const week of weeks) {
    const label = `${weekLabel(week.week)} (${week.date})`;
    const count = week.changeCount === 0
      ? 'no changes'
      : `${week.changeCount} ${week.changeCount === 1 ? 'country' : 'countries'}`;
    const row = el('li', {}, week.week === current
      ? [el('strong', {}, [label]), `, ${count}`]
      : [link(`/changes.html?week=${week.week}`, label), `, ${count}`]);
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderDigest(root: HTMLElement, digest: Digest, weeks: DigestWeek[], latest: boolean): void {
  root.replaceChildren();
  const title = latest ? "This week's changes" : `Changes, ${weekLabel(digest.week).toLowerCase()}`;
  document.title = `${title} · AI Regulation Map`;
  root.append(
    el('h1', { class: 'doc-title' }, [title]),
    el('p', { class: 'doc-subtitle' }, [
      latest ? `${weekLabel(digest.week)}. ` : '',
      'What moved in the tracker after the latest research run, with the sources the run found. ',
      'Score changes are listed as old → new.',
    ]),
    renderMeta(digest),
  );
  if (digest.calibrationBreak) {
    root.append(el('div', { class: 'callout' }, [
      el('strong', {}, ['Calibration break.']),
      `This run re-scored every country with ${digest.calibrationBreak.model || 'a new model'} `,
      `(${digest.calibrationBreak.reason}). Score movements dated ${digest.calibrationBreak.date} `,
      'are a recalibration, not policy change, so only law and confidence changes are listed.',
    ]));
  }
  root.append(el('p', { class: 'digest-lead' }, [digest.lead]));

  const byCountry = changesByCountry(digest);
  for (const item of digest.items) root.append(renderItem(item, byCountry.get(item.country)));

  const uncovered = changesWithoutItems(digest);
  if (uncovered.length) root.append(renderUncovered(uncovered));

  if (weeks.length > 1) root.append(renderWeeks(weeks, digest.week));
}

function renderEmpty(root: HTMLElement, message: string): void {
  root.replaceChildren(
    el('h1', { class: 'doc-title' }, ["This week's changes"]),
    el('p', { class: 'doc-subtitle' }, [message]),
    el('p', {}, [
      'The digest is written after each scheduled research run. Subscribe to the ',
      link(`${DIGEST_BASE}feed.xml`, 'Atom feed'),
      ' to be told when the first one lands.',
    ]),
  );
}

async function main(): Promise<void> {
  initTheme();
  const root = document.getElementById('digest');
  if (!root) return;

  const weeks = parseDigestIndex(await fetchJson(`${DIGEST_BASE}index.json`));
  const requested = new URLSearchParams(location.search).get('week');
  const week = pickWeek(weeks, requested);
  if (!week) {
    renderEmpty(root, 'No digest has been published yet.');
    return;
  }

  let digest: Digest;
  try {
    digest = parseDigest(await fetchJson(`${DIGEST_BASE}${week.file}`));
  } catch {
    renderEmpty(root, `The digest for ${weekLabel(week.week)} could not be loaded.`);
    return;
  }
  renderDigest(root, digest, weeks, week.week === weeks[0]?.week);
}

main();
