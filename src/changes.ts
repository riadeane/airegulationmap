// The changes page (changes.html entry): renders one week's digest or one
// monthly trend piece from public/digest/ and links to the others.
// Everything is built with DOM nodes, never innerHTML, so digest prose can
// never inject markup. Chart SVG is parsed into an inert XML document,
// whitelisted by data/svg.ts and rebuilt node by node.

import { initTheme } from './controls/theme';
import {
  breakPhrase,
  changesByCountry,
  changesWithoutItems,
  countryHref,
  dimensionLabel,
  formatDelta,
  monthLabel,
  numericColumns,
  parseDigest,
  parseDigestIndex,
  parseMonthIndex,
  parseMonthly,
  pickView,
  sourceHost,
  trendSubtitle,
  weekLabel,
  type CalibrationBreak,
  type Digest,
  type DigestChange,
  type DigestItem,
  type DigestMonth,
  type DigestWeek,
  type MonthlyChart,
  type MonthlyDrift,
  type MonthlyPiece,
  type MonthlySection,
  type MonthlyTable,
} from './data/digest';
import { sanitizeSvg, type SafeSvgNode } from './data/svg';

const DIGEST_BASE = '/digest/';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

const weekHref = (week: string): string => `/changes.html?week=${week}`;
const monthHref = (month: string): string => `/changes.html?month=${month}`;

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
      : [link(weekHref(week.week), label), `, ${count}`]);
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderMonths(months: DigestMonth[], current: string | null): HTMLElement {
  const section = el('section', { class: 'digest-weeks digest-months' }, [el('h2', {}, ['Monthly trends'])]);
  const list = el('ul');
  for (const month of months) {
    const label = monthLabel(month.month);
    const published = month.date ? `, published ${month.date}` : '';
    list.append(el('li', {}, month.month === current
      ? [el('strong', {}, [label]), published]
      : [link(monthHref(month.month), label), published]));
  }
  section.append(list);
  return section;
}

function renderDigest(
  root: HTMLElement,
  digest: Digest,
  weeks: DigestWeek[],
  months: DigestMonth[],
  latest: boolean,
): void {
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
  if (months[0]) {
    root.append(el('p', { class: 'digest-trend-link' }, [
      'Monthly trends: ',
      link(monthHref(months[0].month), monthLabel(months[0].month)),
    ]));
  }
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

  if (months.length) root.append(renderMonths(months, null));
  if (weeks.length > 1) root.append(renderWeeks(weeks, digest.week));
}

// ---------------------------------------------------------------------------
// Monthly trend piece

function buildSvg(node: SafeSvgNode): SVGElement {
  const element = document.createElementNS(SVG_NS, node.tag);
  for (const [name, value] of node.attrs) element.setAttribute(name, value);
  for (const child of node.children) {
    element.append(typeof child === 'string' ? child : buildSvg(child));
  }
  return element;
}

/** Chart markup as a live, whitelisted SVG element; null when it does not
 * parse as an svg document, and the figure falls back to its table. */
function chartSvg(markup: string): SVGElement | null {
  if (!markup) return null;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const safe = sanitizeSvg(doc.documentElement);
  return safe ? buildSvg(safe) : null;
}

function renderTable(table: MonthlyTable): HTMLElement {
  const numeric = numericColumns(table);
  const align = (i: number): Record<string, string> => (numeric[i] ? { class: 'num' } : {});
  const head = el('tr', {}, table.columns.map((column, i) => el('th', { scope: 'col', ...align(i) }, [column])));
  const body = table.rows.map((row) => el('tr', {}, row.map((cell, i) => (
    // The first column names the row (a bloc, a country) unless it is a number.
    i === 0 && !numeric[0] ? el('th', { scope: 'row' }, [cell]) : el('td', align(i), [cell])
  ))));
  return el('div', { class: 'trend-table-wrap' }, [
    el('table', { class: 'trend-table' }, [el('thead', {}, [head]), el('tbody', {}, body)]),
  ]);
}

function renderFigure(chart: MonthlyChart, index: number): HTMLElement {
  const titleId = `trend-figure-${index + 1}`;
  const figure = el('figure', { class: 'trend-figure', 'aria-labelledby': titleId }, [
    el('h2', { class: 'trend-title', id: titleId }, [chart.title]),
  ]);
  const svg = chartSvg(chart.svg);
  // The wrapper scrolls sideways on phones, where the chart keeps a legible
  // minimum width instead of shrinking its text below 10px.
  if (svg) figure.append(el('div', { class: 'trend-chart' }, [svg]));
  if (chart.caption) figure.append(el('p', { class: 'trend-caption' }, [chart.caption]));
  if (chart.table.columns.length) {
    const details = el('details', { class: 'trend-data' }, [
      el('summary', {}, ['Chart data']),
      renderTable(chart.table),
    ]);
    // Without a drawable chart the table is the figure, so show it.
    details.open = !svg;
    figure.append(details);
  } else if (!svg) {
    figure.append(el('p', { class: 'trend-caption' }, ['This chart could not be displayed.']));
  }
  return figure;
}

function renderMonthlyMeta(piece: MonthlyPiece, entry: DigestMonth): HTMLElement {
  const parts: (Node | string)[] = [`Published ${piece.date}`];
  if (piece.model) parts.push(' · model ', el('code', {}, [piece.model]));
  const count = piece.weeks.length;
  if (count) parts.push(` · from ${count} weekly ${count === 1 ? 'digest' : 'digests'}`);
  parts.push(' · ', link(`${DIGEST_BASE}${entry.file}`, 'JSON'));
  parts.push(' · ', link(`${DIGEST_BASE}feed.xml`, 'Atom feed'));
  return el('p', { class: 'digest-meta' }, parts);
}

function renderBreaks(breaks: CalibrationBreak[]): HTMLElement {
  return el('div', { class: 'callout' }, [
    el('strong', {}, [breaks.length === 1 ? 'Calibration break.' : 'Calibration breaks.']),
    `Score movements dated ${breakPhrase(breaks)} are a re-measurement on a recalibrated `,
    "scale, not policy change, so they are excluded from the month's movement.",
  ]);
}

function renderSection(section: MonthlySection): HTMLElement {
  const article = el('article', { class: 'change' }, [
    el('h2', { class: 'change-heading' }, [section.heading]),
    el('p', { class: 'change-summary' }, [section.text]),
  ]);
  if (section.sources.length) {
    article.append(el('h3', {}, ['Sources']), renderSources(section.sources, new Set()));
  }
  return article;
}

function renderDrift(drift: MonthlyDrift): HTMLElement {
  const parts: (Node | string)[] = [drift.text];
  if (drift.href) parts.push(' ', link(drift.href, drift.label));
  return el('p', { class: 'trend-drift' }, parts);
}

// Weeks the piece was written from. A week missing from the index is
// named but not linked (the link would land on the newest week instead).
function renderPieceWeeks(ids: string[], weeks: DigestWeek[]): HTMLElement {
  const known = new Map(weeks.map((w) => [w.week, w]));
  const list = el('ul');
  for (const id of ids) {
    const week = known.get(id);
    list.append(el('li', {}, [week ? link(weekHref(id), `${weekLabel(id)} (${week.date})`) : weekLabel(id)]));
  }
  return el('section', { class: 'digest-weeks' }, [el('h2', {}, ['Weeks in this piece']), list]);
}

function renderMonthly(
  root: HTMLElement,
  piece: MonthlyPiece,
  entry: DigestMonth,
  weeks: DigestWeek[],
  months: DigestMonth[],
): void {
  root.replaceChildren();
  const title = `Trends, ${monthLabel(piece.month)}`;
  document.title = `${title} · AI Regulation Map`;
  root.append(
    el('h1', { class: 'doc-title' }, [title]),
    el('p', { class: 'doc-subtitle' }, [trendSubtitle(piece)]),
    renderMonthlyMeta(piece, entry),
  );
  if (piece.calibrationBreaks.length) root.append(renderBreaks(piece.calibrationBreaks));
  if (piece.lead) root.append(el('p', { class: 'digest-lead' }, [piece.lead]));

  piece.charts.forEach((chart, i) => root.append(renderFigure(chart, i)));
  for (const section of piece.sections) root.append(renderSection(section));
  if (piece.drift) root.append(renderDrift(piece.drift));
  if (piece.weeks.length) root.append(renderPieceWeeks(piece.weeks, weeks));

  root.append(renderMonths(months, piece.month));
  if (weeks.length) root.append(renderWeeks(weeks, ''));
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

async function showMonth(
  root: HTMLElement,
  entry: DigestMonth,
  weeks: DigestWeek[],
  months: DigestMonth[],
): Promise<void> {
  let piece: MonthlyPiece;
  try {
    piece = parseMonthly(await fetchJson(`${DIGEST_BASE}${entry.file}`));
  } catch {
    const label = monthLabel(entry.month);
    root.replaceChildren(
      el('h1', { class: 'doc-title' }, [`Trends, ${label}`]),
      el('p', { class: 'doc-subtitle' }, [`The trend piece for ${label} could not be loaded.`]),
    );
    if (months.length > 1) root.append(renderMonths(months, entry.month));
    if (weeks.length) root.append(renderWeeks(weeks, ''));
    return;
  }
  renderMonthly(root, piece, entry, weeks, months);
}

async function main(): Promise<void> {
  initTheme();
  const root = document.getElementById('digest');
  if (!root) return;

  const index = await fetchJson(`${DIGEST_BASE}index.json`);
  const weeks = parseDigestIndex(index);
  const months = parseMonthIndex(index);
  const params = new URLSearchParams(location.search);
  const view = pickView(weeks, months, params.get('week'), params.get('month'));
  if (!view) {
    renderEmpty(root, 'No digest has been published yet.');
    return;
  }
  if (view.kind === 'monthly') {
    await showMonth(root, view.month, weeks, months);
    return;
  }

  const { week } = view;
  let digest: Digest;
  try {
    digest = parseDigest(await fetchJson(`${DIGEST_BASE}${week.file}`));
  } catch {
    renderEmpty(root, `The digest for ${weekLabel(week.week)} could not be loaded.`);
    return;
  }
  renderDigest(root, digest, weeks, months, week.week === weeks[0]?.week);
}

main();
