"""Claude API transport for researching one country.

This layer is deliberately thin and domain-light: it builds request parameters
(shared verbatim by the synchronous and Batches paths), calls the API with the
shared retry policy, and extracts the JSON answer. It does *not* know about
:class:`~regulation_pipeline.models.ResearchResult` beyond the schema it hands to
the API - validating the raw JSON into a typed result is the service's job.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import date

import anthropic

from .models import ResearchResult
from .prompt import render_grounded_prompt, render_prompt
from .retry import call_with_retries

logger = logging.getLogger(__name__)

# Web search runs use the web_search_20260209 tool (dynamic filtering).
# max_uses caps searches per country. Search results are re-sent on every
# search iteration, so they dominate input tokens; a September 2026 sample
# showed 7-16 searches per country on Opus 5 and a 34-search outlier on
# Sonnet 5. The cap stops outliers without touching the typical run.
_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 12}
# Thinking tokens count toward max_tokens, and the default model thinks before
# it answers. Leave room so the structured answer is never truncated.
_MAX_TOKENS = 16000


class ResearchClient:
    """Wraps an ``anthropic.Anthropic`` client with the pipeline's request
    shape, retry policy, and response parsing. One instance per run; ``today`` is
    injected so the prompt's date matches the rest of the run."""

    def __init__(
        self,
        client: anthropic.Anthropic,
        *,
        model: str,
        today: date,
        evidence_provider: Callable[[str], list[dict]] | None = None,
    ):
        self._client = client
        self._model = model
        self._today = today
        # Grounded mode: returns a country's verified policy initiatives
        # (policy_initiatives rows). When it yields records, the prompt
        # embeds them as facts; when empty, the plain research prompt is
        # used - so evidence-poor countries degrade gracefully.
        self._evidence_provider = evidence_provider
        # Cumulative token usage across the run - best-effort provenance for
        # the research_runs audit row (the batch path tracks its own).
        self._usage = {"input": 0, "output": 0}

    def usage(self) -> dict[str, int]:
        return dict(self._usage)

    def _prompt_for(self, country: str, existing_reg: dict | None) -> str:
        if self._evidence_provider is not None:
            initiatives = self._evidence_provider(country)
            if initiatives:
                return render_grounded_prompt(country, self._today, existing_reg, initiatives)
        return render_prompt(country, self._today, existing_reg)

    def request_params(self, country: str, existing_reg: dict | None, *, use_search: bool) -> dict:
        """Build the ``messages.create`` kwargs for one country. Shared by the
        synchronous path and the Batches path so both send identical requests."""
        params = {
            "model": self._model,
            "max_tokens": _MAX_TOKENS,
            "messages": [{"role": "user", "content": self._prompt_for(country, existing_reg)}],
            # Structured outputs: the API constrains the answer to this schema,
            # so every sub-indicator arrives as {score, rationale} with the score
            # a guaranteed int 1-5 and all fields present. Rationale length is
            # checked in pydantic, since the schema cannot express it.
            "output_config": {
                "format": {"type": "json_schema", "schema": ResearchResult.output_schema()}
            },
        }
        if use_search:
            params["tools"] = [_SEARCH_TOOL]
        return params

    def research(self, country: str, existing_reg: dict | None, *, use_search: bool) -> dict | None:
        """Synchronously research one country. Returns the parsed JSON dict, or
        ``None`` on a transient failure that exhausted retries. Raises
        :class:`~regulation_pipeline.errors.FatalAPIError` for unrecoverable
        conditions."""
        params = self.request_params(country, existing_reg, use_search=use_search)
        response = call_with_retries(
            lambda: self._client.messages.create(**params), label=country
        )
        if response is None:
            return None
        self._track_usage(response)
        return parse_message(response, country)

    def _track_usage(self, response) -> None:
        usage = getattr(response, "usage", None)
        if usage is None:
            return
        self._usage["input"] += getattr(usage, "input_tokens", 0) or 0
        self._usage["output"] += getattr(usage, "output_tokens", 0) or 0


def parse_message(message, label: str) -> dict | None:
    """Extract and parse the JSON answer from a Message. Returns a dict or
    ``None``.

    With web search enabled, responses interleave text and ``server_tool_use``
    blocks - the constrained JSON answer is the LAST text block, not the first.
    """
    text = next(
        (block.text for block in reversed(message.content) if block.type == "text"),
        None,
    )
    if not text:
        logger.warning("no text block in response for %s", label)
        return None
    text = text.strip()
    # Defensive: structured outputs shouldn't produce fences, but strip them if present.
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        logger.warning("JSON parse error for %s: %s", label, exc)
        return None
