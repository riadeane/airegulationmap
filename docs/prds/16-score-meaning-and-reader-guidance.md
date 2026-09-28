# PRD 16: Score meaning and reader guidance

Status: Proposed (September 2026, tracking #154, implementation #155).
Owner: unassigned. Depends on: decisions in #156 for phase 1; PRD 15 (#157)
for phase 2.

## Problem

Readers take a high score as praise. A 5 under the v3 anchors means the
instrument is in force and the body is operating. It does not mean the
regulation is good, and the app never says so where the number is read. An
audit of every score surface (September 2026) found eight signals that point
the other way:

1. **Colour.** The map ramp runs red to blue, and `_tokens.css` describes it
   as low = "warning / less coverage", high = "mature / well-developed". It is
   applied to every dimension, including the two descriptive ones, and
   repeated in the panel score bar, the bloc range bar and the scatter key.
2. **Endpoint labels** in `LEGEND_ENDPOINTS` (`src/constants.ts`): "Minimal →
   Comprehensive" (also used for the composite), "Weak → Strong", and
   "Limited → Broad" on a descriptive dimension.
3. **The name.** "Maturity Index" in the app and pages, "regulatory maturity
   index" in the methodology, "Average Score" in exports, `avg_score` in the
   API.
4. **Ranking.** "Rank X of Y" (descending by maturity) in the panel, the
   static pages and their meta descriptions.
5. **Superlatives.** "Highest" and "Lowest" on the bloc card; bloc peers
   defined as "members with the highest maturity index".
6. **Change arrows.** Blue ↑ and red ↓ in the changelog and the "This week"
   strip, descriptive dimensions included, so a governance-type move towards
   "Centralized" shows red.
7. **Methodology phrasing.** "Higher means more developed", "Today's leading
   jurisdictions reach 5", "would reward or punish countries".
8. **Recipes.** data.html's "High-confidence countries, ranked by maturity".

Only the static pages mark descriptive dimensions in text. In the app the only
cue is that descriptive dots in the panel are grey; everything else treats
them like the normative ones. There are no info buttons, no legend
explanation, no dimension descriptions, and the first-visit intro and help
overlay explain controls and shortcuts but not what a score means.

PRD 15 adds a seventh lens that is evaluative in a different way (distance to
a stated frontier-risk standard, with tracks and "not applicable" states).
Without a clear vocabulary the two kinds of score will be confused.

## Users and job

Policy researchers, academics, policymakers and civil society (CLAUDE.md
"Design Context"). They read carefully, cite in footnotes, and must be able to
say accurately what a score claims. Their job here: read any score and know,
without leaving the view, what it measures, what a 1 and a 5 mean, and what
it does not claim.

## Goal

Every score is read the way the methodology intends:

- **Implementation** (regulation status, policy levers, enforcement and their
  composite): how much AI governance is in force and operating. Higher means
  more in force, not better.
- **Governance style** (governance type, actor involvement): how a country
  governs. Neither end is better.
- **Frontier risk governance** (PRD 15): distance to a stated standard for
  catastrophic-risk governance, where the standard is named on the page.

And the app becomes easier to learn for a first-time visitor, with the
explanation reachable in one click from wherever a score appears.

## Non-goals

- Changing any score, anchor or the composite's formula.
- Renaming data fields (`avg_score`, CSV headers in `public/scores.csv`) or
  API columns. Display labels change; data contracts do not. Exports may add
  fields, never rename existing ones.
- A tutorial or product tour. Guidance lives where scores are read.
- Visual redesign beyond what score meaning and ease of use require. The
  design principles in CLAUDE.md stand: the map is the protagonist, rigour
  over ornament, calm density.

## Requirements

### Phase 1: implementation and style (independent of PRD 15)

**Vocabulary**

1. **One source of truth.** Add to `src/constants.ts` a record per attribute:
   `{label, group, question, low, high, notClaim}`. `question` is the one-line
   thing the score answers ("How much AI-specific regulation is in force?").
   `notClaim` is the one line on what it does not say ("Not a judgement of
   whether the rules are good."). Every surface below reads from it, and the
   static page generator reuses it.
2. **Rename the composite for display.** Recommended: **"Implementation
   index"**. Alternatives for the decision: "Regulatory extent index", or keep
   "Maturity index" and rely on the explanation. The methodology keeps a note
   that it was called the maturity index before this change, and exports keep
   the `Average Score` column with the new name in the JSON metadata.
3. **Neutral endpoints.** Replace evaluative endpoint labels with states that
   match the v3 anchors, for example:
   - Implementation index: "Little in force" → "Extensively in force"
   - Regulation status: "No binding AI rules" → "Binding cross-sector rules in force"
   - Policy levers: "Few instruments" → "Many instruments in use"
   - Enforcement: "None observed" → "Routine, published enforcement"
   - Governance type: "Centralised" → "Distributed" (unchanged meaning, British spelling)
   - Actor involvement: "Narrow" → "Broad"
   Final wording is reviewed against the anchors in `prompt.py`.
4. **Group names in copy.** User-facing copy says "implementation
   dimensions" and "governance style dimensions". "Normative" and
   "descriptive" stay in code and in the methodology's technical section.

**Colour**

5. **Stop signalling good and bad.** Replace the red-to-blue ramp for the
   implementation lens with a single-hue sequential ramp (light = less in
   force, dark = more), in OKLCH, colourblind-safe, with both themes.
   Governance style uses a separate, visibly different neutral ramp (this
   supersedes or merges the open descriptive-palette PR #29, decided in
   #111). Update the token comment in `_tokens.css` so it no longer describes
   the ramp as warning versus mature.
6. **Change arrows are neutral.** ↑ and ↓ in the changelog and "This week"
   strip use one neutral colour for all dimensions; direction is carried by
   the glyph and the signed number.
7. **Score bars and the bloc range bar** use the lens's ramp, not a fixed
   red-to-blue gradient.

**Ranking and superlatives**

8. **Remove rank.** Drop "Rank X of Y" from the panel, the static pages and
   their meta descriptions. A reader who wants an order can sort the
   comparison table or use the API.
9. **Bloc card.** "Highest" and "Lowest" become the values themselves with
   neutral labels ("Most in force", "Least in force" on implementation;
   "Most distributed", "Most centralised" on governance type).
10. **Peer chips.** Bloc peers become "other members closest in
    implementation index", not "highest".
11. **data.html.** Rename the recipe ("High-confidence countries by
    implementation index") and keep the query.

**Explanation where the number is read**

12. **Score selector.** Group options under headings ("Implementation",
    "Governance style", later "Frontier risk governance"), each option with
    its one-line `question` under the label.
13. **Legend.** Under the ramp, one line: the lens's `question`, and for
    implementation the `notClaim` line. A small "What does this mean?" link
    opens the explainer (requirement 16). Screen-reader text in the live
    region carries the same line.
14. **Tooltip.** `{label}: {score} / 5` gains the group in plain words on the
    first line of the lens ("Implementation index: 4.25 / 5, how much is in
    force"). Keep it to one extra phrase; the map stays the protagonist.
15. **Panel.**
    - Each block has a caption: "Implementation: how much is in force, not
      how good it is"; "Governance style: how, not how well".
    - Expanding a dimension shows, next to each sub-indicator score, what
      that level means from the anchors ("4: in place, one element
      incomplete or not yet exercised").
    - The confidence badge and evidence sentence stay; the high-confidence
      tooltip stops citing "enacted legislation", which ties confidence to
      the thing being scored (see #93).
16. **"How to read this map" explainer.** One short, calm panel reachable
    from the legend link, the panel header, the empty state and the help
    button (which today shows keyboard shortcuts only; shortcuts move to a
    second section). Content: the three lenses in one sentence each, what 1
    and 5 mean, "higher is not better" stated plainly, confidence and the
    hatch, and a link to the methodology. The desktop intro and mobile
    first-run hint point to it instead of listing controls only.
17. **Comparison.** The radar plots implementation dimensions only;
    governance style appears as a separate labelled strip, so a larger shape
    reads as "more in force" and descriptive axes do not inflate it. Table
    rows carry group headings.
18. **Scatter.** The dot-colour key reads "Implementation index" with the
    new endpoints; axis labels come from the shared vocabulary.

**Pages and outputs**

19. **Methodology.** A plain-language "What a score means, and what it does
    not" section at the top. Remove "higher means more developed", "leading
    jurisdictions" and "reward or punish"; restate them in terms of extent.
20. **Static country pages and print brief.** Use the shared vocabulary,
    drop rank, and add the one-line "not a judgement of quality" note under
    the scores table.
21. **Exports.** JSON export gains a `meta` block with each field's
    `question`, scale endpoints and `notClaim`; CSV export keeps its columns
    and the export dialog links the explainer.
22. **API docs and OG image.** `public/openapi.json` descriptions (applied at
    load time in `src/apiDocs.ts` so a refresh keeps them) and the OG image's
    "MINIMAL … COMPREHENSIVE" bar use the new vocabulary.

**Ease of use (folded in because they block comprehension)**

23. Fix the header overlap between 769 and ~1280 px (#73) and make map
    regions reachable by keyboard and assistive technology (#139), since the
    explainer and legend links must be reachable the same way.
24. Governance type 1.0 currently means both "single national authority" and
    "no AI governance at all" (#96). Until #96 is decided, the panel shows
    "No AI governance activity observed" instead of a governance-type score
    where every implementation dimension is 1.

### Phase 2: frontier risk governance (after PRD 15 ships data)

25. The selector's third group, "Frontier risk governance", with its
    `question` ("How close is governance of catastrophic frontier-AI risk to
    the standard stated in the methodology?") and a link to the value
    statement.
26. Its own ramp in a hue distinct from implementation, and two non-numeric
    map states: "Not applicable (no frontier developer or compute)" and
    "Insufficient evidence", each with a legend key and never drawn in the
    colour for 1.
27. Tooltip and panel show the country's track (frontier host, compute or
    chokepoint, global) in words, and the EU-level flag where it applies.
28. The explainer and methodology describe the lens, the tracks, the cap at
    the weakest element, and the validity caveat in plain words.

## Evaluation

- **Comprehension check before and after.** Five to eight people from the
  audience answer, unaided, on the current app and on the phase 1 build:
  "Country A scores 4.5 and country B 2.0 on the default map. Does A regulate
  AI better than B?" (correct: the map does not say; A has more in force),
  "What does governance type 5 mean?", and "Where would you check what a 3
  means?". Target: at least 80% correct on phase 1, reported in the PR.
- **Copy audit.** A Vitest test fails if a banned word ("rank", "highest",
  "lowest", "best", "leading", "weak", "strong", "comprehensive",
  "mature", "maturity" outside the methodology's history note) appears in
  `constants.ts` labels or the rendered panel, legend, bloc card and tooltip
  strings.
- **Visual.** Playwright screenshots of the map, legend, panel, bloc card,
  comparison and explainer in both themes and at 360 px, plus axe checks.

## Acceptance criteria

- No surface shows rank or superlatives for any score.
- Every place a score appears shows, or links in one click to, what it
  measures and what it does not claim.
- Implementation and governance style use visibly different ramps, and
  neither uses red for low.
- Change arrows carry no good or bad colour.
- The methodology opens with the "what a score means" section.
- Data files, CSV headers and API column names are unchanged.
- Lint, typecheck, Vitest, pytest (page generator) and e2e pass in both themes.

## Open decisions (#156)

1. Display name for the composite: "Implementation index" (recommended),
   "Regulatory extent index", or keep "Maturity index".
2. Remove rank everywhere (recommended), or keep it on the static pages only.
3. The palette: single-hue sequential for implementation plus a distinct
   neutral ramp for governance style (recommended, resolves #29 in #111), or
   keep one ramp and rely on text.
