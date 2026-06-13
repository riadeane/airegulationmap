// Source URL parsing and classification. Analysts care most about one
// property of a citation: is it a primary (official/government) source
// or secondary commentary? The taxonomy mirrors the research prompt:
// ministries, gazettes, legislatures, regulators are primary;
// OECD.ai / IAPP / law-firm trackers are secondary.

import { PLACEHOLDER_RE } from '../constants';

export type SourceKind = 'official' | 'other';

export interface ClassifiedSource {
  url: string;
  /** Hostname with a leading www. stripped; falls back to the raw URL. */
  hostname: string;
  kind: SourceKind;
}

// Government hostname patterns. Country-specific conventions vary:
// .gov / .gov.xx (US, UK, BR…), .gouv.xx (FR…), .gob.xx (ES, MX…),
// .go.xx (JP, KR, ID…), .gc.ca (Canada), .bund.de (Germany),
// .admin.ch (Switzerland), .govt.nz, europa.eu (EU institutions,
// including EUR-Lex — the primary source for EU law).
const OFFICIAL_HOST_RE = new RegExp(
  [
    String.raw`(^|\.)gov(\.[a-z]{2,3})?$`,
    String.raw`(^|\.)mil$`,
    String.raw`(^|\.)gouv\.[a-z]{2,3}$`,
    String.raw`(^|\.)gob\.[a-z]{2,3}$`,
    String.raw`(^|\.)go\.[a-z]{2,3}$`,
    String.raw`(^|\.)govt\.[a-z]{2,3}$`,
    String.raw`(^|\.)gc\.ca$`,
    String.raw`(^|\.)bund\.de$`,
    String.raw`(^|\.)admin\.ch$`,
    String.raw`(^|\.)europa\.eu$`,
  ].join('|'),
  'i'
);

// Hostnames that don't follow a government TLD convention but are
// legislatures, official gazettes, or statute databases.
const OFFICIAL_KEYWORD_RE = /(^|\.)(parliament|parlament|legislation|legifrance|riksdagen|bundestag|assemblee-nationale|camera|senato|gazette|boe)\./i;

export function classifySource(url: string): ClassifiedSource {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return { url, hostname: url, kind: 'other' };
  }
  const official = OFFICIAL_HOST_RE.test(hostname) || OFFICIAL_KEYWORD_RE.test(hostname);
  return { url, hostname, kind: official ? 'official' : 'other' };
}

/** Split the pipe-separated CSV field into classified, de-duplicated sources. */
export function classifySources(raw: string | null | undefined): ClassifiedSource[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: ClassifiedSource[] = [];
  for (const part of raw.split('|')) {
    const url = part.trim();
    if (!url || PLACEHOLDER_RE.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(classifySource(url));
  }
  return out;
}

/** Plain-text numbered source list, ready to paste into notes or a footnote. */
export function formatSourcesForCopy(
  sources: ClassifiedSource[],
  country: string,
  accessed: string = new Date().toISOString().slice(0, 10)
): string {
  const lines = sources.map(
    (s, i) => `${i + 1}. ${s.url}${s.kind === 'official' ? ' (official)' : ''}`
  );
  return [`Sources for ${country} — AI Regulation Map, accessed ${accessed}:`, ...lines].join('\n');
}
