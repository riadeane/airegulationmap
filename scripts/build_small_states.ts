// Representative points for small states (#104). The map draws the 1:110m
// world atlas (public/data/countries-110m.json), which has no shape for
// about thirty scored countries. This script lists every country in
// public/scores.csv whose ISO numeric (public/data/country_iso.json) has no
// geometry in that atlas, and writes one [lon, lat] point per country to
// public/data/small_states.json. The map draws each point as a marker
// (src/map/smallStates.ts).
//
// Source: Natural Earth via world-atlas 2.0.2: countries-50m.json, and
// countries-10m.json for a country the 50m file also lacks (Tuvalu). Both
// are read here only; the app never loads them.
//
// Method: d3.geoCentroid of the country's largest polygon by spherical
// area. For a one-polygon state that is its centroid. For an archipelago
// the centroid of all its islands can fall in open sea (Kiribati's does),
// so its main island stands for it. ANCHORS overrides the choice where the
// largest island lies far from where the country lives: the polygon
// nearest the anchor is used instead.
//
// Run: npx tsx scripts/build_small_states.ts
//   --atlas-dir <dir>  read countries-50m.json and countries-10m.json from
//                      <dir> instead of fetching them from jsDelivr.
// Behind an HTTPS proxy, Node's fetch needs NODE_USE_ENV_PROXY=1.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { geoArea, geoCentroid, geoDistance } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryObject, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson';

import { parseScoresCsv } from '../src/data/loader';

export const ATLAS_VERSION = '2.0.2';
export const ATLAS_BASE = `https://cdn.jsdelivr.net/npm/world-atlas@${ATLAS_VERSION}`;

/** The atlases a point is taken from, most generalised first. */
export const SOURCE_ATLASES = ['50m', '10m'] as const;
export type AtlasScale = typeof SOURCE_ATLASES[number];

/**
 * Polygon choice overrides, by ISO numeric: use the polygon whose centroid
 * is nearest `near` rather than the largest.
 */
export const ANCHORS: Record<string, { near: [number, number]; why: string }> = {
  // Kiritimati, the largest atoll, lies about 3,300 km east of Tarawa.
  '296': { near: [172.98, 1.33], why: 'Tarawa, the capital atoll' },
};

export interface MissingCountry {
  name: string;
  id: string;
}

export interface SmallStateEntry {
  id: string;
  name: string;
  point: [number, number];
  atlas: AtlasScale;
}

type IsoFile = Record<string, { numeric: string | null }>;

function numericKey(id: string | number): string {
  return String(id).replace(/^0+(?=\d)/, '');
}

function countriesOf(atlas: Topology): Feature<Geometry, { name: string }>[] {
  const object = atlas.objects.countries as GeometryObject<{ name: string }>;
  return (feature(atlas, object) as FeatureCollection<Geometry, { name: string }>).features;
}

/**
 * Scored countries the atlas draws neither under their dataset name nor
 * under their ISO numeric, in scores.csv order. A country without an ISO
 * numeric (Kosovo) is checked by name only.
 */
export function missingFromAtlas(scored: readonly string[], iso: IsoFile, atlas: Topology): MissingCountry[] {
  const features = countriesOf(atlas);
  const names = new Set(features.map(f => f.properties.name));
  const ids = new Set(features.filter(f => f.id != null).map(f => numericKey(f.id!)));
  const out: MissingCountry[] = [];
  for (const name of scored) {
    if (names.has(name)) continue;
    const numeric = iso[name]?.numeric;
    if (!numeric) {
      throw new Error(`${name} is not in the 110m atlas and has no ISO numeric in country_iso.json`);
    }
    if (!ids.has(numericKey(numeric))) out.push({ name, id: numeric });
  }
  return out;
}

const round = (v: number): number => Math.round(v * 100) / 100;

/**
 * The point that stands for a country: the centroid of its largest polygon,
 * or of the polygon nearest `anchor` when one is given. Rounded to two
 * decimals (about 1 km).
 */
export function representativePoint(geometry: Polygon | MultiPolygon, anchor?: [number, number]): [number, number] {
  const polygons: Position[][][] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const candidates = polygons.map((coordinates) => {
    const polygon: Polygon = { type: 'Polygon', coordinates };
    return { area: geoArea(polygon), centroid: geoCentroid(polygon) };
  });
  const rank = anchor
    ? (c: typeof candidates[number]) => -geoDistance(c.centroid, anchor)
    : (c: typeof candidates[number]) => c.area;
  const best = candidates.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  return [round(best.centroid[0]), round(best.centroid[1])];
}

/**
 * One entry per missing country, sorted by name, each from the most
 * generalised atlas that has its shape. Throws when no atlas has it.
 */
export function buildSmallStates(
  missing: readonly MissingCountry[],
  atlases: Readonly<Record<AtlasScale, Topology>>
): SmallStateEntry[] {
  const byScale = SOURCE_ATLASES.map((scale) => {
    const index = new Map<string, Geometry>();
    for (const f of countriesOf(atlases[scale])) {
      if (f.id != null && f.geometry) index.set(numericKey(f.id), f.geometry);
    }
    return { scale, index };
  });
  const entries = missing.map(({ name, id }) => {
    for (const { scale, index } of byScale) {
      const geometry = index.get(numericKey(id));
      if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') continue;
      return { id, name, point: representativePoint(geometry, ANCHORS[id]?.near), atlas: scale };
    }
    throw new Error(`No atlas has a shape for ${name} (${id})`);
  });
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** The file body: one entry per line, so a regenerated file diffs cleanly. */
export function renderSmallStates(entries: readonly SmallStateEntry[]): string {
  const anchors = Object.entries(ANCHORS)
    .map(([id, a]) => `${entries.find(e => e.id === id)?.name ?? id} uses ${a.why}`)
    .join('; ');
  const head = {
    _comment: 'Representative points for the scored countries that have no shape in the 1:110m world atlas '
      + '(countries-110m.json). The map draws each as a point marker (src/map/smallStates.ts). '
      + 'Generated by scripts/build_small_states.ts; do not edit by hand.',
    source: `Natural Earth via world-atlas ${ATLAS_VERSION} (${ATLAS_BASE}/): countries-50m.json, `
      + 'and countries-10m.json for a country the 50m file lacks (the atlas field).',
    method: 'd3.geoCentroid of the country\'s largest polygon by spherical area, '
      + `rounded to two decimals, as [longitude, latitude]. Override: ${anchors}.`,
    schema_version: 1,
  };
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const rows = entries.map((e, i) => `    ${JSON.stringify(e)}${i < entries.length - 1 ? ',' : ''}`);
  return ['{', ...lines, '  "countries": [', ...rows, '  ]', '}', ''].join('\n');
}

// ---------------------------------------------------------------------------
// CLI

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readAtlas(scale: AtlasScale, dir: string | null): Promise<Topology> {
  const file = `countries-${scale}.json`;
  if (dir) return JSON.parse(readFileSync(join(dir, file), 'utf8')) as Topology;
  const response = await fetch(`${ATLAS_BASE}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return (await response.json()) as Topology;
}

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--atlas-dir');
  const atlasDir = flag >= 0 ? process.argv[flag + 1] ?? null : null;
  const pub = join(REPO_ROOT, 'public');
  const scored = Object.keys(parseScoresCsv(readFileSync(join(pub, 'scores.csv'), 'utf8')));
  const iso = (JSON.parse(readFileSync(join(pub, 'data', 'country_iso.json'), 'utf8')) as { countries: IsoFile }).countries;
  const drawn = JSON.parse(readFileSync(join(pub, 'data', 'countries-110m.json'), 'utf8')) as Topology;

  const missing = missingFromAtlas(scored, iso, drawn);
  const [m50, m10] = await Promise.all(SOURCE_ATLASES.map(scale => readAtlas(scale, atlasDir)));
  const entries = buildSmallStates(missing, { '50m': m50, '10m': m10 });
  writeFileSync(join(pub, 'data', 'small_states.json'), renderSmallStates(entries));
  console.log(`build_small_states: wrote ${entries.length} points to public/data/small_states.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
