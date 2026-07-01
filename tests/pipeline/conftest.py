"""Shared test builders for the pipeline suite."""

from __future__ import annotations

import httpx
import pytest


def full_result(**overrides) -> dict:
    """A complete, valid raw research result (as the API returns it).

    Dimension means: regulation 4.0, policy 3.0, governance 2.0, actor 3.0,
    enforcement 4.0 -> maturity average (4.0 + 3.0 + 4.0) / 3 = 3.67.
    """
    result = {
        "regulation_status": {
            "binding_force": 4, "scope": 3, "implementation": 4,
            "ai_specificity": 5, "text": "Justification.",
        },
        "policy_lever": {
            "binding_instruments": 3, "soft_law": 3, "economic_tools": 2,
            "institutional_capacity": 4, "text": "Justification.",
        },
        "governance_type": {
            "regulator_plurality": 2, "formal_coordination": 3, "subnational_role": 1,
            "nongovernmental_checks": 2, "text": "Justification.",
        },
        "actor_involvement": {
            "industry": 4, "civil_society": 2, "academia": 3,
            "international": 3, "text": "Justification.",
        },
        "enforcement_level": {
            "sanctions_framework": 5, "actions_taken": 4, "dedicated_authority": 4,
            "monitoring_practice": 3, "text": "Justification.",
        },
        "specific_laws": "AI Act (2024)",
        "sources": "https://example.gov/ai|https://example.gov/law",
        "confidence": "high",
    }
    result.update(overrides)
    return result


class Block:
    """A minimal stand-in for an anthropic content block."""

    def __init__(self, type: str, text: str | None = None):
        self.type = type
        self.text = text


class Message:
    """A minimal stand-in for an anthropic Message (has ``.content``)."""

    def __init__(self, *blocks: Block):
        self.content = list(blocks)


def text_message(text: str) -> Message:
    return Message(Block("text", text))


# -- anthropic error factories -------------------------------------------------

_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _response(code: int, **headers) -> httpx.Response:
    return httpx.Response(code, headers=headers, request=_REQUEST)


@pytest.fixture
def anthropic_errors():
    """Factories for the anthropic exception types the retry policy classifies."""
    import anthropic

    return {
        "auth": lambda: anthropic.AuthenticationError("bad key", response=_response(401), body=None),
        "permission": lambda: anthropic.PermissionDeniedError("no perms", response=_response(403), body=None),
        "rate_limit": lambda retry_after=None: anthropic.RateLimitError(
            "rate limited",
            response=_response(429, **({"retry-after": str(retry_after)} if retry_after else {})),
            body=None,
        ),
        "server_500": lambda retry_after=None: anthropic.InternalServerError(
            "boom",
            response=_response(500, **({"retry-after": str(retry_after)} if retry_after else {})),
            body=None,
        ),
        "bad_request": lambda: anthropic.BadRequestError("bad", response=_response(400), body=None),
        "timeout": lambda: anthropic.APITimeoutError(request=_REQUEST),
        "connection": lambda: anthropic.APIConnectionError(message="net", request=_REQUEST),
    }
