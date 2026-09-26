import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifySources } from '../src/data/sources';
import { normalizeSubscores } from '../src/data/subscores';
import {
  SITE_ORIGIN,
  TOP_LEVEL_PATHS,
  buildModels,
  buildSitemap,
  buildSlugMap,
  loadInputs,
  orderSources,
  pageDescription,
  renderCountryIndex,
  renderCountryPage,
} from '../scripts/build_pages';

// --- fixture ---------------------------------------------------------------

function score(country, averageScore, overrides = {}) {
  return {
    country,
    regulationStatus: 3,
    policyLever: 2.25,
    governanceType: 2,
    actorInvolvement: 3.5,
    averageScore,
    enforcementLevel: 2,
    lastUpdated: '2026-06-13',
    dataVersion: 2,
    ...overrides,
  };
}

const CHILE_SOURCES = [
  'https://oecd.ai/en/dashboards/x',
  'https://www.gob.cl/ai',            // official (gob.cl) - listed second in the CSV
  'https://www.bcn.cl/leychile',
  'https://www.senado.cl/ai-bill',    // not an official pattern
].join('|');

function fixture() {
  return {
    scores: {
      Chile: score('Chile', 2.42),
      Argentina: score('Argentina', 1.92),
      "Côte d'Ivoire": score("Côte d'Ivoire", 1.92, { lastUpdated: null }),
      Nowhere: score('Nowhere', null, { lastUpdated: null }),
    },
    regulation: {
      Chile: {
        country: 'Chile',
        regulationStatus: "Chile's AI bill is under Senate review. It has a risk framework.",
        policyLever: 'One binding instrument exists.',
        governanceType: null,
        actorInvolvement: 'N/A',
        enforcementLevel: 'Enforcement is embryonic.',
        specificLaws: 'Law 21.663 on Cybersecurity',
        sources: CHILE_SOURCES,
        lastUpdated: '2026-06-13',
        confidence: 'medium',
      },
      Argentina: {
        country: 'Argentina',
        regulationStatus: 'A strategy exists.',
        policyLever: null,
        governanceType: null,
        actorInvolvement: null,
        enforcementLevel: null,
        specificLaws: null,
        sources: null,
        lastUpdated: '2026-06-13',
        confidence: 'low',
      },
    },
    iso: {
      Chile: { iso2: 'CL', iso3: 'CHL', numeric: '152' },
      Argentina: { iso2: 'AR', iso3: 'ARG', numeric: '032' },
    },
    blocs: {
      OECD: { name: 'OECD', members: ['Chile', 'Argentina', 'Atlantis'] },
      G20: { name: 'G20', members: ['Argentina'] },
    },
    subscores: {
      schema_version: 1,
      methodology: 'v2.1',
      countries: {
        Chile: {
          date: '2026-06-13',
          regulation_status: {
            binding_force: { score: 3, rationale: 'Bill pending in the Senate since October 2025.' },
            scope: { score: 3, rationale: null },
            implementation: { score: 2, rationale: null },
            ai_specificity: { score: 4, rationale: null },
          },
        },
      },
    },
  };
}

function modelFor(name, inputs = fixture()) {
  return buildModels(inputs).find(m => m.name === name);
}

// --- source ordering -------------------------------------------------------

describe('orderSources', () => {
  it('lists official sources first and keeps the CSV order within each kind', () => {
    const ordered = orderSources(classifySources(CHILE_SOURCES));
    expect(ordered.map(s => s.url)).toEqual([
      'https://www.gob.cl/ai',
      'https://oecd.ai/en/dashboards/x',
      'https://www.bcn.cl/leychile',
      'https://www.senado.cl/ai-bill',
    ]);
    expect(ordered.map(s => s.kind)).toEqual(['official', 'other', 'other', 'other']);
  });

  it('returns [] for no sources', () => {
    expect(orderSources([])).toEqual([]);
  });
});

// --- models ----------------------------------------------------------------

describe('buildModels', () => {
  it('sorts alphabetically and chains prev/next links', () => {
    const models = buildModels(fixture());
    expect(models.map(m => m.name)).toEqual(['Argentina', 'Chile', "Côte d'Ivoire", 'Nowhere']);
    expect(models[0].prev).toBeNull();
    expect(models[0].next).toEqual({ name: 'Chile', slug: 'chile' });
    expect(models[1].prev).toEqual({ name: 'Argentina', slug: 'argentina' });
    expect(models[1].next).toEqual({ name: "Côte d'Ivoire", slug: 'cote-divoire' });
    expect(models[3].next).toBeNull();
  });

  it('lists bloc peers without the country itself or members missing from scores.csv', () => {
    const chile = modelFor('Chile');
    expect(chile.blocs).toEqual([{ code: 'OECD', name: 'OECD', peers: ['Argentina'] }]);
    const argentina = modelFor('Argentina');
    expect(argentina.blocs.map(b => b.code)).toEqual(['OECD', 'G20']);
    expect(argentina.blocs[1].peers).toEqual([]);
  });

  it('ranks by maturity index with shared ranks for ties', () => {
    expect(modelFor('Chile').rank).toEqual({ rank: 1, total: 3 });
    expect(modelFor('Argentina').rank).toEqual({ rank: 2, total: 3 });
    expect(modelFor("Côte d'Ivoire").rank).toEqual({ rank: 2, total: 3 });
    expect(modelFor('Nowhere').rank).toBeNull();
  });

  it('carries ISO codes, ordered sources and sub-indicators', () => {
    const chile = modelFor('Chile');
    expect(chile.iso).toEqual({ iso2: 'CL', iso3: 'CHL', numeric: '152' });
    expect(chile.sources[0].kind).toBe('official');
    expect(chile.subscores.regulation_status.binding_force.score).toBe(3);
    expect(modelFor("Côte d'Ivoire").iso).toBeNull();
  });

  it('refuses two countries that share a slug', () => {
    const inputs = fixture();
    inputs.scores['S. Sudan'] = score('S. Sudan', 1);
    inputs.scores['S Sudan'] = score('S Sudan', 1);
    expect(() => buildModels(inputs)).toThrow(/Slug collision/);
  });
});

// --- template --------------------------------------------------------------

describe('renderCountryPage', () => {
  const html = renderCountryPage(modelFor('Chile'));

  it('carries the SEO metadata', () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>AI regulation in Chile · AI Regulation Map</title>');
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/country/chile/">`);
    expect(html).toContain(`<meta name="description" content="${pageDescription(modelFor('Chile'))}">`);
    expect(html).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/country/chile/">`);
    expect(html).toContain('<meta property="og:title" content="AI regulation in Chile · AI Regulation Map">');
  });

  it('embeds JSON-LD Dataset markup with the six scores as variableMeasured', () => {
    const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    expect(match).not.toBeNull();
    const data = JSON.parse(match[1]);
    expect(data['@type']).toBe('Dataset');
    expect(data.url).toBe(`${SITE_ORIGIN}/country/chile/`);
    expect(data.dateModified).toBe('2026-06-13');
    expect(data.spatialCoverage).toEqual({ '@type': 'Country', name: 'Chile', identifier: 'CL' });
    expect(data.variableMeasured).toHaveLength(6);
    expect(data.variableMeasured[0]).toMatchObject({ name: 'Maturity Index', value: 2.42, minValue: 1, maxValue: 5 });
  });

  it('renders the entry content: codes, scores, rank, prose, laws', () => {
    expect(html).toContain('<h1 class="doc-title">Chile</h1>');
    expect(html).toContain('>CL</abbr>');
    expect(html).toContain('>CHL</abbr>');
    expect(html).toContain('>152</abbr>');
    expect(html).toContain('Medium confidence');
    expect(html).toContain('<time datetime="2026-06-13">2026-06-13</time>');
    expect(html).toContain('Maturity index <strong>2.42</strong> of 5, rank 1 of 3.');
    expect(html).toContain('<td class="num">2.25</td>');
    expect(html).toContain('under Senate review');
    expect(html).toContain('Law 21.663 on Cybersecurity');
  });

  it('omits empty and placeholder sections', () => {
    expect(html).not.toContain('id="actor-involvement"');   // "N/A"
    expect(html).not.toContain('id="governance-type"');     // null
    expect(html).toContain('id="enforcement-level"');
  });

  it('shows sub-indicators and their rationales when present', () => {
    expect(html).toContain('<caption>Sub-indicators (assessed 2026-06-13)</caption>');
    expect(html).toContain('<th scope="row">Binding force</th><td class="num">3</td><td class="rationale">Bill pending in the Senate since October 2025.</td>');
    expect(html).toContain('<th scope="row">Scope</th><td class="num">3</td><td class="rationale"></td>');
  });

  it('lists sources official-first with a tag', () => {
    const sources = html.slice(html.indexOf('<ol class="sources">'), html.indexOf('</ol>'));
    const urls = [...sources.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    expect(urls[0]).toBe('https://www.gob.cl/ai');
    expect(sources.indexOf('source-tag')).toBeLessThan(sources.indexOf('oecd.ai'));
    expect(html).toContain('1 of 4 sources are official');
  });

  it('links into the app and to neighbouring entries', () => {
    expect(html).toContain('<a class="btn" href="/?country=Chile">Open on the map</a>');
    expect(html).toContain('href="/?compare=Chile%2CArgentina"');
    expect(html).toContain('<a rel="prev" href="/country/argentina/">');
    expect(html).toContain('<a rel="next" href="/country/cote-divoire/">');
    expect(html).toContain('href="/country/">');
  });

  it('escapes data and loads no external script', () => {
    const cote = renderCountryPage(modelFor("Côte d'Ivoire"));
    expect(cote).toContain('<h1 class="doc-title">Côte d&#39;Ivoire</h1>');
    expect(cote).toContain('href="/?country=C%C3%B4te%20d&#39;Ivoire"');
    expect(cote).not.toContain('<script src');
  });

  it('states when no bloc peers exist', () => {
    const cote = renderCountryPage(modelFor("Côte d'Ivoire"));
    expect(cote).toContain('is not a member of a bloc tracked on the map');
  });

  it('keeps the meta description within a search snippet', () => {
    for (const m of buildModels(fixture())) {
      expect(pageDescription(m).length).toBeLessThanOrEqual(160);
    }
  });
});

// Evidence coverage (PRD 14): the record comes from subscores.json in the
// pipeline's snake_case shape, normalized the way loadInputs() does.
describe('renderCountryPage evidence line', () => {
  function inputsWithEvidence() {
    const inputs = fixture();
    inputs.subscores = normalizeSubscores({
      schema_version: 1,
      countries: {
        Chile: {
          ...inputs.subscores.countries.Chile,
          evidence: { grounded: true, initiatives_used: 7, search: true, model: 'claude-opus-5-5', run_id: 'run-1' },
        },
        Argentina: {
          date: '2026-06-13',
          evidence: { grounded: false, initiatives_used: 0, search: true, model: 'claude-opus-5-5', run_id: 'run-1' },
        },
        "Côte d'Ivoire": {
          date: '2026-06-13',
          evidence: { grounded: false, initiatives_used: null, search: true, model: 'claude-opus-5-5', run_id: 'run-1' },
        },
      },
    });
    return inputs;
  }

  it('states the initiative count and web search for a grounded record, below the meta line', () => {
    const html = renderCountryPage(modelFor('Chile', inputsWithEvidence()));
    expect(html).toContain('<p class="entry-evidence">Grounded in 7 verified policy initiatives and web search</p>');
    expect(html.indexOf('class="entry-meta"')).toBeLessThan(html.indexOf('class="entry-evidence"'));
    expect(html.indexOf('class="entry-evidence"')).toBeLessThan(html.indexOf('class="entry-actions"'));
    // Plain text: the static page has no initiatives section to link to.
    expect(html).not.toContain('evidence-initiatives-link');
  });

  it('states search only for a record without initiatives', () => {
    const html = renderCountryPage(modelFor('Argentina', inputsWithEvidence()));
    expect(html).toContain('<p class="entry-evidence">Web search only; no verified initiatives on record</p>');
    const cote = renderCountryPage(modelFor("Côte d'Ivoire", inputsWithEvidence()));
    expect(cote).toContain('<p class="entry-evidence">Web search only; verified initiatives not consulted</p>');
  });

  it('shows nothing for a country without a run record', () => {
    expect(renderCountryPage(modelFor('Nowhere', inputsWithEvidence()))).not.toContain('<p class="entry-evidence">');
    // The base fixture's Chile entry has sub-scores but no evidence key.
    expect(renderCountryPage(modelFor('Chile'))).not.toContain('<p class="entry-evidence">');
  });
});

describe('renderCountryPage sources', () => {
  it('links only http(s) sources and shows anything else as text', () => {
    const inputs = fixture();
    inputs.regulation.Chile.sources = 'https://www.gob.cl/ai|javascript:alert(1)';
    const html = renderCountryPage(modelFor('Chile', inputs));
    const sources = html.slice(html.indexOf('<ol class="sources">'), html.indexOf('</ol>'));
    expect(sources).toContain('<a href="https://www.gob.cl/ai"');
    expect(sources).not.toContain('href="javascript:');
    expect(sources).toContain('<li>javascript:alert(1)</li>');
  });
});

describe('renderCountryIndex', () => {
  it('lists every country with a link to its page', () => {
    const html = renderCountryIndex(buildModels(fixture()));
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/country/">`);
    expect(html).toContain('<a href="/country/argentina/">Argentina</a><span class="num">1.92</span>');
    expect(html).toContain('<a href="/country/cote-divoire/">Côte d&#39;Ivoire</a>');
    expect(html).toContain('<a href="/country/nowhere/">Nowhere</a><span class="num">n/a</span>');
  });
});

// --- sitemap + slug map ----------------------------------------------------

describe('buildSitemap', () => {
  it('lists the top-level pages and every country page with its last-updated date', () => {
    const xml = buildSitemap(buildModels(fixture()));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    for (const p of TOP_LEVEL_PATHS) expect(xml).toContain(`<loc>${SITE_ORIGIN}${p}</loc>`);
    expect(xml).toContain(`<url><loc>${SITE_ORIGIN}/country/chile/</loc><lastmod>2026-06-13</lastmod></url>`);
    expect(xml).toContain(`<url><loc>${SITE_ORIGIN}/country/cote-divoire/</loc></url>`);
    expect((xml.match(/<url>/g) || []).length).toBe(TOP_LEVEL_PATHS.length + 4);
  });

  // Cloudflare Pages 308-redirects /x.html to /x and /x/index.html to /x/;
  // a sitemap must list the final URLs.
  it('lists only extensionless URLs', () => {
    const xml = buildSitemap(buildModels(fixture()));
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) expect(loc).not.toMatch(/\.html$/);
    expect(locs).toContain(`${SITE_ORIGIN}/changes`);
    expect(locs).toContain(`${SITE_ORIGIN}/drift`);
  });
});

describe('buildSlugMap', () => {
  it('maps slug -> canonical name', () => {
    expect(buildSlugMap(buildModels(fixture())).slugs).toEqual({
      argentina: 'Argentina',
      chile: 'Chile',
      'cote-divoire': "Côte d'Ivoire",
      nowhere: 'Nowhere',
    });
  });

  it('matches the committed public/data/country_slugs.json', () => {
    const committed = JSON.parse(readFileSync(new URL('../public/data/country_slugs.json', import.meta.url), 'utf8'));
    expect(buildSlugMap(buildModels(loadInputs())).slugs).toEqual(committed.slugs);
  });
});
