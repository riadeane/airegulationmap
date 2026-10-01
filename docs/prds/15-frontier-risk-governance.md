# PRD 15: Frontier risk governance dimension

Status: Implemented, not launched (October 2026, tracking #154,
implementation #157). Merging the implementation is the launch (no switch),
so it waits on two things: the funding and authorship disclosure and the
value statement's final wording (#161), and verified frontier gold entries
(#106). Decided 2026-10-01: #158 (national level only), #159 (track lists,
below), #160 (a voluntary regime can reach 4). Done: #162, #163. PRD 16
phase 2 is implemented with it.

Research behind this PRD:
[`docs/research/frontier-risk-governance-scoring.md`](../research/frontier-risk-governance-scoring.md).

## Problem

The five scored dimensions measure how much AI governance is in force and
operating. Under the v3 anchors a 5 means "the instrument is in force, the
body is staffed and acting". It does not mean the regulation is good, and it
says nothing about whether a country's governance addresses catastrophic or
existential risk from frontier AI. A heavily implemented regime that ignores
frontier risk scores the same as one that addresses it. China's draft gold
entry (regulation status 4.75, policy levers 5.0, enforcement 4.25) scores
above Germany's on two of the three normative dimensions.

No maintained index fills this gap. The frontier-risk scorecards (FLI AI
Safety Index, SaferAI, METR, Midas) rate companies, not countries. The country
indices (GIRAI, Oxford Insights, the OECD.AI Index, CAIDP) measure readiness,
rights or capacity, with at most one binary frontier item (AI Safety Institute
network membership).

## Users and job

Policy researchers, civil society and funders working on catastrophic risk
from advanced AI, who need to see, per country, whether the state can see,
test and stop a dangerous frontier model, against a declared standard, with a
source behind every score. Secondary: the existing audience, who need to stop
reading the maturity composite as a quality rating (PRD 16).

## Goal

A seventh scored dimension, `frontier_risk` ("Frontier Risk Governance"),
that rates each country's governance of catastrophic risk from frontier AI
against a published standard drawn from the AI safety governance literature.
It is normative, applies to countries by track, caps the score at the
weakest applicable element, and never scores "not applicable" or "no
evidence" as a 1.

## Non-goals

- Changing the five existing dimensions or their v3 anchors. They stay the
  descriptive "how much is implemented" layer. `RUBRIC_VERSION` stays `v3`,
  so no calibration break.
- Adding `frontier_risk` to the `avg_score` maturity composite.
- Rating rights protection, fairness or present-day harms. That is a
  different lens; the Council of Europe Convention stays in
  `actor_involvement.international`.
- Rating companies or models.
- Claiming to measure how safe a country is. No study links these
  indicators to lower catastrophic risk (the Global Health Security Index's
  preparedness scores correlated with worse COVID-19 mortality). The
  dimension is an audit against a standard.

## Requirements

### Tracks

1. **Track file.** A committed `public/data/frontier_tracks.json`, assigned by
   the maintainer from data, never by the model: `{country, track, basis,
   sources, reviewed_on}`.
   - **H (frontier host):** home to a developer of a model at or above
     10^25 FLOP (the EU presumption threshold) in Epoch AI's model database:
     Epoch's compute column, or where it is blank an Epoch point estimate in
     the notes or its 10^25 list (not an upper bound); a subsidiary lab
     counts at its own headquarters. Decided (#159): United States, China,
     Saudi Arabia, United Kingdom, France. Checked against Epoch on
     2026-10-01: the provisional Canada, South Korea, Germany and UAE have no
     model within 2.5x of the threshold, and at 10^26 only the US qualifies.
   - **C (compute or chokepoint):** an operational site of at least 50,000
     H100-equivalents in Epoch's AI data centres hub (the GPU-cluster
     dataset is deprecated), or a sole or majority supplier of an
     accelerator step. Decided (#159): Malaysia, Indonesia, Norway, Taiwan,
     the Netherlands, Germany, South Korea, Japan. Licensed exports to a
     planned site do not count, so the UAE is G until Epoch shows Stargate
     UAE operational.
   - **G (global):** every other country.
   Validated by a pytest that every name matches `scores.csv` and every
   track is one of H, C, G. Reviewed each quarter.
2. **EU members** inherit the EU-level score on `developer_obligations` with
   an `eu_level: true` flag, shown in the UI, so one Brussels regulation is
   not counted as 27 national achievements (see #95).

### Sub-indicators and anchors

3. Four sub-indicators, integers 1 to 5 with the existing v3 semantics
   (5 in place and operating, 4 one element incomplete or not yet exercised,
   3 partial, 2 non-binding or preparatory only, 1 nothing observable), plus
   two non-numeric values: `na` (does not apply to this track) and
   `insufficient_evidence` (the model could not verify either way). Every
   score above 2 must cite a named instrument, body or agreement in its
   rationale.

   | Sub-indicator | Applies to | 5 | 4 | 3 | 2 |
   |---|---|---|---|---|---|
   | `developer_obligations`: binding duties on frontier developers | H | Statute in force with an adjustable or capability-based threshold, mandatory published safety and security framework, pre-release model reports, incident duties, penalties, and a regulator with model-access powers it has used | The above enacted but not yet applicable, enforcement deferred, or powers unused (EU GPAI regime and California SB 53 today; NY RAISE; Korea AI Basic Act) | A binding statutory hook or mandatory standards touching frontier risk without the full duty set (China's Cybersecurity Law AI clause plus TC260 standards) | Voluntary frameworks, a promotion law or company commitments only (Japan; UK; US federal layer) |
   | `evaluation_oversight`: state access and capacity to test frontier models before deployment | H, C | Legally mandated access for state or accredited evaluators before external and consequential internal deployment, with evaluations conducted and reported (no country yet) | Funded, staffed body with standing pre-deployment agreements covering most domestic frontier developers and a public record, or a legal mandate not yet exercised (US CAISI; UK AISI; EU AI Office) | Body with an evaluation mandate and some testing but limited access or record (Korea, Singapore, France, Canada) | Announced or recommended body, or one without staff or budget (India's guidelines; China's CnAISDA) |
   | `incident_emergency_preparedness`: can the state learn of a catastrophic AI incident and act | All | All three in force: statutory incident reporting to a named agency within 72 h (24 h if imminent); statutory whistleblower protection for catastrophic-risk disclosures; AI in a national emergency plan with legal authority to restrict or halt deployment (no country yet) | Two of the three in force (California) | One in force, or several enacted but not applicable (China: AI in the National Emergency Response Plan; New York from 2027) | Planned or recommended only (India) |
   | `international_coordination`: frontier-specific commitments and joint work | All | Measurement-network member, frontier-specific signatory (Bletchley plus Seoul), and a leading role in joint evaluation or verification (UK) | Network member plus frontier-specific texts (Japan, Korea, Canada, France, Australia, Singapore, Kenya) | Bletchley or Seoul Ministerial signatory, or a standing bilateral frontier-safety dialogue, without network membership (China; Rwanda; Nigeria) | Only broad declarations (Paris 2025, New Delhi 2026) |

   For track C, the `evaluation_oversight` rationale also records compute
   visibility in the country's own jurisdiction (licensing, know-your-customer
   rules for chip and cloud customers, anti-diversion enforcement). It does
   not reward alignment with another state's export controls.
4. **Pre-coded facts.** Summit signatories, measurement-network membership and
   similar public lists live in a committed reference file (like
   `blocs.json`), and `international_coordination` is computed from it, not
   researched. The model only adds bilateral dialogues and leading roles.
5. **Function over name.** Anchors score what a body does (testing unreleased
   models, legal access), not what it is called. The US and UK "safety to
   security" renames do not change a score by themselves.

### Aggregation

6. The dimension score is the mean of the applicable numeric sub-indicators
   (four for H, three for C, two for G), **capped at the lowest applicable
   sub-indicator plus 1**. If any applicable sub-indicator is
   `insufficient_evidence`, the dimension is `insufficient_evidence`.
7. Before launch, run a sensitivity check comparing arithmetic, geometric and
   capped aggregation on the gold countries, and publish how much ranks move.

### Pipeline

8. `models.py` gains a `FrontierRisk` dimension (`normative = True`, excluded
   from the composite) whose sub-indicators accept `na` and
   `insufficient_evidence`. The structured-output schema changes accordingly.
9. **Research depth by track.** Full web-search research of `frontier_risk`
   only for tracks H and C (about 15 countries). For track G, compute
   `international_coordination` from the reference file and research
   `incident_emergency_preparedness` with one targeted search. Keep the cost
   of a full run within 10% of today's.
10. `PROMPT_VERSION` bumps; `RUBRIC_VERSION` does not. The prompt carries the
    value statement's one-line standard and the anchors above.
11. **Stability gate.** `frontier_risk` changes go through the same gate as
    the other dimensions.
12. **Supabase.** Migration adding `frontier_risk numeric`, `frontier_track
    text`, `frontier_subscores jsonb` to `country_scores` and
    `public_export`, with column comments; refresh `public/openapi.json`.

### Quality

13. **Gold set.** Add hand-verified `frontier_risk` gold scores for about
    eight countries across all three tracks before launch. The dimension
    does not ship on draft gold scores.
14. **Signed bias.** The drift check reports signed mean error for
    `frontier_risk`, so a systematically optimistic or pessimistic model
    shows (#163).
15. **Behavioural checks.** A one-off script that re-scores the gold
    countries with shuffled anchor order and paraphrased prompts and reports
    how many scores move.
16. **Cross-validation.** Report the correlation with the OECD AISI-network
    flag, GIRAI Trust & Safety and Oxford Insights Resilience on the
    methodology page. It should be low; a high one means the dimension is
    re-measuring readiness.

### Frontend and pages

17. Presentation is specified in PRD 16. Minimum for this PRD: the score
    selector offers "Frontier Risk Governance" as its own lens (not a
    maturity dimension); `na` and `insufficient_evidence` render as their own
    states, never as the colour for 1; the tooltip and panel show the track;
    the panel shows the four sub-indicators with rationales; the JSON export,
    the static country pages and the print brief carry the dimension, track
    and flags.
18. **Methodology page.** A new section with the value statement, the named
    reference frameworks (International AI Safety Report 2026 risk taxonomy;
    EU GPAI Code of Practice systemic risks; METR's frontier-regulation
    reference fields; the binding-versus-voluntary coding of arXiv
    2608.19278; the IAPS 2026 priorities; the NTI Index for tracks; the
    OECD/JRC Handbook for aggregation), the critics' positions, the funding
    disclosure, and the validity caveat.

## Acceptance criteria

- A full run produces `frontier_risk` for every country with a track, and
  `na` or `insufficient_evidence` where they apply; no track-G country is
  scored on `developer_obligations`.
- No country's `frontier_risk` exceeds its lowest applicable sub-indicator
  plus 1 (pytest).
- The maturity composite and the five existing dimensions are unchanged for
  every country (pytest on a fixture run).
- The gold set holds verified `frontier_risk` entries for at least eight
  countries, and `drift.json` rows carry signed bias.
- The map never draws `na` or `insufficient_evidence` in the colour for 1
  (Vitest and e2e).
- Lint, typecheck, Vitest, pytest and e2e pass.

## Decisions

1. #158 (2026-10-01): **national level only**, as rubric v3.2. US state
   statutes (California SB 53, New York's RAISE Act) are named in the text
   and never raise a frontier score. EU law counts for EU members.
2. #159 (2026-10-01): the track rules and lists above, in
   `public/data/frontier_tracks.json`.
3. #160 (2026-10-01): **a voluntary evaluation regime can reach 4** on
   `evaluation_oversight`; its rationale says "voluntary".
4. #161: the public name is decided, **"Frontier Risk Governance"**
   (2026-09-28). Still open: the value statement's wording (a draft is on
   the methodology page), the right of reply, and the funding disclosure
   (an HTML comment marks its place; the dimension does not launch without
   it).

Implementation choices beyond the requirements: the lens has its own
sources and its own stability-gate decision, so frontier evidence never
moves the five dimensions; `international_coordination` is fully computed
(bilateral dialogues and leading roles are curated in the reference file,
not added by the model); element (b) of incident preparedness needs
whistleblower protection written for or extended to AI; the September 2026
Call for Control of Frontier AI Models counts as a frontier-specific text.

## Risks

- **Read as advocacy.** An x-risk score from a project that states no values
  will be read through the EA-funding lens. Mitigation: the value statement,
  critics cited alongside supporters, funding disclosed, the "Report an
  issue" channel as a right of reply.
- **Thin evidence.** Frontier-risk facts are sparse and often in national
  languages. Mitigation: `insufficient_evidence` instead of defaulting low,
  track-scoped research, pre-coded public lists.
- **Anchors age fast.** The literature has moved to internal deployment and
  weight security within a year. Review the anchors each quarter; a change to
  them bumps a frontier-specific rubric version and records a break for this
  dimension only.
