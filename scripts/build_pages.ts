// Static country pages: one HTML file per row of scores.csv, written to
// public/country/<slug>/index.html before `vite build` copies public/ to
// dist/. Each page is a self-contained reference entry: it needs no
// JavaScript and no data fetch. The only script on the page is the theme
// toggle shared with the docs pages.
//
// Also written: public/country/index.html (the alphabetical list),
// public/sitemap.xml, and public/data/country_slugs.json (slug -> name).
//
// Run: `npm run pages` (also runs as the npm `prebuild` step).
// The pure parts (models, template, sitemap) are exported for tests.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ATTRIBUTE_LABELS, LEGEND_ENDPOINTS } from '../src/constants';
import type { AttributeKey, DimensionKey } from '../src/constants';
import type { BlocsData } from '../src/data/blocs';
import { parseRegulationCsv, parseScoresCsv } from '../src/data/loader';
import type { RegulationData, RegulationEntry, ScoreData, ScoreEntry } from '../src/data/loader';
import { countryPagePath, countrySlug } from '../src/data/slug';
import { classifySources } from '../src/data/sources';
import type { ClassifiedSource } from '../src/data/sources';
import { evidenceSentence } from '../src/data/evidence';
import { DIMENSION_TO_SNAKE, SUBSCORE_LABELS, normalizeSubscores } from '../src/data/subscores';
import type { SubscoreEntry, SubscoresData } from '../src/data/subscores';
import { cleanRegulationText } from '../src/panel/normalize';

export const SITE_ORIGIN = 'https://airegulationmap.org';

/** Top-level pages listed in the sitemap next to the country pages. */
export const TOP_LEVEL_PATHS = [
  '/',
  '/methodology.html',
  '/data.html',
  '/api-docs.html',
  '/changes.html',
  '/drift.html',
  '/country/',
];

const DIMENSIONS: DimensionKey[] = [
  'regulationStatus',
  'policyLever',
  'governanceType',
  'actorInvolvement',
  'enforcementLevel',
];

const DESCRIPTIVE_DIMENSIONS = new Set<DimensionKey>(['governanceType', 'actorInvolvement']);

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export interface IsoCodes {
  iso2: string;
  iso3: string;
  numeric: string | null;
}

export interface BlocPeers {
  code: string;
  name: string;
  peers: string[];
}

export interface PageLink {
  name: string;
  slug: string;
}

export interface CountryPageModel {
  name: string;
  slug: string;
  iso: IsoCodes | null;
  score: ScoreEntry;
  regulation: RegulationEntry | null;
  subscores: SubscoreEntry | null;
  /** Maturity-index rank among scored countries; ties share a rank. */
  rank: { rank: number; total: number } | null;
  /** Official sources first, original order within each kind. */
  sources: ClassifiedSource[];
  blocs: BlocPeers[];
  prev: PageLink | null;
  next: PageLink | null;
}

export interface BuildInputs {
  scores: ScoreData;
  regulation: RegulationData;
  iso: Record<string, IsoCodes>;
  blocs: BlocsData;
  subscores: SubscoresData | null;
}

// ---------------------------------------------------------------------------
// Models

/** Official (government, legislature, regulator) sources first; the order within each kind is kept. */
export function orderSources(sources: ClassifiedSource[]): ClassifiedSource[] {
  return [
    ...sources.filter(s => s.kind === 'official'),
    ...sources.filter(s => s.kind !== 'official'),
  ];
}

// Same rule as the app's maturityRank selector: descending, ties share the
// rank of their first occurrence.
function rankTable(scores: ScoreData): Map<string, { rank: number; total: number }> {
  const values = Object.values(scores)
    .map(d => d.averageScore)
    .filter((v): v is number => v != null);
  const sortedDesc = [...values].sort((a, b) => b - a);
  const rankByValue = new Map<number, number>();
  sortedDesc.forEach((v, i) => { if (!rankByValue.has(v)) rankByValue.set(v, i + 1); });
  const out = new Map<string, { rank: number; total: number }>();
  for (const [name, entry] of Object.entries(scores)) {
    if (entry.averageScore != null) {
      out.set(name, { rank: rankByValue.get(entry.averageScore)!, total: values.length });
    }
  }
  return out;
}

const collator = new Intl.Collator('en');

/** One model per scores.csv row, in alphabetical order, with prev/next links set. */
export function buildModels(inputs: BuildInputs): CountryPageModel[] {
  const names = Object.keys(inputs.scores).sort(collator.compare);
  const slugs = new Map<string, string>();
  for (const name of names) {
    const slug = countrySlug(name);
    if (!slug) throw new Error(`Empty slug for country "${name}"`);
    const taken = slugs.get(slug);
    if (taken) throw new Error(`Slug collision: "${taken}" and "${name}" both map to "${slug}"`);
    slugs.set(slug, name);
  }

  const ranks = rankTable(inputs.scores);
  const blocEntries = Object.entries(inputs.blocs);

  const models = names.map((name): CountryPageModel => {
    const regulation = inputs.regulation[name] ?? null;
    return {
      name,
      slug: countrySlug(name),
      iso: inputs.iso[name] ?? null,
      score: inputs.scores[name],
      regulation,
      subscores: inputs.subscores?.countries[name] ?? null,
      rank: ranks.get(name) ?? null,
      sources: orderSources(classifySources(regulation?.sources)),
      blocs: blocEntries
        .filter(([, bloc]) => bloc.members.includes(name))
        .map(([code, bloc]) => ({
          code,
          name: bloc.name,
          peers: bloc.members.filter(m => m !== name && m in inputs.scores).sort(collator.compare),
        })),
      prev: null,
      next: null,
    };
  });

  models.forEach((m, i) => {
    const before = models[i - 1];
    const after = models[i + 1];
    m.prev = before ? { name: before.name, slug: before.slug } : null;
    m.next = after ? { name: after.name, slug: after.slug } : null;
  });
  return models;
}

// ---------------------------------------------------------------------------
// Template helpers

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatScore(value: number | null): string {
  if (value == null) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function mapLink(name: string): string {
  return `/?country=${encodeURIComponent(name)}`;
}

function compareLink(a: string, b: string): string {
  return `/?compare=${encodeURIComponent(`${a},${b}`)}`;
}

function dataAsOf(model: CountryPageModel): string | null {
  return model.score.lastUpdated || model.regulation?.lastUpdated || null;
}

function confidenceLabel(model: CountryPageModel): string | null {
  const raw = model.regulation?.confidence?.trim().toLowerCase();
  return raw ? CONFIDENCE_LABELS[raw] ?? null : null;
}

/** The panel's evidence sentence as plain text; null without a run record. */
function evidenceLine(model: CountryPageModel): string | null {
  const record = model.subscores?.evidence;
  return record ? evidenceSentence(record).text : null;
}

/** The one-paragraph summary used for the meta description and Open Graph. */
export function pageDescription(model: CountryPageModel): string {
  const parts = [`AI regulation in ${model.name} on six dimensions`];
  if (model.score.averageScore != null) {
    let maturity = `maturity index ${formatScore(model.score.averageScore)} of 5`;
    if (model.rank) maturity += ` (rank ${model.rank.rank} of ${model.rank.total})`;
    parts.push(maturity);
  }
  const asOf = dataAsOf(model);
  let text = parts.join(': ') + '. Scores, key legislation and sources';
  text += asOf ? `, as of ${asOf}.` : '.';
  return text;
}

/** Schema.org Dataset markup with the six scores as variableMeasured. */
export function jsonLd(model: CountryPageModel): Record<string, unknown> {
  const url = SITE_ORIGIN + countryPagePath(model.name);
  const variableMeasured = (Object.keys(ATTRIBUTE_LABELS) as AttributeKey[])
    .map(key => ({ key, value: model.score[key] }))
    .filter(({ value }) => value != null)
    .map(({ key, value }) => ({
      '@type': 'PropertyValue',
      name: ATTRIBUTE_LABELS[key],
      value,
      minValue: 1,
      maxValue: 5,
      description: `1 = ${LEGEND_ENDPOINTS[key][0]}, 5 = ${LEGEND_ENDPOINTS[key][1]}`,
    }));
  const asOf = dataAsOf(model);
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `AI regulation scores: ${model.name}`,
    description: pageDescription(model),
    url,
    identifier: url,
    inLanguage: 'en',
    isAccessibleForFree: true,
    creator: { '@type': 'Person', name: 'Ria Deane' },
    isPartOf: { '@type': 'Dataset', name: 'AI Regulation Map', url: `${SITE_ORIGIN}/` },
    ...(asOf ? { dateModified: asOf } : {}),
    spatialCoverage: {
      '@type': 'Country',
      name: model.name,
      ...(model.iso ? { identifier: model.iso.iso2 } : {}),
    },
    variableMeasured,
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE_ORIGIN}/scores.csv` },
      { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE_ORIGIN}/regulation_data.csv` },
    ],
  };
}

// `</script>` inside a JSON string would end the block early; escaping `<`
// keeps the JSON valid and the document well-formed.
function jsonLdScript(model: CountryPageModel): string {
  return JSON.stringify(jsonLd(model)).replace(/</g, '\\u003c');
}

// ---------------------------------------------------------------------------
// Page chrome shared by the country pages and the index

// Mirror of methodology.html: tokens trimmed to what these pages use, so a
// page renders correctly without the main bundle.
const STYLE = `
    :root {
      --brand-hue: 75;
      --radius: 8px;
      --radius-sm: 5px;
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);

      --bg:              oklch(15% 0.008 var(--brand-hue));
      --surface:         oklch(19% 0.009 var(--brand-hue));
      --surface-raised:  oklch(23% 0.010 var(--brand-hue));
      --border:          oklch(30% 0.013 var(--brand-hue));
      --border-subtle:   oklch(24% 0.010 var(--brand-hue));

      --text-primary:    oklch(92% 0.012 var(--brand-hue));
      --text-secondary:  oklch(72% 0.014 var(--brand-hue));
      --text-tertiary:   oklch(62% 0.014 var(--brand-hue));

      --accent:          oklch(76% 0.13 var(--brand-hue));
      --accent-muted:    oklch(76% 0.13 var(--brand-hue) / 0.14);

      color-scheme: dark;
    }

    @media (prefers-color-scheme: light) {
      :root:not([data-theme]) {
        --bg:              oklch(98% 0.003 80);
        --surface:         oklch(99.5% 0.002 80);
        --surface-raised:  oklch(100% 0 0);
        --border:          oklch(88% 0.008 80);
        --border-subtle:   oklch(94% 0.004 80);
        --text-primary:    oklch(20% 0.013 80);
        --text-secondary:  oklch(42% 0.014 80);
        --text-tertiary:   oklch(52% 0.014 80);
        --accent:          oklch(48% 0.16 60);
        --accent-muted:    oklch(48% 0.16 60 / 0.10);
        color-scheme: light;
      }
    }

    :root[data-theme='light'] {
      --bg:              oklch(98% 0.003 80);
      --surface:         oklch(99.5% 0.002 80);
      --surface-raised:  oklch(100% 0 0);
      --border:          oklch(88% 0.008 80);
      --border-subtle:   oklch(94% 0.004 80);
      --text-primary:    oklch(20% 0.013 80);
      --text-secondary:  oklch(42% 0.014 80);
      --text-tertiary:   oklch(52% 0.014 80);
      --accent:          oklch(48% 0.16 60);
      --accent-muted:    oklch(48% 0.16 60 / 0.10);
      color-scheme: light;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Geist', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text-primary);
      line-height: 1.65;
      font-size: 15px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
    a:hover { filter: brightness(1.1); }

    header.site-header {
      padding: 18px 32px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: baseline;
      gap: 16px;
      flex-wrap: wrap;
    }

    header.site-header a.site-title {
      font-family: 'Literata', Georgia, serif;
      font-size: 1.15rem;
      font-weight: 500;
      color: var(--text-primary);
      text-decoration: none;
      letter-spacing: -0.005em;
    }

    header.site-header a.site-title:hover { color: var(--accent); }

    header.site-header nav.breadcrumb {
      color: var(--text-tertiary);
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    header.site-header nav.breadcrumb a { color: var(--text-tertiary); text-decoration: none; }
    header.site-header nav.breadcrumb a:hover { color: var(--accent); }
    header.site-header nav.breadcrumb span { color: var(--text-primary); }
    header.site-header nav.breadcrumb .sep { color: var(--text-tertiary); margin: 0 6px; }

    .header-links {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 0.8rem;
    }
    .header-links a { color: var(--text-secondary); }

    .theme-toggle {
      background: none;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      cursor: pointer;
      padding: 4px 6px;
      line-height: 0;
      align-self: center;
    }
    .theme-toggle:hover { color: var(--text-primary); border-color: var(--accent); }
    .theme-icon { width: 15px; height: 15px; }
    .theme-icon-sun { display: none; }
    :root[data-theme='dark'] .theme-icon-sun { display: inline; }
    :root[data-theme='dark'] .theme-icon-moon { display: none; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme]) .theme-icon-sun { display: inline; }
      :root:not([data-theme]) .theme-icon-moon { display: none; }
    }

    main.doc {
      max-width: 68ch;
      margin: 48px auto 96px;
      padding: 0 28px;
    }

    .entry-kicker {
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      margin-bottom: 10px;
    }

    h1.doc-title {
      font-family: 'Literata', Georgia, serif;
      font-size: 2.1rem;
      font-weight: 400;
      line-height: 1.15;
      letter-spacing: -0.012em;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .entry-codes {
      font-family: 'Geist Mono', 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      letter-spacing: 0.04em;
      color: var(--text-tertiary);
      margin-bottom: 6px;
    }
    .entry-codes abbr { text-decoration: none; }

    .entry-meta {
      font-size: 0.8rem;
      color: var(--text-tertiary);
      margin-bottom: 18px;
    }

    /* Evidence coverage: the second line of the record, as in the panel. */
    .entry-meta:has(+ .entry-evidence) { margin-bottom: 2px; }
    .entry-evidence {
      font-size: 0.8rem;
      color: var(--text-tertiary);
      margin-bottom: 18px;
    }

    .entry-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      align-items: center;
      margin-bottom: 40px;
      font-size: 0.85rem;
    }

    .btn {
      display: inline-block;
      padding: 7px 14px;
      border: 1px solid var(--accent);
      border-radius: var(--radius-sm);
      color: var(--accent);
      background: var(--accent-muted);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      text-decoration: none;
    }
    .btn:hover { background: var(--accent); color: var(--bg); filter: none; }

    h2 {
      font-family: 'Literata', Georgia, serif;
      font-size: 1.35rem;
      font-weight: 500;
      letter-spacing: -0.005em;
      color: var(--text-primary);
      margin: 44px 0 10px;
      scroll-margin-top: 24px;
    }

    h2 .dim-score {
      font-family: 'Geist Mono', 'JetBrains Mono', monospace;
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--accent);
      margin-left: 10px;
      font-variant-numeric: tabular-nums;
    }

    h3 {
      font-family: 'Geist', -apple-system, sans-serif;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      margin: 24px 0 8px;
    }

    p { color: var(--text-secondary); margin-bottom: 14px; }
    p strong { color: var(--text-primary); font-weight: 500; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
      margin: 14px 0 20px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      overflow: hidden;
    }
    caption {
      text-align: left;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      padding: 0 0 8px;
    }
    th, td {
      text-align: left;
      vertical-align: top;
      padding: 10px 14px;
      border-top: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }
    thead th {
      border-top: 0;
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      font-weight: 600;
    }
    tbody th { font-weight: 500; color: var(--text-primary); white-space: nowrap; }
    td.num {
      font-family: 'Geist Mono', 'JetBrains Mono', monospace;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    td.scale { color: var(--text-tertiary); font-size: 0.82rem; }
    td.rationale { font-size: 0.85rem; line-height: 1.5; }

    table.subscores { font-size: 0.85rem; margin-top: 4px; }
    table.subscores th, table.subscores td { padding: 7px 12px; }

    ol.sources { padding-left: 22px; color: var(--text-secondary); margin-bottom: 14px; }
    ol.sources li { margin-bottom: 8px; overflow-wrap: anywhere; }
    .source-tag {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--accent-muted);
      color: var(--accent);
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      vertical-align: middle;
    }

    .peer-list { line-height: 1.9; }

    nav.entry-nav {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-top: 56px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
    }
    nav.entry-nav a { text-decoration: none; }
    nav.entry-nav a:hover { text-decoration: underline; }

    ul.country-list {
      list-style: none;
      columns: 2;
      column-gap: 32px;
      margin: 24px 0;
    }
    ul.country-list li { margin-bottom: 6px; break-inside: avoid; }
    ul.country-list a { text-decoration: none; color: var(--text-primary); }
    ul.country-list a:hover { color: var(--accent); }
    ul.country-list .num {
      font-family: 'Geist Mono', 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      color: var(--text-tertiary);
      margin-left: 8px;
    }

    footer.site-footer {
      border-top: 1px solid var(--border);
      padding: 24px 32px;
      color: var(--text-tertiary);
      font-size: 0.8rem;
      text-align: center;
    }
    footer.site-footer p { color: var(--text-tertiary); margin-bottom: 6px; }

    @media (max-width: 600px) {
      header.site-header { padding: 14px 16px; }
      main.doc { padding: 0 16px; margin-top: 28px; }
      h1.doc-title { font-size: 1.7rem; }
      ul.country-list { columns: 1; }
      th, td { padding: 8px 10px; }
      th.scale, td.scale { display: none; }
    }

    @media print {
      body { background: white; color: black; font-size: 11pt; }
      header.site-header, footer.site-footer, .entry-actions, nav.entry-nav { display: none; }
      main.doc { max-width: none; margin: 0; padding: 0; }
      h1.doc-title, h2, h3, tbody th { color: black; }
      p, li, td { color: #222; }
      a { color: black; text-decoration: none; }
      td.num, h2 .dim-score { color: black; }
      table { border-color: #bbb; }
      th, td { border-color: #ddd; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }

    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
      border-radius: var(--radius-sm);
    }
`;

// Resolve theme before paint: URL > localStorage > prefers-color-scheme.
const THEME_BOOT_SCRIPT = `
    (function () {
      try {
        var urlTheme = new URLSearchParams(location.search).get('theme');
        if (urlTheme === 'light' || urlTheme === 'dark') {
          document.documentElement.setAttribute('data-theme', urlTheme);
          return;
        }
        var t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') {
          document.documentElement.setAttribute('data-theme', t);
        }
      } catch (e) { /* storage blocked */ }
    })();
`;

const THEME_TOGGLE_SCRIPT = `
    (function () {
      var toggle = document.getElementById('theme-toggle');
      if (!toggle) return;
      toggle.addEventListener('click', function () {
        var root = document.documentElement;
        var current = root.getAttribute('data-theme')
          || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        var next = current === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked */ }
      });
    })();
`;

const THEME_TOGGLE_BUTTON = `<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch theme" title="Switch theme">
        <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/>
        </svg>
        <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>`;

interface ShellOptions {
  title: string;
  description: string;
  path: string;
  breadcrumb: string;
  /** Extra <head> markup (JSON-LD, Open Graph type overrides). */
  head?: string;
  body: string;
}

function shell(o: ShellOptions): string {
  const url = SITE_ORIGIN + o.path;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(o.title)}</title>

  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="canonical" href="${escapeHtml(url)}">
  <link rel="alternate" type="application/atom+xml" title="AI Regulation Map: weekly changes" href="/digest/feed.xml">

  <meta name="description" content="${escapeHtml(o.description)}">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AI Regulation Map">
  <meta property="og:title" content="${escapeHtml(o.title)}">
  <meta property="og:description" content="${escapeHtml(o.description)}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${escapeHtml(url)}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(o.title)}">
  <meta name="twitter:description" content="${escapeHtml(o.description)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png">

  <meta name="theme-color" content="#16130f" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#fefdfc" media="(prefers-color-scheme: light)">
${o.head ?? ''}
  <script>${THEME_BOOT_SCRIPT}  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,500;1,7..72,400&amp;family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@400;500&amp;display=swap" rel="stylesheet">

  <style>${STYLE}  </style>
</head>
<body>
  <header class="site-header">
    <a class="site-title" href="/">AI Regulation Map</a>
    <nav class="breadcrumb" aria-label="Breadcrumb">${o.breadcrumb}</nav>
    <div class="header-links">
      <a href="/methodology.html">Methodology</a>
      <a href="/data.html">Data &amp; API</a>
      ${THEME_TOGGLE_BUTTON}
    </div>
  </header>

  <main class="doc">
${o.body}
  </main>

  <footer class="site-footer">
    <p>Scores are inferred by an automated research pipeline and refreshed weekly. Read the <a href="/methodology.html">methodology</a> before you cite them.</p>
    <p><a href="/">&larr; Back to the map</a> &nbsp;&middot;&nbsp; <a href="/country/">All countries</a> &nbsp;&middot;&nbsp; <a href="/data.html">Data &amp; API</a></p>
  </footer>

  <script>${THEME_TOGGLE_SCRIPT}  </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Country page

function renderScoresTable(model: CountryPageModel): string {
  const rows = (Object.keys(ATTRIBUTE_LABELS) as AttributeKey[]).map(key => {
    const [low, high] = LEGEND_ENDPOINTS[key];
    const descriptive = DESCRIPTIVE_DIMENSIONS.has(key as DimensionKey);
    const label = escapeHtml(ATTRIBUTE_LABELS[key]) + (descriptive ? ' <small>(descriptive)</small>' : '');
    return `        <tr>
          <th scope="row">${label}</th>
          <td class="num">${formatScore(model.score[key])}</td>
          <td class="scale">1 = ${escapeHtml(low)}, 5 = ${escapeHtml(high)}</td>
        </tr>`;
  });
  return `      <table>
        <caption>Six dimensions, scored 1 to 5</caption>
        <thead>
          <tr><th scope="col">Dimension</th><th scope="col">Score</th><th scope="col" class="scale">Scale</th></tr>
        </thead>
        <tbody>
${rows.join('\n')}
        </tbody>
      </table>`;
}

function renderSubscores(model: CountryPageModel, key: DimensionKey): string {
  const snake = DIMENSION_TO_SNAKE[key];
  const block = model.subscores?.[snake];
  if (!block) return '';
  const cells = SUBSCORE_LABELS[snake]
    .map(([id, label]) => ({ label, cell: block[id] }))
    .filter((c): c is { label: string; cell: NonNullable<typeof c.cell> } => c.cell != null);
  if (cells.length === 0) return '';
  const withRationale = cells.some(c => c.cell.rationale);
  const rows = cells.map(({ label, cell }) => {
    const rationale = withRationale
      ? `<td class="rationale">${cell.rationale ? escapeHtml(cell.rationale) : ''}</td>`
      : '';
    return `          <tr><th scope="row">${escapeHtml(label)}</th><td class="num">${formatScore(cell.score)}</td>${rationale}</tr>`;
  });
  const assessed = model.subscores?.date ? ` (assessed ${escapeHtml(model.subscores.date)})` : '';
  const head = withRationale
    ? '<tr><th scope="col">Sub-indicator</th><th scope="col">Score</th><th scope="col">Rationale</th></tr>'
    : '<tr><th scope="col">Sub-indicator</th><th scope="col">Score</th></tr>';
  return `      <table class="subscores">
        <caption>Sub-indicators${assessed}</caption>
        <thead>
          ${head}
        </thead>
        <tbody>
${rows.join('\n')}
        </tbody>
      </table>`;
}

function renderDimensionSections(model: CountryPageModel): string {
  return DIMENSIONS.map(key => {
    const text = cleanRegulationText(model.regulation?.[key]);
    const subscores = renderSubscores(model, key);
    if (!text && !subscores) return '';
    const id = DIMENSION_TO_SNAKE[key].replace('_', '-');
    const score = model.score[key];
    const scoreTag = score != null ? ` <span class="dim-score">${formatScore(score)}</span>` : '';
    const body = text ? `      <p>${escapeHtml(text)}</p>\n` : '';
    return `      <section id="${id}" aria-labelledby="${id}-heading">
      <h2 id="${id}-heading">${escapeHtml(ATTRIBUTE_LABELS[key])}${scoreTag}</h2>
${body}${subscores ? subscores + '\n' : ''}      </section>`;
  }).filter(Boolean).join('\n');
}

function renderSources(model: CountryPageModel): string {
  if (model.sources.length === 0) return '';
  const items = model.sources.map(s => {
    const tag = s.kind === 'official' ? ' <span class="source-tag">official</span>' : '';
    return `        <li><a href="${escapeHtml(s.url)}" rel="noopener noreferrer">${escapeHtml(s.url)}</a>${tag}</li>`;
  });
  const official = model.sources.filter(s => s.kind === 'official').length;
  const note = official > 0
    ? `${official} of ${model.sources.length} sources are official (government, legislature or regulator) and are listed first.`
    : 'No official (government, legislature or regulator) source is cited for this entry.';
  return `      <section id="sources" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources</h2>
      <p>${escapeHtml(note)}</p>
      <ol class="sources">
${items.join('\n')}
      </ol>
      </section>`;
}

function renderPeers(model: CountryPageModel): string {
  const blocs = model.blocs.filter(b => b.peers.length > 0);
  if (blocs.length === 0) {
    return `      <section id="compare" aria-labelledby="compare-heading">
      <h2 id="compare-heading">Compare with peers</h2>
      <p>${escapeHtml(model.name)} is not a member of a bloc tracked on the map. Open the map to compare it with any country.</p>
      </section>`;
  }
  const groups = blocs.map(b => {
    const links = b.peers.map(peer =>
      `<a href="${escapeHtml(compareLink(model.name, peer))}" title="${escapeHtml(`Compare ${model.name} with ${peer} on the map`)}">${escapeHtml(peer)}</a>`
    );
    return `      <h3>${escapeHtml(b.name)}</h3>
      <p class="peer-list">${links.join(', ')}</p>`;
  });
  const membership = blocs.map(b => b.name).join(', ');
  return `      <section id="compare" aria-labelledby="compare-heading">
      <h2 id="compare-heading">Compare with peers</h2>
      <p>Bloc membership: ${escapeHtml(membership)}. Each link opens a side-by-side comparison with ${escapeHtml(model.name)} on the map.</p>
${groups.join('\n')}
      </section>`;
}

function renderEntryNav(model: CountryPageModel): string {
  const prev = model.prev
    ? `<a rel="prev" href="/country/${model.prev.slug}/">&larr; ${escapeHtml(model.prev.name)}</a>`
    : '<span></span>';
  const next = model.next
    ? `<a rel="next" href="/country/${model.next.slug}/">${escapeHtml(model.next.name)} &rarr;</a>`
    : '<span></span>';
  return `      <nav class="entry-nav" aria-label="Countries in alphabetical order">
        ${prev}
        <a href="/country/">All countries</a>
        ${next}
      </nav>`;
}

/** The whole country page as one HTML document. */
export function renderCountryPage(model: CountryPageModel): string {
  const asOf = dataAsOf(model);
  const confidence = confidenceLabel(model);
  const official = model.sources.filter(s => s.kind === 'official').length;

  const meta: string[] = [];
  if (confidence) meta.push(escapeHtml(confidence));
  if (asOf) meta.push(`Data as of <time datetime="${escapeHtml(asOf)}">${escapeHtml(asOf)}</time>`);
  if (model.sources.length > 0) {
    meta.push(`${model.sources.length} source${model.sources.length === 1 ? '' : 's'}${official > 0 ? `, ${official} official` : ''}`);
  }

  // Plain text: the page has no Policy Initiatives section to link to.
  const evidence = evidenceLine(model);
  const evidenceHtml = evidence ? `      <p class="entry-evidence">${escapeHtml(evidence)}</p>\n` : '';

  const codes = model.iso
    ? `      <p class="entry-codes"><abbr title="ISO 3166-1 alpha-2">${escapeHtml(model.iso.iso2)}</abbr> &middot; <abbr title="ISO 3166-1 alpha-3">${escapeHtml(model.iso.iso3)}</abbr>${model.iso.numeric ? ` &middot; <abbr title="ISO 3166-1 numeric">${escapeHtml(model.iso.numeric)}</abbr>` : ''}</p>\n`
    : '';

  const maturity = model.score.averageScore != null
    ? `      <p>Maturity index <strong>${formatScore(model.score.averageScore)}</strong> of 5${model.rank ? `, rank ${model.rank.rank} of ${model.rank.total}` : ''}. The index is the mean of regulation status, policy lever and enforcement level. Governance type and actor involvement describe how ${escapeHtml(model.name)} governs and do not enter the index.</p>`
    : `      <p>No maturity index is available for ${escapeHtml(model.name)}.</p>`;

  const laws = cleanRegulationText(model.regulation?.specificLaws);
  const lawsSection = laws
    ? `      <section id="legislation" aria-labelledby="legislation-heading">
      <h2 id="legislation-heading">Key legislation</h2>
      <p>${escapeHtml(laws)}</p>
      </section>`
    : '';

  const noEntry = !model.regulation
    ? `      <p>No detailed entry exists for ${escapeHtml(model.name)} yet.</p>`
    : '';

  const body = `    <article>
      <p class="entry-kicker">Country entry</p>
      <h1 class="doc-title">${escapeHtml(model.name)}</h1>
${codes}      <p class="entry-meta">${meta.join(' &middot; ')}</p>
${evidenceHtml}      <p class="entry-actions">
        <a class="btn" href="${escapeHtml(mapLink(model.name))}">Open on the map</a>
        <a href="/methodology.html">How scores are assigned</a>
      </p>

      <section id="scores" aria-labelledby="scores-heading">
      <h2 id="scores-heading">Scores</h2>
${maturity}
${renderScoresTable(model)}
      </section>
${noEntry}
${renderDimensionSections(model)}
${lawsSection}
${renderSources(model)}
${renderPeers(model)}
${renderEntryNav(model)}
    </article>`;

  return shell({
    title: `AI regulation in ${model.name} · AI Regulation Map`,
    description: pageDescription(model),
    path: countryPagePath(model.name),
    breadcrumb: `<a href="/country/">Countries</a><span class="sep" aria-hidden="true">/</span><span>${escapeHtml(model.name)}</span>`,
    head: `  <script type="application/ld+json">${jsonLdScript(model)}</script>\n`,
    body: body.replace(/\n{3,}/g, '\n\n'),
  });
}

// ---------------------------------------------------------------------------
// Country index, sitemap, slug map

/** The alphabetical list at /country/. */
export function renderCountryIndex(models: CountryPageModel[]): string {
  const items = models.map(m =>
    `        <li><a href="/country/${m.slug}/">${escapeHtml(m.name)}</a><span class="num">${m.score.averageScore != null ? m.score.averageScore.toFixed(2) : 'n/a'}</span></li>`
  );
  const body = `    <p class="entry-kicker">Reference</p>
    <h1 class="doc-title">Countries</h1>
    <p>One entry per country: scores on six dimensions, the regulatory posture in prose, key legislation and sources. The number beside each name is the maturity index out of 5.</p>
    <ul class="country-list">
${items.join('\n')}
    </ul>`;
  return shell({
    title: 'Countries · AI Regulation Map',
    description: `AI regulation entries for ${models.length} countries: scores on six dimensions, key legislation and sources, one stable page per country.`,
    path: '/country/',
    breadcrumb: '<span>Countries</span>',
    body,
  });
}

export function buildSitemap(models: CountryPageModel[]): string {
  const top = TOP_LEVEL_PATHS.map(p => `  <url><loc>${SITE_ORIGIN}${p}</loc></url>`);
  const pages = models.map(m => {
    const asOf = dataAsOf(m);
    const lastmod = asOf ? `<lastmod>${escapeHtml(asOf)}</lastmod>` : '';
    return `  <url><loc>${SITE_ORIGIN}${countryPagePath(m.name)}</loc>${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...top, ...pages].join('\n')}
</urlset>
`;
}

export function buildSlugMap(models: CountryPageModel[]): Record<string, unknown> {
  return {
    _comment: 'Slug -> canonical country name for the static pages at /country/<slug>/. Generated by scripts/build_pages.ts from scores.csv; do not edit by hand.',
    schema_version: 1,
    slugs: Object.fromEntries(models.map(m => [m.slug, m.name])),
  };
}

// ---------------------------------------------------------------------------
// CLI

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function loadInputs(root: string = REPO_ROOT): BuildInputs {
  const pub = join(root, 'public');
  const isoFile = readJson<{ countries: Record<string, IsoCodes> }>(join(pub, 'data', 'country_iso.json'));
  const blocsFile = readJson<Record<string, unknown>>(join(pub, 'data', 'blocs.json'));
  delete blocsFile._comment;
  const subscoresPath = join(pub, 'data', 'subscores.json');
  return {
    scores: parseScoresCsv(readFileSync(join(pub, 'scores.csv'), 'utf8')),
    regulation: parseRegulationCsv(readFileSync(join(pub, 'regulation_data.csv'), 'utf8')),
    iso: isoFile.countries,
    blocs: blocsFile as unknown as BlocsData,
    subscores: existsSync(subscoresPath) ? normalizeSubscores(readJson(subscoresPath)) : null,
  };
}

function main(): void {
  const models = buildModels(loadInputs());
  const pub = join(REPO_ROOT, 'public');
  const countryDir = join(pub, 'country');

  // Generated output only: remove stale slugs from a previous build.
  rmSync(countryDir, { recursive: true, force: true });
  for (const model of models) {
    const dir = join(countryDir, model.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderCountryPage(model));
  }
  writeFileSync(join(countryDir, 'index.html'), renderCountryIndex(models));
  writeFileSync(join(pub, 'sitemap.xml'), buildSitemap(models));
  writeFileSync(
    join(pub, 'data', 'country_slugs.json'),
    JSON.stringify(buildSlugMap(models), null, 2) + '\n'
  );
  console.log(`build_pages: wrote ${models.length} country pages, the country index, sitemap.xml and country_slugs.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
