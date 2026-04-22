"""Claude API interaction for researching country regulation data."""

import json
from datetime import date

try:
    import anthropic
except ImportError:
    anthropic = None


class FatalAPIError(Exception):
    """Raised when the API returns an unrecoverable error."""
    pass


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

Return ONLY a valid JSON object with these exact keys:
{{
  "regulation_status_score": <integer 1-5>,
  "regulation_status_text": "<current regulatory approach, 1-3 sentences>",
  "policy_lever_score": <integer 1-5>,
  "policy_lever_text": "<policy mechanisms used, 1-2 sentences>",
  "governance_type_score": <integer 1-5>,
  "governance_type_text": "<governance structure, 1-2 sentences>",
  "actor_involvement_score": <integer 1-5>,
  "actor_involvement_text": "<actors and geographic scope, 1-2 sentences>",
  "enforcement_level_score": <integer 1-5>,
  "enforcement_level_text": "<how strictly rules are enforced, 1 sentence>",
  "specific_laws": "<comma-separated named laws/acts with years, or empty string>",
  "sources": "<pipe-separated URLs to primary sources (government sites preferred), or empty string>",
  "confidence": "<high|medium|low>"
}}

Scoring rubrics — every dimension uses the full 1-5 scale:

Regulation Status (Minimal → Comprehensive):
- 1 = No regulation or minimal engagement; AI is not named in policy documents
- 2 = Early-stage engagement: voluntary guidelines, sectoral code of practice, or advisory committee
- 3 = National strategy or draft legislation in progress; public consultation underway
- 4 = Active, enacted AI regulation covering a substantial slice of deployment contexts
- 5 = Comprehensive, binding, cross-sector AI regulation with explicit enforcement mechanisms

Policy Lever (Narrow → Broad):
- 1 = Narrow: one tool, one sector, or indirect leverage only (e.g. data protection law bent to cover AI)
- 2 = Two or three instruments in related areas (e.g. strategy + sectoral guidance, or sandbox + code of practice)
- 3 = Mixed: several instruments — standards, procurement guidance, R&D funding, some sectoral rules
- 4 = Multiple instruments across several domains with at least one binding regulation and active funding/standards work
- 5 = Broad: horizontal regulatory framework plus sectoral adaptations, public investment, and compliance infrastructure

Governance Type (Centralized → Distributed):
- 1 = Centralized: single national authority sets and enforces policy
- 2 = Lead authority with informal delegation to one or two sectoral bodies; coordination is ad hoc
- 3 = Hybrid: lead body coordinates with sectoral regulators or sub-national jurisdictions
- 4 = Multi-actor network with formal coordination mechanisms; regulators hold clearly delineated remits
- 5 = Distributed: authority spread across independent regulators, courts, sub-national governments; emergent coordination

Actor Involvement (Limited → Broad):
- 1 = Limited: policy is set inside government with minimal external input
- 2 = Industry consulted informally; civil society and academia have no structured access
- 3 = Consultative: published consultations, industry working groups, some academic input
- 4 = Standing multi-stakeholder bodies include industry, academia, and at least one civil-society voice
- 5 = Broad: structured multi-stakeholder processes including civil society, trade unions, and international partners

Enforcement Level (Weak → Strong):
- 1 = No enforcement mechanism; obligations not tied to any authority
- 2 = Obligations reference an authority but no sanctioning framework; compliance effectively voluntary
- 3 = Soft enforcement: oversight bodies exist but audits and penalties are rare
- 4 = Sanctioning framework exists and has been used selectively; enforcement inconsistent across sectors
- 5 = Active enforcement: penalties issued, audits routine, dedicated authority publishes enforcement actions

Return ONLY the JSON object. No preamble, no explanation, no markdown.
"""


def research_country(client, country, existing_reg, model, use_search=False):
    """Call Claude API to research one country. Returns parsed dict or None on error."""
    existing_reg = existing_reg or {}
    prompt = RESEARCH_PROMPT.format(
        country=country,
        today=date.today().isoformat(),
        existing_reg_status=existing_reg.get("Regulation Status", "Unknown"),
        existing_policy=existing_reg.get("Policy Lever", "Unknown"),
        existing_governance=existing_reg.get("Governance Type", "Unknown"),
        existing_actors=existing_reg.get("Actor Involvement", "Unknown"),
    )

    try:
        request_kwargs = {
            "model": model,
            "max_tokens": 2048 if use_search else 1024,
            "messages": [{"role": "user", "content": prompt}]
        }
        if use_search:
            request_kwargs["tools"] = [{"type": "web_search_20250305", "name": "web_search"}]

        response = client.messages.create(**request_kwargs)
        text = next((block.text for block in response.content if block.type == "text"), None)
        if not text:
            print(f"  WARNING: no text block in response for {country}")
            return None
        text = text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"  WARNING: JSON parse error for {country}: {e}")
        return None
    except anthropic.AuthenticationError as e:
        raise FatalAPIError(f"Authentication failed (invalid API key): {e}")
    except anthropic.PermissionDeniedError as e:
        raise FatalAPIError(f"Permission denied (check credits/permissions): {e}")
    except anthropic.RateLimitError as e:
        print(f"  WARNING: Rate limited for {country}: {e}")
        return None
    except anthropic.APITimeoutError as e:
        print(f"  WARNING: Timeout for {country}: {e}")
        return None
    except anthropic.APIConnectionError as e:
        print(f"  WARNING: Connection error for {country}: {e}")
        return None
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            print(f"  WARNING: Server error ({e.status_code}) for {country}: {e}")
            return None
        raise FatalAPIError(f"API error {e.status_code}: {e}")
    except Exception as e:
        print(f"  ERROR researching {country}: {e}")
        return None
