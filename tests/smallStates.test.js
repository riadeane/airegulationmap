import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import {
  SMALL_STATE_RADIUS,
  normalizeSmallStates,
  smallStateFeatures,
  smallStateRadius,
} from '../src/map/smallStates';
import { resolveFeatureNames } from '../src/map/geometryNames';
import { isoNumericIndex } from '../src/data/countryIso';
import { parseScoresCsv } from '../src/data/loader';
import { missingFromAtlas, representativePoint } from '../scripts/build_small_states';

const read = path => readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8');
const readJson = path => JSON.parse(read(path));

describe('normalizeSmallStates', () => {
  it('keeps entries with an id, a name and a [lon, lat]', () => {
    const points = normalizeSmallStates({
      countries: [
        { id: '702', name: 'Singapore', point: [103.82, 1.36], atlas: '50m' },
        { id: '470', name: 'Malta', point: [14.44] },
        { id: '', name: 'Nowhere', point: [0, 0] },
        { id: '999', name: 'Off the globe', point: [200, 0] },
        null,
      ],
    });
    expect(points).toEqual([{ id: '702', name: 'Singapore', point: [103.82, 1.36] }]);
  });

  it('gives no points for a missing or malformed file', () => {
    expect(normalizeSmallStates(null)).toEqual([]);
    expect(normalizeSmallStates({ countries: {} })).toEqual([]);
  });
});

describe('smallStateFeatures', () => {
  const atlas = [
    { type: 'Feature', id: '276', properties: { name: 'Germany' }, geometry: null },
    { type: 'Feature', id: undefined, properties: { name: 'Kosovo' }, geometry: null },
  ];
  const byNumeric = { 702: 'Singapore', 276: 'Germany', 20: 'Andorra' };

  it('makes a Point feature named for the dataset for each country the atlas lacks', () => {
    const features = smallStateFeatures([
      { id: '702', name: 'Singapore (file)', point: [103.82, 1.36] },
      { id: '020', name: 'Andorra', point: [1.56, 42.54] },
    ], atlas, byNumeric);
    expect(features).toEqual([
      { type: 'Feature', id: '702', properties: { name: 'Singapore' }, geometry: { type: 'Point', coordinates: [103.82, 1.36] } },
      { type: 'Feature', id: '020', properties: { name: 'Andorra' }, geometry: { type: 'Point', coordinates: [1.56, 42.54] } },
    ]);
  });

  it('skips a country the atlas already draws, by id or by name, and duplicates', () => {
    const features = smallStateFeatures([
      { id: '276', name: 'Germany', point: [10, 51] },
      { id: '999', name: 'Kosovo', point: [21, 42.6] },
      { id: '20', name: 'Andorra', point: [1.56, 42.54] },
      { id: '020', name: 'Andorra', point: [1.56, 42.54] },
    ], atlas, byNumeric);
    expect(features.map(f => f.properties.name)).toEqual(['Andorra']);
  });
});

describe('smallStateRadius', () => {
  it('counter-scales the radius so the marker keeps its screen size', () => {
    expect(smallStateRadius(1)).toBe(SMALL_STATE_RADIUS);
    expect(smallStateRadius(4) * 4).toBe(SMALL_STATE_RADIUS);
    expect(smallStateRadius(0)).toBe(SMALL_STATE_RADIUS);
    expect(smallStateRadius(Number.NaN)).toBe(SMALL_STATE_RADIUS);
  });
});

describe('representativePoint (scripts/build_small_states.ts)', () => {
  // Clockwise rings, as world-atlas (and d3-geo's spherical polygons) wind
  // them; a counter-clockwise ring is the rest of the globe.
  const square = (lon, lat, size) => [[
    [lon, lat], [lon, lat + size], [lon + size, lat + size], [lon + size, lat], [lon, lat],
  ]];

  it('takes the centroid of the largest polygon, rounded to two decimals', () => {
    const geometry = { type: 'MultiPolygon', coordinates: [square(0, 0, 0.2), square(10, 10, 1)] };
    const [lon, lat] = representativePoint(geometry);
    expect(lon).toBeCloseTo(10.5, 2);
    expect(lat).toBeCloseTo(10.5, 1);
    expect(Number.isInteger(lon * 100)).toBe(true);
  });

  it('takes the polygon nearest an anchor when one is given', () => {
    const geometry = { type: 'MultiPolygon', coordinates: [square(0, 0, 0.2), square(10, 10, 1)] };
    const [lon, lat] = representativePoint(geometry, [0, 0]);
    expect(lon).toBeCloseTo(0.1, 2);
    expect(lat).toBeCloseTo(0.1, 2);
  });
});

// The data contract (#104): every scored country is on the map, as an atlas
// shape or as a small-state marker. A country added to scores.csv without
// either fails here; regenerate with `npx tsx scripts/build_small_states.ts`.
describe('map coverage of the dataset', () => {
  const scored = Object.keys(parseScoresCsv(read('scores.csv')));
  const isoRaw = readJson('data/country_iso.json');
  const byNumeric = isoNumericIndex(isoRaw);
  const topology = readJson('data/countries-110m.json');
  const smallStates = readJson('data/small_states.json');
  const points = normalizeSmallStates(smallStates);

  it('draws every scored country as a shape or a marker, joined as the renderer joins them', () => {
    const atlas = resolveFeatureNames(
      feature(topology, topology.objects.countries).features,
      new Set(scored),
      byNumeric
    );
    const markers = smallStateFeatures(points, atlas, byNumeric);
    const drawn = new Set([...atlas, ...markers].map(f => f.properties.name));
    expect(scored.filter(name => !drawn.has(name))).toEqual([]);
    // Every point is used: none names a country the atlas already draws.
    expect(markers).toHaveLength(points.length);
  });

  it('lists exactly the scored countries the 110m atlas lacks (the file is current)', () => {
    const missing = missingFromAtlas(scored, isoRaw.countries, topology);
    expect(points.map(p => p.name).sort()).toEqual(missing.map(m => m.name).sort());
    expect(points.map(p => p.id).sort()).toEqual(missing.map(m => m.id).sort());
    expect(points.map(p => p.name)).toEqual(expect.arrayContaining(['Singapore', 'Kiribati', 'Malta']));
    // Every entry records the atlas scale its point came from.
    expect(smallStates.countries.every(c => c.atlas === '50m' || c.atlas === '10m')).toBe(true);
  });
});
