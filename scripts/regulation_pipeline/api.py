"""Claude API interaction for researching country regulation data."""

import json
import random
import time
from datetime import date

from .processor import build_output_schema

try:
    import anthropic
except ImportError:
    anthropic = None


class FatalAPIError(Exception):
    """Raised when the API returns an unrecoverable error."""
    pass


# Explicit retry policy for transient failures. The SDK's own silent
# retries are disabled in cli.py (max_retries=0) so attempts here are
# the only ones and every retry is logged.
MAX_ATTEMPTS = 4  # 1 initial try + 3 retries (delays ~2s, 4s, 8s)


def _retry_delay(attempt, exc=None):
    """Exponential backoff with jitter; honors a Retry-After header."""
    if exc is not None:
        response = getattr(exc, "response", None)
        if response is not None:
            try:
                retry_after = float(response.headers.get("retry-after"))
                if retry_after > 0:
                    return retry_after
            except (AttributeError, TypeError, ValueError):
                pass
    return 2 * (2 ** attempt) + random.uniform(0, 1)


def _call_with_retries(client, request_kwargs, country):
    """messages.create with backoff. Returns a response or None after
    exhausting retries on transient errors. Raises FatalAPIError for
    unrecoverable conditions."""
    for attempt in range(MAX_ATTEMPTS):
        last_attempt = attempt == MAX_ATTEMPTS - 1
        try:
            return client.messages.create(**request_kwargs)
        except anthropic.AuthenticationError as e:
            raise FatalAPIError(f"Authentication failed (invalid API key): {e}")
        except anthropic.PermissionDeniedError as e:
            raise FatalAPIError(f"Permission denied (check credits/permissions): {e}")
        except (anthropic.RateLimitError, anthropic.APITimeoutError, anthropic.APIConnectionError) as e:
            kind = type(e).__name__
            if last_attempt:
                print(f"  WARNING: {kind} for {country} — giving up after {MAX_ATTEMPTS} attempts")
                return None
            delay = _retry_delay(attempt, e)
            print(f"  WARNING: {kind} for {country} — retrying in {delay:.1f}s "
                  f"(attempt {attempt + 1}/{MAX_ATTEMPTS})")
            time.sleep(delay)
        except anthropic.APIStatusError as e:
            if e.status_code < 500:
                raise FatalAPIError(f"API error {e.status_code}: {e}")
            if last_attempt:
                print(f"  WARNING: server error ({e.status_code}) for {country} — "
                      f"giving up after {MAX_ATTEMPTS} attempts")
                return None
            delay = _retry_delay(attempt)
            print(f"  WARNING: server error ({e.status_code}) for {country} — retrying in "
                  f"{delay:.1f}s (attempt {attempt + 1}/{MAX_ATTEMPTS})")
            time.sleep(delay)
    return None


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


def build_request_params(country, existing_reg, model, use_search=False):
    """Build the messages.create kwargs for one country. Shared by the
    synchronous path (research_country) and the Batches path."""
    existing_reg = existing_reg or {}
    prompt = RESEARCH_PROMPT.format(
        country=country,
        today=date.today().isoformat(),
        existing_reg_status=existing_reg.get("Regulation Status", "Unknown"),
        existing_policy=existing_reg.get("Policy Lever", "Unknown"),
        existing_governance=existing_reg.get("Governance Type", "Unknown"),
        existing_actors=existing_reg.get("Actor Involvement", "Unknown"),
    )

    params = {
        "model": model,
        # The sub-indicator schema is a substantially larger response
        # than the old flat scores.
        "max_tokens": 3072 if use_search else 2048,
        "messages": [{"role": "user", "content": prompt}],
        # Structured outputs: the API constrains the answer to the
        # schema, so sub-scores arrive as guaranteed ints 1-5 with all
        # fields present.
        "output_config": {
            "format": {"type": "json_schema", "schema": build_output_schema()}
        },
    }
    if use_search:
        # Search runs always use Sonnet 4.6 (cli.py), which supports the
        # 20260209 tool version — it filters search results before they
        # reach context (cheaper, more accurate than 20250305).
        params["tools"] = [{"type": "web_search_20260209", "name": "web_search"}]
    return params


def parse_message(message, country):
    """Extract and parse the JSON answer from a Message. Returns dict or
    None. With web search enabled, responses interleave text and
    server_tool_use blocks — the constrained JSON answer is the LAST
    text block, not the first."""
    text = next(
        (block.text for block in reversed(message.content) if block.type == "text"),
        None,
    )
    if not text:
        print(f"  WARNING: no text block in response for {country}")
        return None
    text = text.strip()
    # Defensive: structured outputs shouldn't produce fences, but strip
    # them if present.
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"  WARNING: JSON parse error for {country}: {e}")
        return None


def research_country(client, country, existing_reg, model, use_search=False):
    """Call Claude API to research one country. Returns parsed dict or None on error."""
    request_kwargs = build_request_params(country, existing_reg, model, use_search)
    response = _call_with_retries(client, request_kwargs, country)
    if response is None:
        return None
    try:
        return parse_message(response, country)
    except Exception as e:
        print(f"  ERROR researching {country}: {e}")
        return None
