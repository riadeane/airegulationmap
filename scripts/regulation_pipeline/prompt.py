"""The research prompt template and its rendering.

Separated from the API transport (:mod:`api`) so the carefully-calibrated
rubric text is easy to find and edit. The prompt documents the same
sub-indicator structure the :mod:`models` enforce; the models are the source of
truth for the *shape*, the prompt for the *meaning* of each 1-5 level.
"""

from __future__ import annotations

from datetime import date

# Recorded in research_runs provenance so a score can always be traced to
# the prompt that produced it. Bump when the rubric or structure changes.
PROMPT_VERSION = "v2-2026-06"

# The evidence-grounded variant (same rubric + output schema, plus a
# verified-records block). Grounded prompts are LONGER than plain ones —
# pair grounded runs with --batch for the 50% token pricing.
GROUNDED_PROMPT_VERSION = "v3-grounded-2026-07"

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

Research the current state of AI regulation in {country} as of {today}.
Consider recent legislation, executive orders, national strategies, and international agreements.

Each of the five dimensions is scored through FOUR concrete sub-indicators, each an
integer 1-5. The dimension score is computed downstream as their mean — you never
report a dimension total. Score every sub-indicator strictly against its written
definition.

Calibration — read before scoring:
- A sub-indicator score of 5 means the GLOBAL FRONTIER TODAY: the standard set by the
  two or three most advanced jurisdictions for that specific aspect. It does not mean
  perfection. When torn between 4 and 5, give 4.
- Reference points: an EU member state implementing the EU AI Act sits near 4-5 on
  most regulation_status sub-indicators; the United States (sectoral rules and
  executive action, no horizontal statute) near 3; a country whose only instrument is
  a published national AI strategy near 2; no AI-specific policy activity is 1.
- governance_type and actor_involvement are DESCRIPTIVE scales, not quality scales.
  They record HOW a country governs, not how well. A highly centralized
  single-authority system scores LOW on governance_type sub-indicators even when it is
  highly effective. Exclusion of domestic civil society means a LOW civil_society
  score no matter how internationally active the government is.
- Do not reward activity volume, ambition, or announcements. Score only what the
  sub-indicator definition asks about, and make each dimension's "text" justify the
  sub-scores you gave.

Return ONLY a valid JSON object with these exact keys:
{{
  "regulation_status": {{
    "binding_force": <1 = nothing binding exists or proposed; 3 = binding AI legislation drafted/in legislative process; 5 = binding AI rules in force>,
    "scope": <1 = no AI coverage in any sector; 3 = a few sectors or use-cases covered; 5 = horizontal cross-sector coverage>,
    "implementation": <1 = paper commitments only; 3 = partially in force or in transition period; 5 = fully operational with secondary rules and guidance issued>,
    "ai_specificity": <1 = only general law incidentally touching AI; 3 = AI explicitly addressed within adapted general law; 5 = dedicated AI-specific instruments>,
    "text": "<current regulatory approach, 1-3 sentences justifying the sub-scores>"
  }},
  "policy_lever": {{
    "binding_instruments": <1 = no binding instruments; 3 = one binding instrument; 5 = multiple binding instruments across domains>,
    "soft_law": <1 = no guidance/standards/codes; 3 = some published guidance; 5 = mature, maintained suite of standards and codes>,
    "economic_tools": <1 = no funding/procurement/sandbox programs; 3 = one or two programs; 5 = several active programs>,
    "institutional_capacity": <1 = no dedicated bodies; 3 = bodies designated but thinly resourced; 5 = staffed, operational institutions with compliance infrastructure>,
    "text": "<policy mechanisms used, 1-2 sentences>"
  }},
  "governance_type": {{
    "regulator_plurality": <DESCRIPTIVE: 1 = single authority sets and enforces policy; 3 = lead body plus sectoral regulators; 5 = many independent regulators with their own remits>,
    "formal_coordination": <DESCRIPTIVE: 1 = single actor, nothing to coordinate; 3 = ad hoc coordination; 5 = formal coordination mechanisms across many bodies>,
    "subnational_role": <DESCRIPTIVE: 1 = no sub-national role; 3 = sub-national implementation of national rules; 5 = states/provinces regulate AI independently>,
    "nongovernmental_checks": <DESCRIPTIVE: 1 = no court/ombudsman/independent-review role; 3 = occasional judicial or independent review; 5 = courts and independent bodies actively shape AI rules>,
    "text": "<governance structure, 1-2 sentences>"
  }},
  "actor_involvement": {{
    "industry": <DESCRIPTIVE: 1 = no structured industry input; 3 = published consultations and working groups; 5 = standing formal roles in policy-making>,
    "civil_society": <DESCRIPTIVE: 1 = civil society excluded from domestic process; 3 = consulted occasionally; 5 = standing formal roles for NGOs/unions>,
    "academia": <DESCRIPTIVE: 1 = no academic involvement; 3 = some advisory input; 5 = formal standing advisory roles>,
    "international": <DESCRIPTIVE: 1 = no participation in international AI governance; 3 = signatory to declarations; 5 = active treaty/standards participation>,
    "text": "<actors and geographic scope, 1-2 sentences>"
  }},
  "enforcement_level": {{
    "sanctions_framework": <1 = no penalties defined; 3 = penalties defined for some obligations; 5 = comprehensive penalty framework>,
    "actions_taken": <1 = never enforced; 3 = isolated enforcement actions; 5 = routine, published enforcement actions>,
    "dedicated_authority": <1 = nobody owns AI enforcement; 3 = authority designated without dedicated resources; 5 = resourced authority with explicit AI remit>,
    "monitoring_practice": <1 = no audits or monitoring; 3 = occasional reviews; 5 = routine audits and public reporting>,
    "text": "<how strictly rules are enforced, 1 sentence>"
  }},
  "specific_laws": "<REQUIRED if any exist: comma-separated official names of laws, acts, executive orders, or national strategies WITH years, e.g. 'AI Act (2024), Data Protection Act (2018)'. Empty string ONLY if no AI-relevant instrument of any kind exists>",
  "sources": "<REQUIRED: 1-5 pipe-separated URLs supporting your claims. Strongly prefer primary sources: government ministry sites, official gazettes, legislature pages, regulator websites. Secondary sources (OECD.ai, IAPP, law-firm trackers) are acceptable if no primary source is available>",
  "confidence": "<high|medium|low>"
}}

Source requirements:
- Every response MUST include at least one source URL unless genuinely none exists.
- Only include URLs you are confident are real. NEVER fabricate or guess URLs. If you
  cannot recall an exact deep link, give the official top-level page you are certain
  exists (e.g. the ministry or regulator homepage) rather than a guessed path.
- If you cannot support your assessment with any source, set "sources" to "" AND set
  "confidence" to "low".
- "confidence" must be "high" only when claims are backed by enacted legislation with
  primary sources; "medium" for mixed or secondary sourcing; "low" for sparse
  information or no sources.

Return ONLY the JSON object. No preamble, no explanation, no markdown.
"""


def render_prompt(country: str, today: date, existing_reg: dict | None) -> str:
    """Fill the research prompt for one country. ``existing_reg`` is the current
    regulation_data row (or ``None`` for a country we have no prior data on)."""
    existing = existing_reg or {}
    return RESEARCH_PROMPT.format(
        country=country,
        today=today.isoformat(),
        existing_reg_status=existing.get("Regulation Status", "Unknown"),
        existing_policy=existing.get("Policy Lever", "Unknown"),
        existing_governance=existing.get("Governance Type", "Unknown"),
        existing_actors=existing.get("Actor Involvement", "Unknown"),
    )


# -- grounded mode --------------------------------------------------------------

_EVIDENCE_HEADER = """
VERIFIED POLICY INITIATIVES for {country} ({count} shown, most recent first).
These are records from the OECD.AI Policy Observatory (GAIIN) — treat them as
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
        lines.append(f"{i}. {init.get('name')} ({year})" + (f" — {meta}" if meta else ""))
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
) -> str:
    """The research prompt with a verified-evidence block injected. The rubric
    and the output schema are IDENTICAL to the plain prompt — grounding changes
    what the model reads, never what it returns — so models.py, the repository,
    and all downstream validation are untouched.

    ``initiatives`` are dicts with (at least) name / start_year /
    initiative_type / binding / status / overview / source_url, e.g. rows from
    the policy_initiatives table. Empty list → the plain prompt (callers should
    prefer render_prompt directly in that case)."""
    base = render_prompt(country, today, existing_reg)
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
    # instructions — the anchor line starts the task section.
    anchor = f"Research the current state of AI regulation in {country}"
    idx = base.find(anchor)
    if idx == -1:  # template drift — append rather than lose the evidence
        return base + "\n" + evidence_block
    return base[:idx] + evidence_block + "\n" + base[idx:]
