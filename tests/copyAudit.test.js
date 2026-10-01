import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ATTRIBUTES, ATTRIBUTE_KEYS, COMPUTED_NOTE, EU_LEVEL_LABEL, EU_LEVEL_NOTE, FRONTIER_AGGREGATION_NOTE,
  FRONTIER_CAP_SENTENCE, FRONTIER_SUBINDICATORS, FRONTIER_TRACKS, GROUPS, IMPLEMENTATION_LEVELS,
  NOT_APPLICABLE_LABEL,
} from '../src/constants';
import {
  scoreLine, legendCaption, modeAnnouncement, blocExtremes, groupCaption, levelMeaning,
  apiColumnDescription, frontierTrackLine, frontierCellValue, NO_ACTIVITY_TEXT,
} from '../src/data/meaning';
import { STYLE_ANCHORS, SUBSCORE_LABELS, normalizeSubscores } from '../src/data/subscores';
import { buildExportMeta } from '../src/controls/export';
import {
  buildModels, loadInputs, pageDescription, renderCountryPage, renderCountryIndex, renderFrontierSection,
} from '../scripts/build_pages';

// Copy audit (PRD 16). A score says how much is in force, or how a country
// governs; it never says one country is better than another. This test
// fails if evaluative or ranking words reach the vocabulary or any string
// the panel, legend, bloc card, tooltip, explainer or static pages render
// about a score. The methodology's one history note ("formerly called the
// maturity index") is the only place the old name may appear, and it is
// not audited here.

const BANNED = [
  'rank', 'ranked', 'ranking', 'highest', 'lowest', 'best', 'leading', 'weak', 'strong',
  'comprehensive', 'mature', 'maturity',
];
const BANNED_RE = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i');

function offenders(strings) {
  return strings.filter(s => BANNED_RE.test(s)).map(s => `${s.match(BANNED_RE)[0]} in: ${s}`);
}

// Visible text of an HTML fragment: no tags (so <strong> is not a word),
// comments, styles or scripts.
function textOf(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

// String literals in a source file, outside imports and comments: the
// static copy a module renders.
function literalsOf(path) {
  const src = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(import|export \{|\/\/)/.test(line))
    .map(line => line.replace(/\s\/\/.*$/, ''))
    .join('\n');
  return [...src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map(m => textOf(m[1] ?? m[2] ?? m[3]));
}

describe('copy audit', () => {
  it('the vocabulary in constants.ts', () => {
    const strings = [];
    for (const key of ATTRIBUTE_KEYS) strings.push(...Object.values(ATTRIBUTES[key]));
    for (const group of Object.values(GROUPS)) strings.push(...Object.values(group));
    strings.push(...Object.values(IMPLEMENTATION_LEVELS));
    for (const anchors of Object.values(STYLE_ANCHORS)) strings.push(...anchors);
    // Frontier risk governance (PRD 15): tracks, sub-indicators and anchors.
    for (const track of Object.values(FRONTIER_TRACKS)) strings.push(track.label, track.description);
    for (const sub of Object.values(FRONTIER_SUBINDICATORS)) strings.push(sub.label, ...Object.values(sub.levels));
    strings.push(
      NOT_APPLICABLE_LABEL, FRONTIER_AGGREGATION_NOTE, FRONTIER_CAP_SENTENCE, EU_LEVEL_LABEL, EU_LEVEL_NOTE, COMPUTED_NOTE,
    );
    expect(offenders(strings)).toEqual([]);
  });

  it('tooltip, legend, live region, bloc card and panel strings', () => {
    const strings = [NO_ACTIVITY_TEXT, groupCaption('implementation'), groupCaption('style'), groupCaption('frontier')];
    for (const key of ATTRIBUTE_KEYS) {
      strings.push(scoreLine(key, 3.25), scoreLine(key, 1, '2026-03-21'));
      strings.push(...Object.values(legendCaption(key)), modeAnnouncement(key));
      strings.push(...Object.values(blocExtremes(key)));
      strings.push(apiColumnDescription({
        averageScore: 'avg_score', regulationStatus: 'regulation_status', policyLever: 'policy_lever',
        enforcementLevel: 'enforcement_level', governanceType: 'governance_type', actorInvolvement: 'actor_involvement',
        frontierRisk: 'frontier_risk',
      }[key]));
    }
    for (const column of ['frontier_track', 'frontier_subscores', 'frontier_risk_text', 'frontier_sources_raw']) {
      strings.push(apiColumnDescription(column));
    }
    for (const track of ['H', 'C', 'G']) strings.push(frontierTrackLine(track), frontierTrackLine(track, true));
    strings.push(frontierCellValue('na'), frontierCellValue(null));
    for (const key of Object.keys(FRONTIER_SUBINDICATORS)) {
      for (let level = 1; level <= 5; level++) strings.push(levelMeaning('frontier', key, level));
    }
    for (const [snake, labels] of Object.entries(SUBSCORE_LABELS)) {
      const group = snake === 'governance_type' || snake === 'actor_involvement' ? 'style' : 'implementation';
      for (const [key, label] of labels) {
        strings.push(label);
        for (let level = 1; level <= 5; level++) strings.push(levelMeaning(group, key, level));
      }
    }
    strings.push(JSON.stringify(buildExportMeta('2026-09-28')));
    strings.push(JSON.stringify(buildExportMeta('2026-09-28', '2026-06-13')));
    expect(offenders(strings)).toEqual([]);
  });

  it('the static copy of the legend, bloc card, panel, selector, country table and comparison modules', () => {
    const files = [
      'src/map/legend.ts', 'src/map/index.ts', 'src/map/renderer.ts', 'src/map/countryTable.ts',
      'src/controls/blocSummary.ts', 'src/controls/scoreSelector.ts',
      'src/panel/index.ts', 'src/panel/scores.ts', 'src/panel/subscores.ts', 'src/panel/peers.ts',
      'src/comparison/radar.ts', 'src/comparison/panel.ts', 'src/data/peers.ts',
      'src/panel/frontier.ts', 'src/controls/helpOverlay.ts',
    ];
    for (const file of files) expect(offenders(literalsOf(file)), file).toEqual([]);
  });

  it('the app shell: panel, intro, empty state, hint and the explainer dialog', () => {
    const html = readFileSync('index.html', 'utf8');
    const body = html.slice(html.indexOf('<body>'));
    expect(offenders([textOf(body)])).toEqual([]);
  });

  it('the static country pages: description, scores section and index', () => {
    const models = buildModels(loadInputs());
    const strings = [textOf(renderCountryIndex(models))];
    for (const model of models) {
      strings.push(pageDescription(model));
      const page = renderCountryPage(model);
      const scores = page.slice(page.indexOf('<section id="scores"'), page.indexOf('</section>', page.indexOf('<section id="scores"')));
      strings.push(textOf(scores));
    }
    // The index page lists country names only beside the index.
    expect(offenders(strings)).toEqual([]);
  });

  it('the static frontier section, on every track', () => {
    const inputs = loadInputs();
    const [first, second, third] = Object.keys(inputs.scores).sort();
    const cell = (score, extra = {}) => ({ score, rationale: 'A rationale.', ...extra });
    const blocks = {
      [first]: ['H', { developer_obligations: cell(4, { eu_level: true }), evaluation_oversight: cell(3),
        incident_emergency_preparedness: cell(null), international_coordination: cell(5, { computed: true }) }],
      [second]: ['C', { developer_obligations: cell('na'), evaluation_oversight: cell(1),
        incident_emergency_preparedness: cell(2), international_coordination: cell(3, { computed: true }) }],
      [third]: ['G', { developer_obligations: cell('na'), evaluation_oversight: cell('na'),
        incident_emergency_preparedness: cell(4), international_coordination: cell(2, { computed: true }) }],
    };
    const countries = {};
    for (const [name, [track, subs]] of Object.entries(blocks)) {
      inputs.scores[name] = { ...inputs.scores[name], frontierRisk: 2.5, frontierTrack: track };
      countries[name] = { date: '2026-10-05', frontier: { date: '2026-10-05', track, rubric: 'f1', ...subs } };
    }
    inputs.subscores = normalizeSubscores({ schema_version: 1, countries });
    const models = buildModels(inputs).filter(m => m.name in blocks);
    const strings = models.map(m => textOf(renderFrontierSection(m)));
    expect(strings.every(t => t.includes('Frontier Risk Governance'))).toBe(true);
    expect(offenders(strings)).toEqual([]);
  });
});
