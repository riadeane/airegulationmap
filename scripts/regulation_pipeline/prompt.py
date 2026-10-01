"""The research prompt template and its rendering.

Separated from the API transport (:mod:`api`) so the carefully-calibrated
rubric text is easy to find and edit. The prompt documents the same
sub-indicator structure the :mod:`models` enforce; the models are the source of
truth for the *shape*, the prompt for the *meaning* of each 1-5 level.
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .frontier import FrontierPrompt

# Recorded in research_runs provenance so a score can always be traced to
# the prompt that produced it. Bump when the rubric or structure changes.
# v3 (2026-09): fixed anchors. Each level describes an observable state; a 5
# is no longer "the global frontier today", so scores compare across time.
# v3.1 (2026-09): every sub-indicator is {score, rationale}. The rubric is
# unchanged, so this bump is a structure change, not a calibration break.
# v3.2 (2026-09): the existing-data block also shows the Enforcement Level
# text (it showed four of the five dimensions). Context only; same rubric.
# v3.3 (2026-09, issue #162): a sub-indicator score may be null (insufficient
# evidence), and a 1 needs positive evidence of absence. The lower-level
# tie-break applies only when evidence supports both levels. This changes
# the scale (thinly covered countries no longer default to 1), so it comes
# with rubric v3.1.
# v3.4 (2026-09): context and style only; same rubric. The existing-data
# block also shows the current Specific Laws and Sources, with a rule to
# reuse a still-accurate name or URL verbatim (#88: rewording and URL churn
# passed the stability gate as evidence); a style rule for the text fields
# (no leading "As of <date>," clause, no hedging, one statement of an
# absence, complete lists; #141); and a rule never to construct OECD.AI
# country-dashboard URLs, which no longer exist (#92).
# v3.5 (2026-10): rubric v3.2. The first v3.1 run (2026-09-28) gave 5s on
# the strength of one instrument and counted US state statutes, so a 5
# now needs every element of its anchor in force, applicable and
# exercised (anything deferred caps at 4); only the national level counts
# (EU law counts for EU members); general law applied to AI scores at most
# 2; a one-use-case rule at most 3 on binding_force and 2 on scope; and
# the twelve implementation sub-indicators spell out all five levels.
# v3.6 (2026-10, PRD 15): a Frontier Risk Governance section and a
# "frontier_risk" block in the answer, holding the sub-indicators the
# country's track asks for. The five dimensions' rubric is unchanged, so
# this is no calibration break; the lens has its own anchors generation
# (models.FRONTIER_RUBRIC_VERSION).
PROMPT_VERSION = "v3.6-2026-10"

# The rubric generation alone (the part of PROMPT_VERSION a calibration
# break is about). Bump it with the rubric: the first full run on a new
# rubric then records a calibration break and runs ungated automatically
# (history.calibration_due), so a scale change never lands as silent drift.
# v3.1 (2026-09, issue #162): the v3 anchors plus the insufficient-evidence
# value (null), which is no longer scored as 1.
# v3.2 (2026-10): tighter anchors (see PROMPT_VERSION v3.5). Scores move
# down where a 5 rested on one instrument, deferred obligations or
# sub-national law.
RUBRIC_VERSION = "v3.2"

# The evidence-grounded variant (same rubric + output schema, plus a
# verified-records block). Grounded prompts are LONGER than plain ones -
# pair grounded runs with --batch for the 50% token pricing.
GROUNDED_PROMPT_VERSION = "v3.6-grounded-2026-10"

# Caps keeping the evidence block bounded: the most recent initiatives
# carry the signal, and full overviews would dwarf the rubric.
MAX_GROUNDED_INITIATIVES = 15
MAX_OVERVIEW_CHARS = 400

RESEARCH_PROMPT = """You are a researcher specializing in AI policy and regulation worldwide.

Country: {country}
Today's date: {today}

Existing data (may be outdated):
- Regulation Status: {existing_reg_status}
- Policy Lever: {existing_policy}
- Governance Type: {existing_governance}
- Actor Involvement: {existing_actors}
- Enforcement Level: {existing_enforcement}
- Specific Laws: {existing_laws}
- Sources: {existing_sources}

Research the current state of AI regulation in {country} as of {today}.
Consider recent legislation, executive orders, national strategies, and international agreements.

Each of the five dimensions is scored through FOUR concrete sub-indicators, each
scored 1-5 (or null for insufficient evidence, see below). The dimension score is
computed downstream as the mean of the numeric scores - you never report a dimension
total. Score every sub-indicator strictly against its written definition.

Every sub-indicator is an object {{"score": <integer 1-5, or null>, "rationale": "<one sentence>"}}.
The rationale states the single fact the score rests on. Name the instrument, body,
or date where one exists (e.g. "AI Act (Regulation 2024/1689) in force since 1 August
2024"). One sentence, at most 200 characters. State facts only: no hedging phrases
such as "appears to", "may", "likely", or "it is possible that". If no fact supports
a higher score, say what is absent ("No AI-specific instrument exists or is proposed").
A null score means insufficient evidence; its rationale says what you searched and
did not find (e.g. "No source on AI enforcement found on the ministry, gazette or
regulator sites").

Calibration - read before scoring:
- Each level describes an observable state. Score the state that sources dated on or
  before today let you verify. Do not score the direction of travel, and do not score
  the gap to other countries. A country's score changes only when its own record
  changes.
- 5 = every element of the sub-indicator's 5 anchor is in force, applicable and
  exercised. The instrument applies today, the body is staffed and using its powers,
  the practice is routine and published. Any element that is deferred, stayed, in a
  transition period, not yet applicable or not yet exercised caps the score at 4. A 5
  is not a ranking (it does not need the best record in the world) and not a judgement
  that the rules are good; it means the anchor is met in full. Expect 5s to be rare,
  and never give one on the strength of a single instrument.
- 4 = the state is in place, but one element is incomplete, deferred, in a transition
  period, or not yet exercised in practice.
- 3 = the state exists in part: partial scope, one instrument or body, isolated
  actions, or rules drafted but not in force.
- 2 = only non-binding or preparatory activity: a strategy, a consultation, or general
  law with no AI-specific provision.
- 1 = no observable activity for that sub-indicator. A 1 needs positive evidence of
  absence: a source that states the thing does not exist, or a well-covered country
  whose official record you checked (e.g. the government, legislature, gazette and
  regulator portals) and where nothing exists. Not finding anything is not by itself
  evidence of absence.
- null = insufficient evidence: no source you found confirms either the presence or the
  absence of what the sub-indicator asks about. Return null for the score and say in the
  rationale what you searched. Null is not a low score; do not use it to avoid a hard
  judgment when the evidence supports a level.
- Score the national level only. For an EU member state, EU regulations and
  directives that apply in it count as its national law. Laws, agencies and actions of
  states, provinces, regions or cities never raise a regulation_status, policy_lever or
  enforcement_level sub-indicator; record them in governance_type.subnational_role and
  in the text.
- AI-specific means written for AI: a binding rule whose subject is AI systems, AI
  models or their outputs. General law with no provision written for AI (data
  protection, consumer protection, competition, product liability, export control,
  cybersecurity) is not AI-specific, even when a regulator applies it to AI firms. On
  the regulation_status, policy_lever and enforcement_level sub-indicators it scores
  at most 2, except where an anchor below says otherwise.
- A narrow instrument stays narrow. A binding rule that covers one use case or one
  kind of content (for example deepfakes, intimate images, election content, or one
  type of chatbot) scores at most 3 on binding_force and at most 2 on scope, however
  strictly it binds.
- Examples of where the anchors land (illustrations, not the definition): a
  cross-sector AI law in force whose main obligations apply from a later date scores 5
  on ai_specificity, 4 on binding_force and scope, and at most 4 on implementation; a
  country whose only national AI-specific binding rule targets one use case scores 3
  on binding_force and 2 on scope; a country whose only instrument is a published
  national AI strategy sits near 2; no AI-specific policy activity is 1.
- When the evidence supports two adjacent levels and you are torn between them, give
  the lower one. This tie-break applies only between levels the evidence supports; it
  never turns missing evidence into a 1.
- governance_type and actor_involvement are DESCRIPTIVE scales, not quality scales.
  They record HOW a country governs, not how well. A highly centralized
  single-authority system scores LOW on governance_type sub-indicators even when it is
  highly effective. Exclusion of domestic civil society means a LOW civil_society
  score no matter how internationally active the government is.
- Do not reward activity volume, ambition, or announcements. Score only what the
  sub-indicator definition asks about, and make each dimension's "text" justify the
  sub-scores you gave.

Style for each dimension's "text" and for "specific_laws":
- Do not open with a date clause such as "As of September 2026,". The research date
  is recorded separately.
- State facts plainly, with no hedging ("appears to", "may", "likely", "reportedly").
- State an absence once ("No AI-specific law, regulator or enforcement mechanism
  exists."), not in a run of sentences that each begin with "No".
- Name instruments in full. Do not end a list with "etc." or "among others".
{frontier_section}
Return ONLY a valid JSON object with these exact keys:
{{
  "regulation_status": {{
    "binding_force": {{"score": <1 = nothing binding exists or proposed; 2 = binding AI rules announced or proposed, not yet before the legislature; 3 = binding AI legislation in the legislative process, or binding AI rules in force for one use case only; 4 = binding AI rules in force for several sectors or use cases, or a cross-sector AI law adopted whose main obligations do not yet apply; 5 = binding AI rules in force whose obligations apply today across sectors>, "rationale": "<the one fact behind this score>"}},
    "scope": {{"score": <1 = no AI coverage in any sector; 2 = one use case, one kind of content, or the public sector only; 3 = a few sectors or use cases covered; 4 = cross-sector coverage by design, with major parts (such as high-risk duties) not yet applicable; 5 = horizontal cross-sector coverage that applies today, including high-risk uses in the private sector>, "rationale": "<the one fact behind this score>"}},
    "implementation": {{"score": <1 = paper commitments only; 2 = adopted, with no implementing rules, guidance or competent authority yet; 3 = partially in force or in transition period; 4 = in force with most implementing rules and guidance issued, but gaps remain (an authority not designated, standards unfinished, deadlines deferred); 5 = fully operational: every obligation applies, implementing rules, standards and guidance are issued, and every competent authority is designated and acting>, "rationale": "<the one fact behind this score>"}},
    "ai_specificity": {{"score": <1 = only general law incidentally touching AI; 2 = general law applied to AI by regulators or courts, with no provision written for AI; 3 = AI explicitly addressed within adapted general law; 4 = a dedicated AI-specific instrument covering one area or use case; 5 = dedicated AI-specific instruments covering AI systems generally>, "rationale": "<the one fact behind this score>"}},
    "text": "<current regulatory approach, 1-3 sentences justifying the sub-scores>"
  }},
  "policy_lever": {{
    "binding_instruments": {{"score": <1 = no binding instruments; 2 = only general law (data protection, consumer protection, competition, export control) applied to AI; 3 = one AI-specific binding instrument; 4 = two AI-specific binding instruments in force, or more where some do not yet apply; 5 = three or more AI-specific binding instruments in force and applying today, in different domains>, "rationale": "<the one fact behind this score>"}},
    "soft_law": {{"score": <1 = no guidance/standards/codes; 2 = one high-level principles or ethics document; 3 = some published guidance; 4 = national guidance and standards in several areas, not maintained or not referenced by regulators; 5 = a maintained suite of national guidance, standards and codes, updated in the last two years and referenced by regulators>, "rationale": "<the one fact behind this score>"}},
    "economic_tools": {{"score": <1 = no funding/procurement/sandbox programs; 2 = funding announced but not yet disbursed; 3 = one or two programs; 4 = several funded programs, but no operating regulatory sandbox or AI procurement rules; 5 = several funded programs plus an operating regulatory sandbox and AI procurement rules>, "rationale": "<the one fact behind this score>"}},
    "institutional_capacity": {{"score": <1 = no dedicated bodies; 2 = an advisory council or a ministry unit with no legal AI mandate; 3 = bodies designated but thinly resourced; 4 = a staffed body with a legal AI mandate that has not yet used its compliance powers; 5 = staffed institutions with a legal AI mandate that use compliance powers (inspections, approvals, binding decisions)>, "rationale": "<the one fact behind this score>"}},
    "text": "<policy mechanisms used, 1-2 sentences>"
  }},
  "governance_type": {{
    "regulator_plurality": {{"score": <DESCRIPTIVE: 1 = single authority sets and enforces policy; 3 = lead body plus sectoral regulators; 5 = many independent regulators with their own remits>, "rationale": "<the one fact behind this score>"}},
    "formal_coordination": {{"score": <DESCRIPTIVE: 1 = single actor, nothing to coordinate; 3 = ad hoc coordination; 5 = formal coordination mechanisms across many bodies>, "rationale": "<the one fact behind this score>"}},
    "subnational_role": {{"score": <DESCRIPTIVE: 1 = no sub-national role; 3 = sub-national implementation of national rules; 5 = states/provinces regulate AI independently>, "rationale": "<the one fact behind this score>"}},
    "nongovernmental_checks": {{"score": <DESCRIPTIVE: 1 = no court/ombudsman/independent-review role; 3 = occasional judicial or independent review; 5 = courts and independent bodies actively shape AI rules>, "rationale": "<the one fact behind this score>"}},
    "text": "<governance structure, 1-2 sentences>"
  }},
  "actor_involvement": {{
    "industry": {{"score": <DESCRIPTIVE: 1 = no structured industry input; 3 = published consultations and working groups; 5 = standing formal roles in policy-making>, "rationale": "<the one fact behind this score>"}},
    "civil_society": {{"score": <DESCRIPTIVE: 1 = civil society excluded from domestic process; 3 = consulted occasionally; 5 = standing formal roles for NGOs/unions>, "rationale": "<the one fact behind this score>"}},
    "academia": {{"score": <DESCRIPTIVE: 1 = no academic involvement; 3 = some advisory input; 5 = formal standing advisory roles>, "rationale": "<the one fact behind this score>"}},
    "international": {{"score": <DESCRIPTIVE: 1 = no participation in international AI governance; 3 = signatory to declarations; 5 = active treaty/standards participation>, "rationale": "<the one fact behind this score>"}},
    "text": "<actors and geographic scope, 1-2 sentences>"
  }},
  "enforcement_level": {{
    "sanctions_framework": {{"score": <1 = no penalties defined; 2 = only general-law penalties reach AI; 3 = penalties defined for some AI-specific obligations; 4 = penalties defined for most AI-specific obligations, or for all where some do not yet apply; 5 = penalties defined and applicable for every AI-specific obligation in force>, "rationale": "<the one fact behind this score>"}},
    "actions_taken": {{"score": <1 = never enforced; 2 = warnings issued or investigations opened, with no decision, or actions under general law only; 3 = isolated enforcement decisions under AI-specific law; 4 = repeated enforcement decisions under AI-specific law, not routinely published; 5 = routine, published enforcement decisions under AI-specific law, including sanctions imposed>, "rationale": "<the one fact behind this score>"}},
    "dedicated_authority": {{"score": <1 = nobody owns AI enforcement; 2 = general regulators act on AI within their existing remits; 3 = authority designated without dedicated resources; 4 = resourced authority with an explicit AI remit for part of the AI rules in force; 5 = resourced authority with an explicit AI remit covering all AI rules in force>, "rationale": "<the one fact behind this score>"}},
    "monitoring_practice": {{"score": <1 = no audits or monitoring; 2 = monitoring planned, or one-off studies; 3 = occasional reviews; 4 = regular monitoring without public reporting, or audits in one sector; 5 = routine audits across sectors with regular public reporting>, "rationale": "<the one fact behind this score>"}},
    "text": "<how strictly rules are enforced, 1 sentence>"
  }},
  "specific_laws": "<REQUIRED if any exist: comma-separated official names of laws, acts, executive orders, or national strategies WITH years, e.g. 'AI Act (2024), Data Protection Act (2018)'. Empty string ONLY if no AI-relevant instrument of any kind exists>",
  "sources": "<REQUIRED: 1-5 pipe-separated URLs supporting your claims. Strongly prefer primary sources: government ministry sites, official gazettes, legislature pages, regulator websites. Secondary sources (OECD.ai, IAPP, law-firm trackers) are acceptable if no primary source is available>",
  "confidence": "<high|medium|low>"{frontier_keys}
}}

Source requirements:
- Every response MUST include at least one source URL unless genuinely none exists.
- Only include URLs you are confident are real. NEVER fabricate or guess URLs. If you
  cannot recall an exact deep link, give the official top-level page you are certain
  exists (e.g. the ministry or regulator homepage) rather than a guessed path.
- Never construct OECD.AI country-dashboard URLs (oecd.ai/en/dashboards/countries/...):
  those pages no longer exist. Cite an OECD.AI page only when you found its exact URL.
- The existing Specific Laws and Sources above are the current published entry. Where
  an instrument or URL in them is still accurate, reuse its exact name or URL rather
  than rewording it or citing another page that says the same thing. Drop what is
  no longer accurate, and add what is new.
- Every cited URL is checked after research; a URL that returns "not found" is
  removed, and an entry left without a source is published as low confidence.
- If you cannot support your assessment with any source, set "sources" to "" AND set
  "confidence" to "low".
- "confidence" must be "high" only when claims are backed by enacted legislation with
  primary sources; "medium" for mixed or secondary sourcing; "low" for sparse
  information or no sources.

Return ONLY the JSON object. No preamble, no explanation, no markdown.
"""


def render_prompt(
    country: str, today: date, existing_reg: dict | None, frontier: FrontierPrompt | None = None,
) -> str:
    """Fill the research prompt for one country. ``existing_reg`` is the current
    regulation_data row (or ``None`` for a country we have no prior data on).
    With ``frontier`` the prompt adds the Frontier Risk Governance section and
    asks for a ``frontier_risk`` block holding the track's sub-indicators;
    without it, the prompt is the five dimensions alone."""
    existing = existing_reg or {}
    return RESEARCH_PROMPT.format(
        frontier_section=render_frontier_section(country, frontier) if frontier else "",
        frontier_keys=render_frontier_keys(country, frontier) if frontier else "",
        country=country,
        today=today.isoformat(),
        existing_reg_status=existing.get("Regulation Status", "Unknown"),
        existing_policy=existing.get("Policy Lever", "Unknown"),
        existing_governance=existing.get("Governance Type", "Unknown"),
        existing_actors=existing.get("Actor Involvement", "Unknown"),
        existing_enforcement=existing.get("Enforcement Level", "Unknown"),
        existing_laws=existing.get("Specific Laws") or "None recorded",
        existing_sources=existing.get("Sources") or "None recorded",
    )


# -- Frontier Risk Governance (PRD 15) -------------------------------------------

# The standard the lens rates against, in one line: the methodology's value
# statement carries the full version and its reference frameworks.
FRONTIER_STANDARD = (
    "whether the state can see, test and stop a dangerous frontier AI model: national "
    "governance of catastrophic risk from the most capable general-purpose AI models "
    "(chemical, biological, radiological and nuclear misuse, cyber offence, loss of "
    "control, harmful manipulation), against a stated standard drawn from the frontier "
    "AI safety governance literature"
)

# The anchors of the four sub-indicators, in the placeholder form the
# five dimensions use (`1 = ...; 2 = ...`). The first three are sent to the
# model on the tracks they apply to; international_coordination is
# computed from public lists (frontier.FrontierContext.international) and
# is listed here so the methodology page can quote one source for all four.
FRONTIER_ANCHORS: dict[str, str] = {
    "developer_obligations": (
        "1 = no binding rule, voluntary framework or company commitment touches frontier "
        "developers; 2 = voluntary frameworks, a promotion law without duties, or company "
        "commitments only; 3 = a binding statutory hook or mandatory standards touching "
        "frontier-model risk, without the full duty set; 4 = a statute with the full duty "
        "set (a compute or capability threshold, a mandatory published safety and security "
        "framework, pre-release model reports, incident duties, penalties, and a regulator "
        "with model-access powers) enacted but not yet applicable, its enforcement deferred, "
        "or its model-access powers not yet used; 5 = that statute in force, with a threshold "
        "the regulator can adjust or that is capability-based, and a regulator that has used "
        "its model-access powers"
    ),
    "evaluation_oversight": (
        "1 = no state body evaluates frontier AI models; 2 = an evaluation body announced or "
        "recommended, or one without dedicated staff or budget; 3 = a body with an evaluation "
        "mandate that has tested some frontier models, with limited access or public record; "
        "4 = a funded, staffed body with standing pre-deployment access agreements covering "
        "most of the frontier developers it oversees and a public record of evaluations, or a "
        "legal access mandate not yet exercised; 5 = legally mandated access for state or "
        "accredited evaluators before external and consequential internal deployment, with "
        "evaluations conducted and reported"
    ),
    "incident_emergency_preparedness": (
        "1 = none of elements (a) to (c) exists or is planned; 2 = one or more planned or "
        "recommended only (a strategy, guideline or bill not yet enacted); 3 = one element "
        "in force, or several enacted but not yet applicable; 4 = two of the three in force; "
        "5 = all three in force, with a reporting deadline of 72 hours or less (24 hours "
        "where harm is imminent) and legal authority to restrict or halt the deployment of "
        "an AI model"
    ),
    "international_coordination": (
        "1 = no AI summit text, network membership or frontier-safety dialogue; 2 = only "
        "broad AI declarations (Paris 2025, New Delhi 2026); 3 = a signatory of a "
        "frontier-specific text (the Bletchley Declaration, a Seoul text, or the 2026 Call for "
        "Control of Frontier AI Models), a network member without one, or a party to a standing "
        "bilateral frontier-safety dialogue; 4 = a measurement-network member that signed a frontier-specific "
        "text; 5 = a network member that signed the Bletchley Declaration and a Seoul text "
        "and holds a leading role in joint evaluation or verification"
    ),
}

# What the three elements of incident_emergency_preparedness are.
FRONTIER_INCIDENT_ELEMENTS = (
    "(a) statutory AI incident reporting to a named agency with a fixed deadline; "
    "(b) statutory whistleblower protection that covers disclosures of catastrophic AI "
    "risk; (c) AI risk in a national emergency or crisis plan with a designated lead"
)

_TRACK_MEANING = {
    "H": (
        "frontier host: a developer of a frontier model (training compute at or above "
        "10^25 FLOP) is based here, so all four sub-indicators apply"
    ),
    "C": (
        "compute or chokepoint: frontier-scale AI compute is hosted here, or the country is "
        "a node in the advanced-chip supply chain, but no frontier developer is based here; "
        "developer_obligations does not apply"
    ),
    "G": (
        "global: no frontier developer or frontier-scale compute is based here; "
        "developer_obligations and evaluation_oversight do not apply"
    ),
}

_FRONTIER_SECTION = """
Frontier Risk Governance - a separate lens, answered in "frontier_risk":
This lens rates {standard}. It does not rate rights protection, present-day harms, or
how much AI governance is in force, and it never changes the five dimensions above:
score them exactly as you would without this section.

{country} is on track {track}, {meaning}. Score only the sub-indicators listed in
"frontier_risk" below. international_coordination is computed from public lists of
summit signatories and network members; do not score it.

Rules for this lens:
- The calibration rules above apply here too: score the observable state today, a 5
  needs every element of its anchor in force, applicable and exercised, null means
  insufficient evidence, and a 1 needs positive evidence of absence.
- National level only. Laws of states, provinces or cities (for example California's
  SB 53 or New York's RAISE Act) never raise a frontier score; name them in the text.
{eu_rule}- Score what a body does, not what it is called. A renamed institute (for example from
  "safety" to "security" or "standards") scores what it does: testing unreleased models
  for chemical, biological, cyber or loss-of-control risk is what counts.
- Every score above 2 names the instrument, body or agreement in its rationale.
- Voluntary frameworks or commitments support at most 2 on developer_obligations. On
  evaluation_oversight a voluntary access agreement can support a 4 when it meets the 4
  anchor; the rationale then says "voluntary".
- incident_emergency_preparedness counts three elements: {elements}.
  Where no AI-specific binding law is in force or enacted (as your regulation_status
  research establishes), elements (a) and (b) do not exist: that is positive evidence of
  absence for them.
{track_rule}- "text": 1-3 sentences on how {country} governs frontier AI risk, justifying the
  frontier sub-scores, under the style rules above.
- "sources": 1-5 pipe-separated URLs for the frontier claims, under the same source
  requirements as the main "sources" (primary sources first, never a guessed URL). A URL
  may appear in both.
{existing}"""

_EU_RULE = """- {country} is an EU member state: EU law that applies in it counts as its national law
  (for example the EU AI Act's obligations for providers of general-purpose AI models
  with systemic risk, its serious-incident reporting, and the Whistleblower Directive
  as it covers the AI Act).
"""

_TRACK_RULE = {
    "H": """- On evaluation_oversight, the developers a body oversees are the frontier developers
  based in {country}.
""",
    "C": """- On evaluation_oversight, the developers a body oversees are those whose frontier models
  are trained or deployed in {country}. In "text", also record compute visibility in
  {country}'s own jurisdiction: licensing of large clusters, know-your-customer rules for
  chip buyers or cloud customers, and enforcement against chip diversion. Alignment with
  another state's export controls is not itself credited.
""",
    "G": """- One or two targeted searches are enough for this lens on this track: AI incident
  reporting, AI whistleblower protection, and AI in a national emergency, disaster or
  security plan.
""",
}

_EXISTING_FRONTIER = """
Existing frontier assessment (may be outdated):
- Text: {text}
- Sources: {sources}
Where a URL above is still accurate, reuse it verbatim rather than citing another page
that says the same thing.
"""


def render_frontier_section(country: str, frontier: FrontierPrompt) -> str:
    """The lens's instructions for one country's track."""
    existing = ""
    if frontier.existing_text or frontier.existing_sources:
        existing = _EXISTING_FRONTIER.format(
            text=frontier.existing_text or "None recorded",
            sources=frontier.existing_sources or "None recorded",
        )
    return _FRONTIER_SECTION.format(
        standard=FRONTIER_STANDARD,
        country=country,
        track=frontier.track,
        meaning=_TRACK_MEANING[frontier.track],
        eu_rule=_EU_RULE.format(country=country) if frontier.eu_member else "",
        elements=FRONTIER_INCIDENT_ELEMENTS,
        track_rule=_TRACK_RULE[frontier.track].format(country=country),
        existing=existing,
    )


def render_frontier_keys(country: str, frontier: FrontierPrompt) -> str:
    """The ``frontier_risk`` object of the JSON template, with the track's
    sub-indicators only (the request's schema asks for exactly these)."""
    from .models import researched_subindicators

    lines = [",", '  "frontier_risk": {']
    for name in researched_subindicators(frontier.track):
        lines.append(
            f'    "{name}": {{"score": <{FRONTIER_ANCHORS[name]}>, '
            '"rationale": "<the one fact behind this score>"},'
        )
    lines.append(
        f'    "text": "<how {country} governs frontier AI risk, 1-3 sentences justifying the '
        'frontier sub-scores>",'
    )
    lines.append(
        '    "sources": "<REQUIRED: 1-5 pipe-separated URLs supporting the frontier claims>"'
    )
    lines.append("  }")
    return "\n".join(lines)


# -- grounded mode --------------------------------------------------------------

_EVIDENCE_HEADER = """
VERIFIED POLICY INITIATIVES for {country} ({count} shown, most recent first).
These are records from the OECD.AI Policy Observatory (GAIIN) - treat them as
verified facts:
"""

_EVIDENCE_INSTRUCTIONS = """
Grounding rules:
- Base your sub-scores and text PRIMARILY on the verified initiatives above.
- You may additionally draw on well-known instruments they omit (major national
  laws, court rulings), but NEVER contradict a verified record.
- Where the evidence and your prior knowledge disagree, the evidence wins.
- Include the source URLs of the initiatives you actually relied on in the
  "sources" field, alongside any other primary sources.
- The confidence field still follows its own definition; strong verified
  coverage of binding instruments supports higher confidence, thin or
  non-binding-only coverage does not.
"""


def _initiative_lines(initiatives: list[dict], overview_chars: int) -> str:
    lines = []
    for i, init in enumerate(initiatives, start=1):
        year = init.get("start_year") or "n.d."
        meta = " | ".join(
            str(part) for part in (init.get("initiative_type"), init.get("binding"), init.get("status")) if part
        )
        lines.append(f"{i}. {init.get('name')} ({year})" + (f" - {meta}" if meta else ""))
        overview = (init.get("overview") or "").strip()
        if overview:
            if len(overview) > overview_chars:
                overview = overview[:overview_chars].rstrip() + "…"
            lines.append(f"   {overview}")
        if init.get("source_url"):
            lines.append(f"   Source: {init['source_url']}")
    return "\n".join(lines)


def render_grounded_prompt(
    country: str,
    today: date,
    existing_reg: dict | None,
    initiatives: list[dict],
    *,
    max_initiatives: int = MAX_GROUNDED_INITIATIVES,
    overview_chars: int = MAX_OVERVIEW_CHARS,
    frontier: FrontierPrompt | None = None,
) -> str:
    """The research prompt with a verified-evidence block injected. The rubric
    and the output schema are IDENTICAL to the plain prompt - grounding changes
    what the model reads, never what it returns - so models.py, the repository,
    and all downstream validation are untouched.

    ``initiatives`` are dicts with (at least) name / start_year /
    initiative_type / binding / status / overview / source_url, e.g. rows from
    the policy_initiatives table. Empty list → the plain prompt (callers should
    prefer render_prompt directly in that case)."""
    base = render_prompt(country, today, existing_reg, frontier)
    if not initiatives:
        return base

    chosen = sorted(
        initiatives, key=lambda i: (i.get("start_year") or 0), reverse=True
    )[:max_initiatives]

    evidence_block = (
        _EVIDENCE_HEADER.format(country=country, count=len(chosen))
        + _initiative_lines(chosen, overview_chars)
        + "\n"
        + _EVIDENCE_INSTRUCTIONS
    )

    # Inject the evidence between the context (existing data) and the task
    # instructions - the anchor line starts the task section.
    anchor = f"Research the current state of AI regulation in {country}"
    idx = base.find(anchor)
    if idx == -1:  # template drift - append rather than lose the evidence
        return base + "\n" + evidence_block
    return base[:idx] + evidence_block + "\n" + base[idx:]
