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

Scoring guidance:
- 1 = No regulation / minimal engagement
- 2 = Early-stage / voluntary guidelines only
- 3 = Draft legislation / national strategy in progress
- 4 = Active regulation / laws enacted
- 5 = Comprehensive binding regulation with enforcement

Enforcement level:
- 1 = No enforcement mechanism
- 3 = Some oversight bodies / soft enforcement
- 5 = Active enforcement, penalties, audits

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
