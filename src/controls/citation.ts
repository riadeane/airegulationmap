// Formatted citation strings (APA / Chicago / MLA) for the current
// view. The `url` argument is the permalink so a reader can reproduce
// the exact view the researcher cited.

import { ATTRIBUTE_LABELS } from '../constants';

const DEFAULT_MODE = 'averageScore';

export interface CitationView {
  country?: string | null;
  compareCountries?: string[] | null;
  mode?: string | null;
  timelineDate?: string | null;
  url: string;
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
    title += ' — ' + compareCountries.join(', ') + ' comparison';
  } else if (country) {
    title += ' — ' + country;
  }
  if (mode && mode !== DEFAULT_MODE) {
    title += ' (' + ((ATTRIBUTE_LABELS as Record<string, string>)[mode] || mode) + ')';
  }
  return title;
}

function humanAccessed(dateIso: string): string {
  // "17 April 2026" — Chicago / MLA prefer day-month-year.
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
  accessed = new Date().toISOString().slice(0, 10),
}: CitationView): Citations {
  const year = (timelineDate || accessed).slice(0, 4);
  const title = viewTitle({ country, compareCountries, mode });

  // APA 7th: initial for first name; italicized title (not conveyed
  // here since this is a plain-text string, but a reader can italicize
  // the portion between "AI Regulation Map" and the final period).
  const apa = `Deane, R. (${year}). ${title} [Data visualization]. Retrieved ${accessed}, from ${url}`;

  // Chicago author-date.
  const chicago = `Deane, Ria. ${year}. "${title}." Accessed ${humanAccessed(accessed)}. ${url}.`;

  // MLA 9th.
  const mla = `Deane, Ria. "${title}." AI Regulation Map, ${year}, ${url}. Accessed ${humanAccessed(accessed)}.`;

  return { apa, chicago, mla };
}
