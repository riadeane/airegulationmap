// The drift dashboard (drift.html entry): how much the dataset moved on
// each research run and how confident it is, as small multiples plus a
// latest-run table. Reads the committed files (history.json for score
// movement, regulation_data.csv for confidence, data/drift.json for the
// gold-set check, data/blocs.json for the bloc grid) and, when the build
// is configured for it, research_runs from Supabase for the run's
// provenance and gate tally. Every source degrades: a missing file leaves
// its figure with an empty state, never a broken page.
//
// Everything is built with DOM nodes, never innerHTML, except the chart
// tooltips, which escape their inputs (charts/drift.ts).

import { initTheme } from './controls/theme';
import { createTooltip } from './map/tooltip';
import { onThemeChange } from './map/cssColors';
import { loadHistory } from './data/history';
import { loadRegulation } from './data/loader';
import { loadBlocs } from './data/blocs';
import { restGet } from './data/supabase';
import { countryHref } from './data/digest';
import { formatSignedDelta } from './data/changelog';
import {
  CONFIDENCE_LEVELS,
  DIMENSIONS,
  WARN_WITHIN_ONE,
  binDeltas,
  computeBlocDrift,
  computeWeeklyChanges,
  confidenceByVintage,
  confidenceTotals,
  dimensionLabel,
  largestMoves,
  latestResearchRun,
  latestWeek,
  parseDriftChecks,
  percent,
  snakeDimensionLabel,
  summarizeDeltas,
} from './data/drift';
import type {
  BlocDrift,
  ConfidenceCohort,
  DriftCheck,
  ResearchRun,
  ScoreMove,
  WeekChanges,
} from './data/drift';
import {
  formatDate,
  readPalette,
  renderBlocChart,
  renderChangesChart,
  renderConfidenceChart,
  renderDeltaChart,
  renderGoldChart,
} from './charts/drift';
import type { LegendItem, Palette } from './charts/drift';

// ---------------------------------------------------------------------------
// DOM helpers (same shape as changes.ts).

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

function link(href: string, text: string): HTMLAnchorElement {
  return el('a', { href }, [text]);
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

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Figures: title, plot, legend, caption with the key numbers, table twin.

interface TableSpec {
  head: string[];
  rows: (string | Node)[][];
}

interface FigureSpec {
  id: string;
  title: string;
  /** One line under the title: what the plot encodes. */
  subtitle: string;
  /** Null when there is nothing to plot: the empty-state text is shown instead. */
  render: ((host: HTMLElement, palette: Palette) => LegendItem[]) | null;
  empty?: string;
  caption: string;
  table: TableSpec | null;
}

function renderLegend(list: HTMLElement, items: LegendItem[]): void {
  list.replaceChildren();
  for (const item of items) {
    const key = el('span', { class: `legend-key legend-key-${item.kind}`, 'aria-hidden': 'true' });
    if (item.kind === 'ramp') {
      key.style.background = `linear-gradient(to right, ${item.from ?? item.color}, ${item.color})`;
    } else if (item.kind === 'line') {
      key.style.background = item.color;
    } else {
      key.style.background = item.color;
    }
    list.append(el('li', {}, [key, item.label]));
  }
}

function renderTable(spec: TableSpec): HTMLTableElement {
  const table = el('table', { class: 'chart-table' });
  const head = el('tr');
  for (const h of spec.head) head.append(el('th', { scope: 'col' }, [h]));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  for (const row of spec.rows) {
    const tr = el('tr');
    row.forEach((cell, i) => tr.append(el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : {}, [cell])));
    body.append(tr);
  }
  table.append(body);
  return table;
}

interface MountedFigure {
  spec: FigureSpec;
  plot: HTMLElement;
  legend: HTMLElement;
}

function mountFigure(spec: FigureSpec): { node: HTMLElement; mounted: MountedFigure } {
  const plot = el('div', { class: 'chart-plot' });
  const legend = el('ul', { class: 'chart-legend', 'aria-label': 'Legend' });
  const figure = el('figure', { class: 'chart', id: spec.id }, [
    el('h2', { class: 'chart-title' }, [spec.title]),
    el('p', { class: 'chart-subtitle' }, [spec.subtitle]),
  ]);
  if (spec.render) {
    figure.append(plot, legend, el('figcaption', {}, [spec.caption]));
  } else {
    // No plot: the empty state is the figure's text, so it doubles as the caption.
    figure.append(el('figcaption', { class: 'chart-empty' }, [spec.empty ?? spec.caption]));
  }
  if (spec.table && spec.table.rows.length > 0) {
    figure.append(el('details', { class: 'chart-details' }, [
      el('summary', {}, ['Show as a table']),
      renderTable(spec.table),
    ]));
  }
  return { node: figure, mounted: { spec, plot, legend } };
}

function drawFigure(mounted: MountedFigure, palette: Palette): void {
  if (!mounted.spec.render) return;
  renderLegend(mounted.legend, mounted.spec.render(mounted.plot, palette));
}

// ---------------------------------------------------------------------------
// Figure specs.

function changesFigure(weeks: WeekChanges[]): FigureSpec {
  const latest = latestWeek(weeks);
  const runs = weeks.length;
  const totalChanges = weeks.reduce((n, w) => n + w.changed, 0);
  const breaks = weeks.filter(w => w.recalibration);

  let caption: string;
  if (!latest) {
    caption = runs === 0
      ? 'No score history has been recorded yet.'
      : `${plural(runs, 'run')} recorded and no score has changed since the first assessment.`;
  } else {
    const parts = DIMENSIONS
      .filter(d => latest.byDimension[d] > 0)
      .map(d => `${dimensionLabel(d)} for ${latest.byDimension[d]}`);
    caption = `${formatDate(latest.date)}: ${plural(latest.changed, 'country', 'countries')} changed`
      + (parts.length ? ` (the dimension that moved most was ${joinList(parts)})` : '')
      + (latest.firstScored ? `; ${latest.firstScored} first scored` : '')
      + `. ${plural(runs, 'run')} since ${formatDate(weeks[0].date)}, ${plural(totalChanges, 'country change')} in all.`;
  }
  if (breaks.length) {
    caption += ` * Recalibration: ${breaks.map(b => `${formatDate(b.date)}, ${b.recalibration}`).join('; ')}.`;
  }

  return {
    id: 'changes',
    title: 'Countries changed per run',
    subtitle: 'Each changed country counted once, under the dimension that moved most; first assessments in grey.',
    render: weeks.length ? (host, palette) => renderChangesChart(host, weeks, palette) : null,
    empty: 'history.json is not available, so score movement cannot be shown.',
    caption,
    table: weeks.length ? {
      head: ['Run', 'Changed', ...DIMENSIONS.map(dimensionLabel), 'First scored', 'Note'],
      rows: weeks.map(w => [
        formatDate(w.date),
        String(w.changed),
        ...DIMENSIONS.map(d => String(w.byDimension[d])),
        String(w.firstScored),
        w.recalibration ? `Recalibration: ${w.recalibration}` : '',
      ]),
    } : null,
  };
}

function deltasFigure(weeks: WeekChanges[]): FigureSpec {
  const runs = weeks.filter(w => w.moves.length > 0);
  const latest = runs[runs.length - 1];
  const allMoves = runs.flatMap(w => w.moves);
  let caption: string;
  if (!latest) {
    caption = 'No dimension has moved yet, so there is no distribution to show.';
  } else {
    const s = summarizeDeltas(latest.moves);
    const all = allMoves.map(m => m.delta);
    caption = `${formatDate(latest.date)}: ${plural(s.count, 'dimension move')}, ${s.up} up and ${s.down} down; `
      + `median move ${s.medianAbs}, largest ${s.largestAbs}. `
      + `Across ${plural(runs.length, 'run')} the moves range from ${formatSignedDelta(Math.min(...all))} to ${formatSignedDelta(Math.max(...all))}.`;
  }
  const bins = [...new Set(allMoves.map(m => Math.round(m.delta * 4) / 4))].sort((a, b) => b - a);
  const perRun = runs.map(w => new Map(binDeltas(w.moves).map(b => [b.delta, b.count])));
  return {
    id: 'deltas',
    title: 'Distribution of score deltas per run',
    subtitle: 'Every dimension move, binned to the quarter point; darker cells hold more moves.',
    render: runs.length ? (host, palette) => renderDeltaChart(host, weeks, palette) : null,
    empty: 'No score has moved yet.',
    caption,
    table: runs.length ? {
      head: ['Delta', ...runs.map(w => formatDate(w.date))],
      rows: [
        ['Moves', ...runs.map(w => String(w.moves.length))],
        ...bins.map(bin => [formatSignedDelta(bin), ...perRun.map(counts => String(counts.get(bin) ?? 0))]),
      ],
    } : null,
  };
}

function confidenceFigure(cohorts: ConfidenceCohort[]): FigureSpec {
  const totals = confidenceTotals(cohorts);
  const latest = cohorts[cohorts.length - 1];
  const caption = cohorts.length === 0
    ? 'regulation_data.csv is not available, so confidence cannot be shown.'
    : `Of ${plural(totals.total, 'entry', 'entries')}: `
      + joinList(CONFIDENCE_LEVELS.map(l => `${totals.counts[l]} ${l} (${percent(totals.counts[l], totals.total)}%)`))
      + `. The ${plural(latest.total, 'entry', 'entries')} last updated on ${formatDate(latest.date)}: `
      + joinList(CONFIDENCE_LEVELS.map(l => `${percent(latest.counts[l], latest.total)}% ${l}`))
      + '.';
  return {
    id: 'confidence',
    title: 'Confidence by research vintage',
    subtitle: 'The confidence label of every entry, grouped by the run that last updated it. The files keep only the current label, so this is a cross-section by vintage, not a series.',
    render: cohorts.length ? (host, palette) => renderConfidenceChart(host, cohorts, palette) : null,
    empty: 'No confidence labels are available.',
    caption,
    table: cohorts.length ? {
      head: ['Run', 'Countries', 'High', 'Medium', 'Low'],
      rows: cohorts.map(c => [
        formatDate(c.date),
        String(c.total),
        ...CONFIDENCE_LEVELS.map(l => `${c.counts[l]} (${percent(c.counts[l], c.total)}%)`),
      ]),
    } : null,
  };
}

function goldFigure(checks: DriftCheck[], driftFileFound: boolean): FigureSpec {
  const latest = checks[checks.length - 1];
  const dims = latest ? Object.keys(latest.maeByDimension) : [];
  let caption: string;
  if (!latest) {
    caption = driftFileFound
      ? 'No gold-set check has been recorded yet. The first weekly run after the check shipped appends a row to drift.json.'
      : 'drift.json is not published, so there is no gold-set check to show.';
  } else {
    const worst = dims.reduce<string | null>((best, d) =>
      best === null || latest.maeByDimension[d] > latest.maeByDimension[best] ? d : best, null);
    caption = `Latest check, ${formatDate(latest.date)}${latest.model ? ` (${latest.model})` : ''}: `
      + `${Math.round(latest.withinOne * 100)}% of the compared sub-indicators are within one point of the gold scores `
      + `(warning below ${Math.round(WARN_WITHIN_ONE * 100)}%)`
      + (latest.maxDev != null
        ? `; largest deviation ${latest.maxDev}${latest.maxDevAt ? ` at ${latest.maxDevAt.country}, ${snakeDimensionLabel(latest.maxDevAt.dimension)}` : ''}`
        : '')
      + (worst ? `; mean absolute error highest for ${snakeDimensionLabel(worst)} (${latest.maeByDimension[worst].toFixed(2)})` : '')
      + `. ${plural(checks.length, 'check')} since ${formatDate(checks[0].date)}.`;
  }
  return {
    id: 'gold',
    title: 'Gold-set agreement per run',
    subtitle: 'The run’s raw scores for the ten hand-checked countries against the gold set: share within one point, then mean absolute error by dimension.',
    render: checks.length ? (host, palette) => renderGoldChart(host, checks, palette) : null,
    empty: caption,
    caption,
    table: checks.length ? {
      head: ['Run', 'Model', 'Prompt', 'Compared', 'Within one', 'Largest deviation', ...dims.map(snakeDimensionLabel)],
      rows: checks.map(c => [
        formatDate(c.date),
        c.model,
        c.promptVersion,
        String(c.countriesCompared),
        `${Math.round(c.withinOne * 100)}%`,
        c.maxDev == null ? '' : String(c.maxDev),
        ...dims.map(d => (d in c.maeByDimension ? c.maeByDimension[d].toFixed(2) : '')),
      ]),
    } : null,
  };
}

function blocFigure(blocs: BlocDrift[], weeks: WeekChanges[]): FigureSpec {
  const latest = latestWeek(weeks);
  let caption: string;
  if (blocs.length === 0) {
    caption = 'blocs.json is not available, so bloc membership cannot be shown.';
  } else if (!latest) {
    caption = 'No score has moved yet.';
  } else {
    caption = `${formatDate(latest.date)}: `
      + blocs.map(b => {
        const w = b.weeks.find(x => x.date === latest.date);
        return `${b.name} ${w?.changed ?? 0} of ${b.members} (${percent(w?.changed ?? 0, b.members)}%)`;
      }).join(', ')
      + '.';
  }
  return {
    id: 'blocs',
    title: 'Share of bloc members changed per run',
    subtitle: 'One row per bloc; darker cells mean a larger share of the bloc’s members moved.',
    render: blocs.length && weeks.length ? (host, palette) => renderBlocChart(host, blocs, palette) : null,
    empty: caption,
    caption,
    table: blocs.length && weeks.length ? {
      head: ['Bloc', ...weeks.map(w => formatDate(w.date))],
      rows: blocs.map(b => [`${b.name} (${b.members})`, ...b.weeks.map(w => `${w.changed} (${percent(w.changed, b.members)}%)`)]),
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Latest run.

function fact(dl: HTMLDListElement, term: string, value: string | Node): void {
  dl.append(el('dt', {}, [term]), el('dd', {}, [value]));
}

function renderRun(
  root: HTMLElement,
  run: ResearchRun | null,
  latestCheck: DriftCheck | null,
  latest: WeekChanges | null,
  moves: ScoreMove[],
): void {
  root.replaceChildren(el('h2', { id: 'latest-run' }, ['Latest run']));

  const dl = el('dl', { class: 'run-facts' });
  if (run) {
    fact(dl, 'Run date', formatDate(run.date) + (run.finished ? '' : ' (still running)'));
    fact(dl, 'Model', run.model ? el('code', {}, [run.model]) : 'not recorded');
    if (run.promptVersion) fact(dl, 'Prompt version', el('code', {}, [run.promptVersion]));
    fact(dl, 'Trigger', `${run.trigger || 'unknown'}${run.grounded ? ', evidence-grounded' : ''}`);
    fact(dl, 'Countries attempted', run.countriesAttempted == null ? 'not recorded' : String(run.countriesAttempted));
    fact(dl, 'Countries succeeded', run.countriesSucceeded == null ? 'not recorded' : String(run.countriesSucceeded));
    if (run.gate) {
      fact(dl, 'Gate: applied', `${run.gate.appliedEvidence + run.gate.appliedPersisted} (${run.gate.appliedEvidence} on evidence, ${run.gate.appliedPersisted} persisted)`);
      fact(dl, 'Gate: held', String(run.gate.held));
      fact(dl, 'Gate: unchanged', String(run.gate.unchanged));
    } else {
      fact(dl, 'Gate', 'no tally recorded for this run');
    }
    root.append(
      el('p', { class: 'run-source' }, ['From the ', el('code', {}, ['research_runs']), ' table of the ', link('/data.html#api', 'read-only API'), '.']),
      dl,
    );
  } else {
    if (latestCheck) {
      fact(dl, 'Run date', formatDate(latestCheck.date));
      if (latestCheck.model) fact(dl, 'Model', el('code', {}, [latestCheck.model]));
      if (latestCheck.promptVersion) fact(dl, 'Prompt version', el('code', {}, [latestCheck.promptVersion]));
    } else if (latest) {
      fact(dl, 'Last score movement', formatDate(latest.date));
    }
    root.append(
      el('p', { class: 'run-source' }, [
        'Run provenance (model, countries attempted and succeeded, gate tally) lives in the ',
        el('code', {}, ['research_runs']),
        ' table of the ',
        link('/data.html#api', 'read-only API'),
        '; this build is not configured to read it, so only what the published files record is shown.',
      ]),
    );
    if (dl.childElementCount) root.append(dl);
  }

  root.append(el('h3', {}, [latest ? `Ten largest moves, ${formatDate(latest.date)}` : 'Largest moves']));
  if (latest?.recalibration) {
    root.append(el('p', { class: 'run-note' }, [`This run was a recalibration (${latest.recalibration}): the moves below are a re-measurement, not policy change.`]));
  }
  if (moves.length === 0) {
    root.append(el('p', {}, ['No score has moved yet.']));
    return;
  }
  root.append(renderTable({
    head: ['Country', 'Dimension', 'From', 'To', 'Delta'],
    rows: moves.map(m => [
      link(countryHref(m.country), m.country),
      dimensionLabel(m.dimension),
      String(m.from),
      String(m.to),
      formatSignedDelta(m.delta),
    ]),
  }));
}

// ---------------------------------------------------------------------------
// Boot.

const RUNS_QUERY = 'research_runs?select=id,started_at,finished_at,trigger,model,prompt_version,grounded,countries_attempted,countries_succeeded,notes&order=started_at.desc&limit=10';

async function main(): Promise<void> {
  initTheme();
  createTooltip();
  const figuresRoot = document.getElementById('drift-figures');
  const runRoot = document.getElementById('drift-run');
  if (!figuresRoot || !runRoot) return;

  const [history, regulation, driftRaw, blocs, runsRaw] = await Promise.all([
    loadHistory(),
    loadRegulation().catch(() => null),
    fetchJson('/data/drift.json'),
    loadBlocs(),
    restGet(RUNS_QUERY),
  ]);

  const weeks = computeWeeklyChanges(history);
  const latest = latestWeek(weeks);
  const cohorts = confidenceByVintage(regulation);
  const checks = parseDriftChecks(driftRaw);
  const blocDrift = computeBlocDrift(weeks, blocs);
  const run = latestResearchRun(runsRaw);

  const specs = [
    changesFigure(weeks),
    deltasFigure(weeks),
    confidenceFigure(cohorts),
    goldFigure(checks, driftRaw !== null),
    blocFigure(blocDrift, weeks),
  ];
  figuresRoot.replaceChildren();
  const mounted: MountedFigure[] = [];
  for (const spec of specs) {
    const { node, mounted: m } = mountFigure(spec);
    figuresRoot.append(node);
    mounted.push(m);
  }

  const draw = (): void => {
    const palette = readPalette();
    for (const m of mounted) drawFigure(m, palette);
  };
  draw();
  onThemeChange(draw);
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(draw, 120);
  });

  renderRun(runRoot, run, checks[checks.length - 1] ?? null, latest, largestMoves(latest, 10));
}

main();
