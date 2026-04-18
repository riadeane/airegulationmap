// Formatted citation strings (APA / Chicago / MLA) for the current
// view. The `url` argument is the permalink so a reader can reproduce
// the exact view the researcher cited.

import { ATTRIBUTE_LABELS } from '../constants.js';

const DEFAULT_MODE = 'averageScore';

function viewTitle({ country, compareCountries, mode }) {
  let title = 'AI Regulation Map';
  if (compareCountries && compareCountries.length >= 2) {
    title += ' \u2014 ' + compareCountries.join(', ') + ' comparison';
  } else if (country) {
    title += ' \u2014 ' + country;
  }
  if (mode && mode !== DEFAULT_MODE) {
    title += ' (' + (ATTRIBUTE_LABELS[mode] || mode) + ')';
  }
  return title;
}

function humanAccessed(dateIso) {
  // "17 April 2026" — Chicago / MLA prefer day-month-year.
  const d = new Date(dateIso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Produce APA / Chicago / MLA citations for the supplied view. The
// `accessed` parameter is injected for tests; callers just pass the
// live `url`.
export function citationsFor({
  country,
  compareCountries,
  mode,
  timelineDate,
  url,
  accessed = new Date().toISOString().slice(0, 10),
}) {
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
