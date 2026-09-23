// Formatted citation strings (APA / Chicago / MLA) for the current
// view. The `url` argument is the permalink so a reader can reproduce
// the exact view the researcher cited. When the archived dataset
// version is known (release.json), each string also names the version
// tag and, once Zenodo has minted it, the DOI, so the reader can
// retrieve the exact data behind the view; without it the strings are
// the plain view format.

import { ATTRIBUTE_LABELS } from '../constants';
import { citableDoi, doiUrl } from '../data/release';
import type { ReleaseInfo } from '../data/release';

const DEFAULT_MODE = 'averageScore';

export interface CitationView {
  country?: string | null;
  compareCountries?: readonly string[] | null;
  mode?: string | null;
  timelineDate?: string | null;
  url: string;
  /**
   * The archived dataset version on screen (release.json). Null or
   * absent until the first release, and after a Supabase hydration
   * replaces the snapshot the release describes.
   */
  release?: ReleaseInfo | null;
  /** Injected for tests; callers just pass the live `url`. */
  accessed?: string;
}

export interface Citations {
  apa: string;
  chicago: string;
  mla: string;
}

function viewTitle({ country, compareCountries, mode }: Pick<CitationView, 'country' | 'compareCountries' | 'mode'>): string {
  let title = 'AI Regulation Map';
  if (compareCountries && compareCountries.length >= 2) {
    title += ': ' + compareCountries.join(', ') + ' comparison';
  } else if (country) {
    title += ': ' + country;
  }
  if (mode && mode !== DEFAULT_MODE) {
    title += ' (' + ((ATTRIBUTE_LABELS as Record<string, string>)[mode] || mode) + ')';
  }
  return title;
}

function humanAccessed(dateIso: string): string {
  // "17 April 2026" - Chicago / MLA prefer day-month-year.
  const d = new Date(dateIso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Produce APA / Chicago / MLA citations for the supplied view.
export function citationsFor({
  country,
  compareCountries,
  mode,
  timelineDate,
  url,
  release = null,
  accessed = new Date().toISOString().slice(0, 10),
}: CitationView): Citations {
  // A historical view is dated by the timeline; otherwise by the archived
  // version's data commit, so the year matches the DOI record; otherwise
  // by the access date.
  const year = (timelineDate || release?.date || accessed).slice(0, 4);
  const title = viewTitle({ country, compareCountries, mode });
  const version = release?.tag ?? null;
  const doi = citableDoi(release);
  const doiLink = doi ? doiUrl(doi) : null;

  // APA 7th: initial for first name; italicized title (not conveyed
  // here since this is a plain-text string, but a reader can italicize
  // the portion between "AI Regulation Map" and the final period). The
  // version sits in parentheses after the title, as APA places it, and
  // the DOI precedes the retrieval clause.
  const apa = `Deane, R. (${year}). ${title}`
    + (version ? ` (Version ${version})` : '')
    + ' [Data visualization]. '
    + (doiLink ? `${doiLink}. ` : '')
    + `Retrieved ${accessed}, from ${url}`;

  // Chicago author-date.
  const chicago = `Deane, Ria. ${year}. "${title}." `
    + (version ? `Version ${version}. ` : '')
    + (doiLink ? `${doiLink}. ` : '')
    + `Accessed ${humanAccessed(accessed)}. ${url}.`;

  // MLA 9th: version and DOI belong to the container; the view URL
  // follows the access date.
  const mla = `Deane, Ria. "${title}." AI Regulation Map, `
    + (version ? `version ${version}, ` : '')
    + `${year}, `
    + (doiLink ? `${doiLink}. Accessed ${humanAccessed(accessed)}. ${url}.` : `${url}. Accessed ${humanAccessed(accessed)}.`);

  return { apa, chicago, mla };
}
