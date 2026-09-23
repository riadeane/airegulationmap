import { describe, it, expect } from 'vitest';
import { normalizeRelease, citableDoi, doiUrl } from '../src/data/release';

// release.json is written by the data-release workflow (PRD 10): the
// release tag, the data commit date, and the Zenodo DOIs, which can lag
// the tag while minting is pending. The loader must keep the tag in that
// window and never hand the citation a malformed or sandbox DOI.

const FILE = {
  tag: 'data-2026-W39',
  date: '2026-09-21',
  doi: '10.5281/zenodo.1234567',
  concept_doi: '10.5281/zenodo.1234566',
  sandbox: false,
};

describe('normalizeRelease', () => {
  it('reads the file the release workflow writes', () => {
    expect(normalizeRelease(FILE)).toEqual({
      tag: 'data-2026-W39',
      date: '2026-09-21',
      doi: '10.5281/zenodo.1234567',
      conceptDoi: '10.5281/zenodo.1234566',
      sandbox: false,
    });
  });

  it('keeps the tag while the DOIs are pending', () => {
    const pending = normalizeRelease({ tag: 'data-2026-W39', date: '2026-09-21', doi: null, concept_doi: null });
    expect(pending).toEqual({ tag: 'data-2026-W39', date: '2026-09-21', doi: null, conceptDoi: null, sandbox: false });
  });

  it('nulls a malformed DOI rather than quoting it', () => {
    const release = normalizeRelease({ ...FILE, doi: 'zenodo.1234567', concept_doi: ' 10.5281/zenodo.1234566 ' });
    expect(release.doi).toBeNull();
    expect(release.conceptDoi).toBe('10.5281/zenodo.1234566');
  });

  it('rejects a file without a release tag and a date', () => {
    expect(normalizeRelease({ ...FILE, tag: 'v1.0' })).toBeNull();
    expect(normalizeRelease({ ...FILE, date: '21/09/2026' })).toBeNull();
    expect(normalizeRelease({ doi: FILE.doi })).toBeNull();
    expect(normalizeRelease(null)).toBeNull();
    expect(normalizeRelease([])).toBeNull();
    expect(normalizeRelease('data-2026-W39')).toBeNull();
  });

  it('flags sandbox releases only on an explicit true', () => {
    expect(normalizeRelease({ ...FILE, sandbox: true }).sandbox).toBe(true);
    expect(normalizeRelease({ ...FILE, sandbox: 'yes' }).sandbox).toBe(false);
    const withoutFlag = { ...FILE };
    delete withoutFlag.sandbox;
    expect(normalizeRelease(withoutFlag).sandbox).toBe(false);
  });
});

describe('citableDoi', () => {
  it('returns the version DOI of a production release', () => {
    expect(citableDoi(normalizeRelease(FILE))).toBe('10.5281/zenodo.1234567');
  });

  it('returns null while pending, for sandbox releases, and without a release', () => {
    expect(citableDoi(normalizeRelease({ ...FILE, doi: null }))).toBeNull();
    expect(citableDoi(normalizeRelease({ ...FILE, sandbox: true }))).toBeNull();
    expect(citableDoi(null)).toBeNull();
    expect(citableDoi(undefined)).toBeNull();
  });
});

describe('doiUrl', () => {
  it('builds the resolver URL', () => {
    expect(doiUrl('10.5281/zenodo.1234567')).toBe('https://doi.org/10.5281/zenodo.1234567');
  });
});
