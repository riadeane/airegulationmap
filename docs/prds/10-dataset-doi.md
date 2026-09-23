# PRD 10: Versioned dataset releases with a DOI

Status: Proposed. Owner: unassigned. Depends on: none.

## Problem

The data changes weekly, but a citation today points at "the site". A paper
that cites a score cannot tell its reader which version it used, and cannot
retrieve that version later.

## Users and job

Academics citing the dataset in a paper. Reviewers checking the cited
version.

## Goal

Every weekly data commit becomes a tagged GitHub release archived on Zenodo
with a DOI. The app's citation shows the DOI of the version on screen.

## Non-goals

- Hosting archives ourselves. Zenodo stores the release.
- Changing the data files or their format.

## Requirements

1. **Release.** After the workflow commits data, create a GitHub release
   tagged `data-YYYY-Www` with the four data files attached and the run
   summary as the release body. Skip when no data changed.
2. **Zenodo.** Enable the Zenodo GitHub integration for the repository (a
   one-time step by the maintainer, documented). Zenodo mints a DOI per
   release and a concept DOI for the dataset.
3. **Release metadata.** Add `.zenodo.json` with title, creators, description,
   license, keywords, and related identifiers (the site URL). Add `CITATION.cff`
   with the concept DOI.
4. **Version file.** The workflow writes `public/data/release.json`:
   `{tag, date, doi, concept_doi}` after the DOI exists. Use the Zenodo API
   with a token in secrets to look it up; retry a few times since minting is
   asynchronous. Commit the file in a follow-up commit.
5. **Citation.** `src/controls/citation.ts` includes the DOI and tag in the
   generated citation when `release.json` is present, and falls back to the
   current format otherwise.
6. **Docs.** `public/data.html` gains a "Cite this dataset" section with the
   concept DOI, the latest version DOI, and the BibTeX block.

## Design notes

- Split the release logic into a second workflow triggered by the data commit
  (`on: push` with `paths: public/scores.csv`), so the update workflow stays
  simple.
- Zenodo sandbox first; document the switch to production.
- The DOI lookup step must never fail the data commit.

## Acceptance criteria

- A weekly run yields a release and, within an hour, a DOI in `release.json`.
- The citation popover shows the DOI.
- `CITATION.cff` validates with `cffconvert`.

## Open questions

- License for the dataset. Proposed: CC BY 4.0, confirm with the maintainer.
