// The archived dataset version on screen (public/data/release.json).
//
// The data-release workflow writes this file after each weekly data
// commit: the GitHub release tag (`data-YYYY-Www`), the date of the data
// commit the release archives, the version DOI Zenodo minted for that
// release, and the concept DOI that always resolves to the latest
// version. The citation formatter quotes the tag and the DOI so a
// footnote names a retrievable version rather than "the site". The file
// is absent until the first release, and the DOI can lag the tag by one
// commit (minting is asynchronous), so every consumer handles null.

export interface ReleaseInfo {
  /** GitHub release tag, `data-YYYY-Www`. */
  tag: string;
  /** ISO date (YYYY-MM-DD) of the data commit the release archives. */
  date: string;
  /** Version DOI, bare (`10.5281/zenodo.1234567`); null until minted. */
  doi: string | null;
  /** Concept DOI, resolving to the latest version; null until minted. */
  conceptDoi: string | null;
  /** True when the DOIs came from the Zenodo sandbox, which never resolve. */
  sandbox: boolean;
}

export const RELEASE_TAG_RE = /^data-\d{4}-W\d{2}$/;
const DOI_RE = /^10\.\d{4,9}\/\S+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The resolver URL for a bare DOI. */
export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}

/**
 * The DOI a reader should quote: the version DOI, unless it is still
 * pending or came from the sandbox (a sandbox DOI in a footnote is a
 * broken link). The version tag is quotable either way.
 */
export function citableDoi(release: ReleaseInfo | null | undefined): string | null {
  if (!release || release.sandbox) return null;
  return release.doi;
}

function parseDoi(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const doi = value.trim();
  return DOI_RE.test(doi) ? doi : null;
}

/** Coerce a parsed release.json into ReleaseInfo; null when it is not one. */
export function normalizeRelease(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const file = raw as Record<string, unknown>;
  const tag = typeof file.tag === 'string' ? file.tag.trim() : '';
  const date = typeof file.date === 'string' ? file.date.trim() : '';
  if (!RELEASE_TAG_RE.test(tag) || !DATE_RE.test(date)) return null;
  return {
    tag,
    date,
    doi: parseDoi(file.doi),
    conceptDoi: parseDoi(file.concept_doi),
    sandbox: file.sandbox === true,
  };
}

export async function loadRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch('/data/release.json');
    if (!response.ok) return null;
    return normalizeRelease(await response.json());
  } catch {
    // Absent until the first release; citations use the plain format.
    return null;
  }
}
