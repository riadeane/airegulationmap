"""Claude API transport for researching one country.

This layer is deliberately thin and domain-light: it builds request parameters
(shared verbatim by the synchronous and Batches paths), calls the API with the
shared retry policy, and extracts the JSON answer. It does *not* know about
:class:`~regulation_pipeline.models.ResearchResult` beyond the schema it hands to
the API - validating the raw JSON into a typed result is the strategy's job.

Every request carries its :class:`~regulation_pipeline.models.ResearchProvenance`
(initiatives embedded, web search, model), built alongside the params from the
same single evidence lookup, so the strategy can attach it to the validated
result without asking the evidence provider twice.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

import anthropic

from .models import ResearchProvenance, ResearchResult
from .prompt import MAX_GROUNDED_INITIATIVES, render_grounded_prompt, render_prompt
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
# Web search runs in a server-side sampling loop. When that loop reaches its
# iteration limit the API stops with stop_reason "pause_turn" and no answer
# yet; sending the paused turn back resumes it where it left off. The cap
# bounds the cost of a model that keeps searching.
MAX_CONTINUATIONS = 3


@dataclass(frozen=True)
class ResearchPrompt:
    """A rendered research prompt and the number of verified policy
    initiatives it embeds: ``None`` without an evidence provider (nothing was
    consulted), ``0`` when the provider had none for the country (plain
    prompt), otherwise the size of the capped evidence block."""

    text: str
    initiatives_used: int | None


@dataclass(frozen=True)
class ResearchRequest:
    """The ``messages.create`` kwargs for one country plus the provenance the
    strategy attaches to the validated answer."""

    params: dict
    provenance: ResearchProvenance


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

    def _prompt_for(self, country: str, existing_reg: dict | None) -> ResearchPrompt:
        """Render the prompt, asking the evidence provider (if any) exactly
        once. The count mirrors ``render_grounded_prompt``'s cap, so it is the
        number of initiatives the model actually read."""
        if self._evidence_provider is None:
            return ResearchPrompt(render_prompt(country, self._today, existing_reg), None)
        initiatives = self._evidence_provider(country)
        if not initiatives:
            return ResearchPrompt(render_prompt(country, self._today, existing_reg), 0)
        return ResearchPrompt(
            render_grounded_prompt(country, self._today, existing_reg, initiatives),
            min(len(initiatives), MAX_GROUNDED_INITIATIVES),
        )

    def request(
        self, country: str, existing_reg: dict | None, *, use_search: bool,
    ) -> ResearchRequest:
        """Build the ``messages.create`` kwargs for one country and the
        provenance of that request. Shared by the synchronous path and the
        Batches path so both send identical requests."""
        prompt = self._prompt_for(country, existing_reg)
        params = {
            "model": self._model,
            "max_tokens": _MAX_TOKENS,
            "messages": [{"role": "user", "content": prompt.text}],
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
        provenance = ResearchProvenance(
            initiatives_used=prompt.initiatives_used, search=use_search, model=self._model,
        )
        return ResearchRequest(params, provenance)

    def request_params(self, country: str, existing_reg: dict | None, *, use_search: bool) -> dict:
        """The ``messages.create`` kwargs alone (see :meth:`request`)."""
        return self.request(country, existing_reg, use_search=use_search).params

    def research(
        self, country: str, existing_reg: dict | None, *, use_search: bool,
    ) -> tuple[dict | None, ResearchProvenance]:
        """Synchronously research one country. Returns the parsed JSON dict
        (``None`` on a transient failure that exhausted retries or an
        unparseable answer) and the provenance of the request that was sent.
        Raises :class:`~regulation_pipeline.errors.FatalAPIError` for
        unrecoverable conditions."""
        request = self.request(country, existing_reg, use_search=use_search)
        response = call_with_retries(
            lambda: self._client.messages.create(**request.params), label=country
        )
        if response is None:
            return None, request.provenance
        self._track_usage(response)
        response = self.resume(request.params, response, country)
        if response is None:
            return None, request.provenance
        return parse_message(response, country), request.provenance

    def resume(self, params: dict, message, label: str):
        """Continue a turn the server paused (``stop_reason == "pause_turn"``)
        until it finishes, at most :data:`MAX_CONTINUATIONS` times. Each paused
        turn goes back as an assistant message; the API picks up from its
        trailing server tool call. Returns the final Message (still paused if
        the cap ran out, which :func:`parse_message` then rejects), or ``None``
        when a continuation request failed. The Batches path continues paused
        results in follow-up batches instead (``BatchRunner.research``)."""
        messages = list(params["messages"])
        for attempt in range(1, MAX_CONTINUATIONS + 1):
            if getattr(message, "stop_reason", None) != "pause_turn":
                return message
            logger.info("%s: resuming a paused turn (%d/%d)", label, attempt, MAX_CONTINUATIONS)
            messages.append({"role": "assistant", "content": message.content})
            resumed = {**params, "messages": list(messages)}
            message = call_with_retries(
                lambda params=resumed: self._client.messages.create(**params), label=label
            )
            if message is None:
                return None
            self._track_usage(message)
        return message

    def _track_usage(self, response) -> None:
        usage = getattr(response, "usage", None)
        if usage is None:
            return
        self._usage["input"] += getattr(usage, "input_tokens", 0) or 0
        self._usage["output"] += getattr(usage, "output_tokens", 0) or 0


# Stop reasons that mean the response carries no complete answer.
_UNFINISHED = frozenset({"pause_turn", "max_tokens", "refusal"})


def parse_message(message, label: str) -> dict | None:
    """Extract and parse the JSON answer from a Message. Returns a dict or
    ``None``.

    With web search enabled, responses interleave text and ``server_tool_use``
    blocks - the constrained JSON answer is the LAST text block, not the first.
    A response that stopped before its answer (paused, cut off at
    ``max_tokens``, or refused) is rejected with its stop reason logged, rather
    than parsed from whatever interim text it carries.
    """
    stop_reason = getattr(message, "stop_reason", None)
    if stop_reason in _UNFINISHED:
        logger.warning("no answer for %s: the response stopped with %s", label, stop_reason)
        return None
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
