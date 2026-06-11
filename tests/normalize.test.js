import { describe, it, expect } from 'vitest';
import { normalizeRegulationText } from '../src/panel/normalize.js';

describe('normalizeRegulationText', () => {
  it('passes through non-string and empty values', () => {
    expect(normalizeRegulationText(null)).toBe(null);
    expect(normalizeRegulationText(undefined)).toBe(undefined);
    expect(normalizeRegulationText('')).toBe('');
  });

  it('strips a leading "as of Month YYYY" clause when more sentences follow', () => {
    const input = 'Country X has no AI law, as of April 2026. A national strategy is under discussion in parliament.';
    const out = normalizeRegulationText(input);
    expect(out).toBe('Country X has no AI law. A national strategy is under discussion in parliament.');
  });

  it('leaves a single-sentence "as of" clause untouched', () => {
    const input = 'Country X has no AI law, as of April 2026.';
    expect(normalizeRegulationText(input)).toBe(input);
  });

  it('collapses a run of three redundant "No …" sentences', () => {
    const lead = 'The Ministry of Technology has acknowledged the topic in public statements but taken few concrete actions. ';
    const cascade =
      'No AI-specific legislation or regulatory framework exists. ' +
      'No regulatory framework for AI has been formally established. ' +
      'No AI-specific legislation has been proposed in the legislature.';
    const out = normalizeRegulationText(lead + cascade);
    expect(out).toContain('No AI-specific legislation, governance body, or enforcement mechanism exists.');
    expect(out).toContain('Ministry of Technology');
    expect(out.match(/No /g).length).toBe(1);
  });

  it('trims a leading hedge word', () => {
    const input = 'Generally, the country lacks AI regulation but data protection law applies to automated processing systems.';
    const out = normalizeRegulationText(input);
    expect(out.startsWith('the country lacks')).toBe(true);
  });

  it('returns the original when normalization shrinks the text below 60%', () => {
    // A bare cascade with no surrounding context collapses to far less
    // than 60% of the original — the safety rail must kick in.
    const cascade =
      'No AI-specific legislation or regulatory framework exists. ' +
      'No regulatory framework for AI has been formally established. ' +
      'No AI-specific legislation has been proposed in the legislature.';
    expect(normalizeRegulationText(cascade)).toBe(cascade);
  });

  it('does not collapse distinct "No …" claims with little shared vocabulary', () => {
    const input =
      'No national AI strategy document has been published by the government. ' +
      'No facial recognition moratorium covers public spaces or schools. ' +
      'No procurement rules mention algorithmic transparency requirements anywhere.';
    expect(normalizeRegulationText(input)).toBe(input);
  });
});
