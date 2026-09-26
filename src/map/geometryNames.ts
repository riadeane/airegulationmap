import type { Feature, Geometry } from 'geojson';
import { numericKey } from '../data/countryIso';

/**
 * Give every atlas geometry the dataset's name for its country, so code
 * keyed on `properties.name` (fill, tooltip, selection, filters) finds
 * the data row. A geometry whose atlas name is already a dataset name
 * keeps it. Otherwise its id (ISO 3166-1 numeric) resolves through
 * `byNumeric`: world-atlas abbreviates some names ("Dominican Rep.",
 * "eSwatini") where the dataset spells them out or uses an older name.
 * Geometries with no match (Antarctica, W. Sahara) keep the atlas name
 * and draw as no data. Mutates and returns the features.
 */
export function resolveFeatureNames<F extends Feature<Geometry, { name: string }>>(
  features: F[],
  datasetNames: ReadonlySet<string>,
  byNumeric: Readonly<Record<string, string>>
): F[] {
  for (const f of features) {
    if (datasetNames.has(f.properties.name) || f.id == null) continue;
    const name = byNumeric[numericKey(f.id)];
    if (name && datasetNames.has(name)) f.properties.name = name;
  }
  return features;
}
