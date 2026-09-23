# PRD 10: Versioned dataset releases with a DOI

Status: Implemented (September 2026); the Zenodo integration and secrets are
the maintainer's one-time setup below. Owner: unassigned. Depends on: none.

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
  Written as the default in `.zenodo.json`, `CITATION.cff`, the "Cite this
  dataset" section of `public/data.html` and the README; Setup step 1 says
  where to change it if the decision differs.

## Setup

One-time steps for the maintainer. The workflow, the metadata files and the
app are in place and idle until the Zenodo integration exists; nothing
below needs a code change.

1. **Confirm the dataset licence.** Everything assumes CC BY 4.0 (the
   `license` fields of `.zenodo.json` and `CITATION.cff`, the licence row
   in `public/data.html`, and the README). Zenodo copies the licence into
   every record, so settle it before the first production release, and
   change all four places together if it differs.
2. **Sandbox first.** Sign in at https://sandbox.zenodo.org with GitHub,
   open the GitHub page under your account settings, and flip the switch
   for `riadeane/airegulationmap`. Create a personal access token there
   (Applications, Personal access tokens; no scope is needed, the workflow
   only reads). In the repository, add the secret `ZENODO_TOKEN` with it and
   leave the variable `ZENODO_API_BASE` unset: the workflow reads the
   sandbox by default.
3. **Test a release.** Run the "Data Release" workflow by hand
   (`workflow_dispatch`, `tag` blank). It tags the latest data commit on
   `main` for its ISO week, creates the release, and polls the sandbox for
   the DOI. Check the release page, the sandbox record it created, and the
   commit that adds `public/data/release.json` (`doi` with the `10.5072`
   prefix, `sandbox: true`). The app's Cite popover then names the version
   and shows "DOI pending": sandbox DOIs are never quoted. If Zenodo was
   slower than the poll window, re-run the workflow with that `tag` once the
   record exists; the release is reused and only the lookup repeats.
4. **Switch to production.** Repeat the switch on https://zenodo.org,
   create a production token, replace the `ZENODO_TOKEN` secret, and set the
   repository variable `ZENODO_API_BASE` to `https://zenodo.org/api`. Delete
   the sandbox test release and its tag (`gh release delete <tag>
   --cleanup-tag`) so the next data commit in that week is released afresh;
   the next run overwrites `release.json`. Zenodo archives only releases
   published after the switch.
5. **Record the concept DOI.** After the first production release, copy
   `concept_doi` from `public/data/release.json` into the `doi` field of
   `CITATION.cff`, replacing the placeholder, and commit. The lookup carries
   the concept DOI forward from `release.json` on its own; setting the
   repository variable `ZENODO_CONCEPT_DOI` as well is a belt-and-braces
   for a lost file. Add an ORCID to `.zenodo.json` (`"orcid"` on the
   creator) and `CITATION.cff` (`orcid: https://orcid.org/...`) if you have
   one. Validate the file after any edit:

   ```bash
   pip install cffconvert && cffconvert --validate -i CITATION.cff
   ```

## Implementation notes

- **Why not `on: push` alone.** The weekly data commit is pushed with the
  update workflow's own `GITHUB_TOKEN`, and GitHub never starts `on: push`
  workflows for commits made with that token. `data-release.yml` therefore
  runs on `workflow_run` (the completion of "Update AI Regulation Data"),
  plus `push` on `public/scores.csv` for a data commit a maintainer pushes
  by hand and `workflow_dispatch` for re-runs. Zenodo's webhook is not a
  workflow, so a release created by the bot does reach it. The commit that
  records `release.json` is also made with `GITHUB_TOKEN`, so it starts
  nothing (no loop, and CI does not run on it either).
- **One release per ISO week.** The tag is `data-YYYY-Www` from the data
  commit's UTC date. A second data commit in the same week finds the tag on
  another commit and is skipped; it rides the next week's release. A re-run
  for an existing tag reuses the release and repeats only the DOI lookup.
- **What Zenodo archives.** Zenodo stores the repository at the tag (the
  release's source archive), which holds the same files under `public/`;
  the four attached files are for readers of the release page. The assets
  come from the tagged commit (`git archive`), not the working tree.
- **release.json.** `{tag, date, doi, concept_doi, sandbox}`. The file is
  written even when the DOI is still pending (`doi: null`), so the citation
  can name the version at once; the next run of the workflow fills the DOI
  in. `sandbox: true` marks DOIs from the sandbox instance: the app names
  the version but never quotes them (`citableDoi` in `src/data/release.ts`).
  The concept DOI never changes, so it is carried forward when a lookup
  finds nothing, but never across instances.
- **DOI lookup** (`scripts/regulation_pipeline/release.py`). With a known
  concept DOI the lookup reads the concept record, which resolves to the
  latest version, and checks that its version is the tag (or that a related
  identifier is the tag's tree URL): no search index to wait for and no
  page limit to fall off after a year of weekly versions. The search
  (`/api/records?q=...&all_versions=true`) is the path for the first
  release; it tries three field spellings because Zenodo's serializations
  have named the version differently. Polling: one attempt a minute, twenty
  minutes by default (`lookup_minutes` on dispatch). The step never fails
  the workflow, and the workflow never touches the data commit.
- **Release body.** The commit and date, the week's digest lead and items
  when the run wrote one, the run's gold-set drift row, and the update run's
  own summary, which `update-data.yml` now uploads as the `run-summary`
  artifact for the release workflow to read. Once the DOI exists it is
  appended to the body.
- **Citations.** With a release loaded, every style names the version after
  the title (`(Version data-2026-W39)`) and, for a production DOI, the
  resolver URL before the access clause; the view permalink stays. The year
  comes from the timeline date, else the release's data date, else the
  access date. The panel's Cite popover shows a version line with the DOI
  as a link. The issue-report "Cite as" line and the printed brief use the
  same string. A Supabase hydration (database strictly newer than the
  static snapshot) clears the release from state, since the release no
  longer describes what is on screen.
- **Not done.** The static country pages' JSON-LD `Dataset` markup does
  not yet carry the DOI as `identifier`; a follow-up once the concept DOI
  exists.
