# Contributing

Read [`CLAUDE.md`](CLAUDE.md) first: it describes the frontend, the
research pipeline, the data files, and the design principles every change
has to keep (the map is the protagonist, rigour over ornament, designed for
comparison, citeable by default, calm density).

## Development checks

```bash
npm install
npm run lint       # ESLint
npm run typecheck  # TypeScript, strict
npm test           # Vitest unit tests (tests/*.test.js)
npm run build      # static country pages + production build
npm run test:e2e   # Playwright smoke + accessibility checks against the build

pip install -r requirements.txt -r requirements-dev.txt
python -m pytest   # pipeline tests (tests/pipeline/)
```

CI runs all of these on every push and pull request. Do not commit data
files (`public/*.csv`, `public/history.json`, `public/data/subscores.json`)
that a local pipeline run changed; the weekly workflow owns them.

Found a problem outside what you are working on? File an issue (the rules
are in `CLAUDE.md` under "Found something off? File an issue").

## Data issues

A reader who knows a country's law better than the model is the cheapest
data-quality signal the project gets. Corrections arrive as GitHub issues.

### How reports arrive

- The country panel's **Report an issue** button opens the
  [data-error issue form](.github/ISSUE_TEMPLATE/data-error.yml) in a new
  tab with the title `Data: <Country>`, the `data` label, and the entry as
  the panel shows it: the six scores, confidence, last updated, data
  version, the citation string, the app URL, the source list, and, once the
  audit trail carries rationales, the sub-indicator rows in a collapsed
  block. The reader adds what is wrong and, ideally, a primary source
  (`src/controls/report.ts` builds the URL).
- The form's field ids (`country`, `what-is-wrong`, `evidence`, `entry`,
  `checks`) are what the URL prefills, so keep them in step with the code.
  `tests/report.test.js` checks the pairing.
- The `data` label has to exist in the repository for GitHub to apply it.
- The URL carries nothing but data already on screen. There is no
  analytics and no anonymous channel: a GitHub account is required.

### How a fix flows

A report never triggers re-research on its own. A maintainer reads it,
checks the evidence against the [methodology](public/methodology.html),
and then takes one of two routes:

1. **Re-research the country.** The pipeline redoes the entry with web
   search, updates all four stores together (`scores.csv`,
   `regulation_data.csv`, `history.json`, `subscores.json`), and mirrors to
   Supabase when configured:

   ```bash
   python scripts/update_data.py --countries "<name>"
   ```

   The stability gate holds a score change until it repeats on the next
   run or arrives with new evidence; pass `--no-gate` to land it at once
   when the report's evidence settles the question. `--no-batch` gives a
   synchronous run for a single country; `--dry-run` previews the result.

2. **Edit by hand.** For a wrong law, description, or source URL, edit
   `public/regulation_data.csv` directly. For a score, edit
   `public/scores.csv` and `public/data/subscores.json` together, bump the
   row's `Data Version`, and set `Last Updated`. `history.json` records
   snapshots from pipeline runs only, so a hand-edited score has no
   timeline entry; prefer route 1 when a score changes.

Either way: commit with the issue number in the message, open a pull
request, let CI run, and close the issue once the change is deployed. The
next weekly run re-researches every country, so a correction the model
cannot find in public sources may not survive it; say so on the issue and
add the source to the entry.
