import { describe, it, expect } from 'vitest';
import { classifySource, classifySources, formatSourcesForCopy } from '../src/data/sources';

describe('classifySource', () => {
  it.each([
    ['https://www.whitehouse.gov/ai', 'whitehouse.gov'],
    ['https://www.gov.uk/government/ai-regulation', 'gov.uk'],
    ['https://digital-strategy.ec.europa.eu/en/policies/ai', 'digital-strategy.ec.europa.eu'],
    ['https://eur-lex.europa.eu/eli/reg/2024/1689', 'eur-lex.europa.eu'],
    ['https://www.economie.gouv.fr/ia', 'economie.gouv.fr'],
    ['https://www.gob.mx/agenda-digital', 'gob.mx'],
    ['https://www.meti.go.jp/english/policy/ai.html', 'meti.go.jp'],
    ['https://ised-isde.canada.gc.ca/site/ai', 'ised-isde.canada.gc.ca'],
    ['https://www.bakom.admin.ch/ai', 'bakom.admin.ch'],
    ['https://www.legislation.gov.au/Details/C2024', 'legislation.gov.au'],
    ['https://www.legifrance.gouv.fr/jorf/id/X', 'legifrance.gouv.fr'],
    ['https://www.parliament.uk/business/ai', 'parliament.uk'],
    ['https://www.govt.nz/ai-strategy', 'govt.nz'],
    // Government domains without a naming convention (#94).
    ['https://valtioneuvosto.fi/en/-/ai', 'valtioneuvosto.fi'],
    ['https://tem.fi/en/artificial-intelligence', 'tem.fi'],
    ['https://www.cnil.fr/en/ai', 'cnil.fr'],
    ['https://autoriteitpersoonsgegevens.nl/en/ai', 'autoriteitpersoonsgegevens.nl'],
    ['https://eimin.lrv.lt/en/ai', 'eimin.lrv.lt'],
    ['https://cnpd.public.lu/en/ai.html', 'cnpd.public.lu'],
    ['https://www.regjeringen.no/en/ai', 'regjeringen.no'],
    ['https://www.stjornarradid.is/ai', 'stjornarradid.is'],
    ['https://www.riigikantselei.ee/en/ai', 'riigikantselei.ee'],
    ['https://www.regierung.li/ai', 'regierung.li'],
    ['https://ised-isde.canada.ca/site/ai', 'ised-isde.canada.ca'],
    ['https://inforegulator.org.za/ai', 'inforegulator.org.za'],
    ['https://privacy.rks-gov.net/ai', 'privacy.rks-gov.net'],
    ['https://www.agesic.gub.uy/ia', 'agesic.gub.uy'],
    ['https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1', 'legisquebec.gouv.qc.ca'],
    ['https://www.ris.bka.gv.at/x', 'ris.bka.gv.at'],
    ['https://www.parlamento.pt/ai', 'parlamento.pt'],
    ['https://www.senado.leg.br/ia', 'senado.leg.br'],
  ])('classifies %s as official', (url, hostname) => {
    const s = classifySource(url);
    expect(s.kind).toBe('official');
    expect(s.hostname).toBe(hostname);
  });

  it.each([
    'https://oecd.ai/en/dashboards/policy-initiatives',
    'https://iapp.org/resources/global-ai-law',
    'https://www.dlapiper.com/ai-tracker',
    'https://en.wikipedia.org/wiki/AI_Act',
    'https://carnegieendowment.org/research',
    'https://notcanada.ca/ai', // an allowlisted host needs a label boundary
    'https://www.governance.com/report', // "gov" substring must not match
  ])('classifies %s as other', url => {
    expect(classifySource(url).kind).toBe('other');
  });

  it('handles unparseable URLs without throwing', () => {
    const s = classifySource('not a url');
    expect(s.kind).toBe('other');
    expect(s.hostname).toBe('not a url');
  });
});

describe('classifySources', () => {
  it('splits, trims, dedupes, and drops placeholders', () => {
    const raw = ' https://gov.uk/a | https://oecd.ai/b |https://gov.uk/a| N/A | ';
    const out = classifySources(raw);
    expect(out.map(s => s.url)).toEqual(['https://gov.uk/a', 'https://oecd.ai/b']);
    expect(out.map(s => s.kind)).toEqual(['official', 'other']);
  });

  it('returns [] for null/empty', () => {
    expect(classifySources(null)).toEqual([]);
    expect(classifySources('')).toEqual([]);
  });
});

describe('formatSourcesForCopy', () => {
  it('produces a numbered, paste-ready list with official markers', () => {
    const sources = classifySources('https://gov.uk/a|https://oecd.ai/b');
    const text = formatSourcesForCopy(sources, 'United Kingdom', '2026-06-13');
    expect(text).toBe(
      'Sources for United Kingdom (AI Regulation Map, accessed 2026-06-13):\n' +
      '1. https://gov.uk/a (official)\n' +
      '2. https://oecd.ai/b'
    );
  });
});
