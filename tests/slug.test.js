import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { countrySlug, countryPagePath } from '../src/data/slug';
import { parseScoresCsv } from '../src/data/loader';

describe('countrySlug', () => {
  it.each([
    ['Chile', 'chile'],
    ['United States of America', 'united-states-of-america'],
    ["Côte d'Ivoire", 'cote-divoire'],
    ['Bosnia and Herz.', 'bosnia-and-herz'],
    ['Dem. Rep. Congo', 'dem-rep-congo'],
    ['S. Sudan', 's-sudan'],
    ['Guinea-Bissau', 'guinea-bissau'],
    ['Sao Tome and Principe', 'sao-tome-and-principe'],
    ['  São Tomé ', 'sao-tome'],
    ['Timor-Leste (East Timor)', 'timor-leste-east-timor'],
    ['Saint Kitts & Nevis', 'saint-kitts-nevis'],
  ])('slugs %s as %s', (name, slug) => {
    expect(countrySlug(name)).toBe(slug);
  });

  it('drops a typographic apostrophe like a straight one', () => {
    expect(countrySlug('Côte d’Ivoire')).toBe('cote-divoire');
  });

  it('builds the page path from the name', () => {
    expect(countryPagePath("Côte d'Ivoire")).toBe('/country/cote-divoire/');
  });

  it('is unique and URL-safe for every country in scores.csv', () => {
    const csv = readFileSync(new URL('../public/scores.csv', import.meta.url), 'utf8');
    const names = Object.keys(parseScoresCsv(csv));
    const slugs = names.map(countrySlug);
    expect(names.length).toBeGreaterThan(190);
    expect(new Set(slugs).size).toBe(names.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
