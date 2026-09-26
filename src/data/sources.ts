// Source URL parsing and classification. Analysts care most about one
// property of a citation: is it a primary (official/government) source
// or secondary commentary? The taxonomy mirrors the research prompt:
// ministries, gazettes, legislatures, regulators are primary;
// OECD.ai / IAPP / law-firm trackers are secondary.

import { PLACEHOLDER_RE } from '../constants';
import { localIsoDate } from './localDate';

export type SourceKind = 'official' | 'other';

export interface ClassifiedSource {
  url: string;
  /** Hostname with a leading www. stripped; falls back to the raw URL. */
  hostname: string;
  kind: SourceKind;
}

/**
 * Optional per-URL display metadata (page title, richer source type).
 * Today the CSV carries bare URLs so this is usually absent; the sources
 * database can supply it, and the panel upgrades from hostnames to titles
 * whenever an entry exists.
 */
export interface SourceMetaEntry {
  title?: string | null;
  sourceType?: string | null;
}

export type SourceMeta = Record<string, SourceMetaEntry>;

// Government hostname patterns. Country-specific conventions vary:
// .gov / .gov.xx (US, UK, BR…), .gouv.xx (FR…), .gob.xx (ES, MX…),
// .gub.xx (UY), .go.xx (JP, KR, ID…), .gov.xx.yy / .gouv.xx.yy (sub-national,
// e.g. gouv.qc.ca), .gv.at (Austria), .gc.ca (Canada), .bund.de (Germany),
// .admin.ch (Switzerland), .govt.nz, europa.eu (EU institutions,
// including EUR-Lex - the primary source for EU law).
const OFFICIAL_HOST_RE = new RegExp(
  [
    String.raw`(^|\.)gov(\.[a-z]{2,3})?$`,
    String.raw`(^|\.)mil$`,
    String.raw`(^|\.)gouv\.[a-z]{2,3}$`,
    String.raw`(^|\.)gob\.[a-z]{2,3}$`,
    String.raw`(^|\.)gub\.[a-z]{2,3}$`,
    String.raw`(^|\.)go\.[a-z]{2,3}$`,
    String.raw`(^|\.)govt\.[a-z]{2,3}$`,
    String.raw`(^|\.)(gov|gouv)\.[a-z]{2}\.[a-z]{2}$`,
    String.raw`(^|\.)gv\.at$`,
    String.raw`(^|\.)gc\.ca$`,
    String.raw`(^|\.)bund\.de$`,
    String.raw`(^|\.)admin\.ch$`,
    String.raw`(^|\.)europa\.eu$`,
  ].join('|'),
  'i'
);

// Hostnames that don't follow a government TLD convention but are
// legislatures, official gazettes, or statute databases.
const OFFICIAL_KEYWORD_RE = /(^|\.)(parliament|parlament|parlamento|legislation|legifrance|riksdagen|bundestag|assemblee-nationale|camera|senato|senado|congreso|gazette|boe)\./i;

// National governments, legislatures, gazettes and regulators whose domains
// follow no naming convention. A host matches itself and its subdomains.
// Mirrored in scripts/regulation_pipeline/sources.py (a test keeps the two
// lists identical).
export const OFFICIAL_HOSTS: readonly string[] = [
  'althingi.is', 'autoriteitpersoonsgegevens.nl', 'belgium.be', 'bundesregierung.de',
  'canada.ca', 'chinhphu.vn', 'cnil.fr', 'dataprotection.ie', 'datatilsynet.dk',
  'datatilsynet.no', 'digst.dk', 'dre.pt', 'eduskunta.fi', 'fgov.be', 'finlex.fi', 'ft.dk',
  'garanteprivacy.it', 'gouvernement.lu', 'government.bg', 'government.ru', 'governo.it',
  'ico.org.uk', 'imy.se', 'inforegulator.org.za', 'irishstatutebook.ie', 'kormany.hu',
  'kremlin.ru', 'leg.br', 'likumi.lv', 'llv.li', 'lrs.lt', 'lrv.lt', 'naih.hu', 'nic.in',
  'nn.hr', 'normattiva.it', 'oireachtas.ie', 'overheid.nl', 'public.lu', 'regeringen.se',
  'regierung.li', 'regjeringen.no', 'retsinformation.dk', 'riigikantselei.ee', 'riigiteataja.ee',
  'rijksoverheid.nl', 'rks-gov.net', 'stjornarradid.is', 'stortinget.no', 'tem.fi',
  'traficom.fi', 'tweedekamer.nl', 'u.ae', 'valitsus.ee', 'valtioneuvosto.fi',
];

function isOfficialHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return OFFICIAL_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

/**
 * The URL, trimmed, when it is an absolute http(s) link; otherwise null.
 * Source cells come from model output and outside databases, so only
 * these schemes may become an href - a javascript: or data: URL renders
 * as plain text instead.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

export function classifySource(url: string): ClassifiedSource {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return { url, hostname: url, kind: 'other' };
  }
  const official = OFFICIAL_HOST_RE.test(hostname) || OFFICIAL_KEYWORD_RE.test(hostname)
    || isOfficialHost(hostname);
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
  accessed: string = localIsoDate()
): string {
  const lines = sources.map(
    (s, i) => `${i + 1}. ${s.url}${s.kind === 'official' ? ' (official)' : ''}`
  );
  return [`Sources for ${country} (AI Regulation Map, accessed ${accessed}):`, ...lines].join('\n');
}
