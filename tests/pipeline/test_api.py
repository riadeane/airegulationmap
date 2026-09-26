import json
from datetime import date

import pytest
from conftest import Block, Message, full_result, text_message
from regulation_pipeline.api import ResearchClient, ResearchPrompt, parse_message
from regulation_pipeline.models import ResearchProvenance
from regulation_pipeline.prompt import MAX_GROUNDED_INITIATIVES, render_prompt

TODAY = date(2026, 6, 11)


class TestParseMessage:
    def test_plain_json(self):
        msg = text_message(json.dumps(full_result()))
        assert parse_message(msg, "X")["confidence"] == "high"

    def test_last_text_block_wins_under_web_search(self):
        # Web search interleaves text and server_tool_use; the constrained JSON
        # answer is the LAST text block, not the first.
        msg = Message(
            Block("text", "let me search..."),
            Block("server_tool_use"),
            Block("text", json.dumps(full_result())),
        )
        assert parse_message(msg, "X")["confidence"] == "high"

    def test_strips_code_fences(self):
        msg = text_message("```json\n" + json.dumps(full_result()) + "\n```")
        assert parse_message(msg, "X") is not None

    def test_no_text_block_returns_none(self):
        assert parse_message(Message(Block("server_tool_use")), "X") is None

    def test_bad_json_returns_none(self):
        assert parse_message(text_message("not json at all"), "X") is None


class TestUnfinishedResponses:
    @pytest.mark.parametrize("reason", ["pause_turn", "max_tokens", "refusal"])
    def test_a_response_without_its_answer_is_rejected(self, reason):
        # Interim text ("let me search...") must never be parsed as the answer,
        # even when it happens to be valid JSON.
        msg = text_message(json.dumps(full_result()))
        msg.stop_reason = reason
        assert parse_message(msg, "X") is None

    def test_end_turn_parses(self):
        msg = text_message(json.dumps(full_result()))
        msg.stop_reason = "end_turn"
        assert parse_message(msg, "X")["confidence"] == "high"


class _SequenceMessages:
    """Returns the queued messages in order and records every request."""

    def __init__(self, *messages):
        self._queue = list(messages)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._queue.pop(0)


def _paused(text="Searching..."):
    msg = Message(Block("text", text), Block("server_tool_use"))
    msg.stop_reason = "pause_turn"
    return msg


class TestResume:
    def _client(self, *messages):
        fake = _FakeClient()
        fake.messages = _SequenceMessages(*messages)
        return ResearchClient(fake, model="m", today=TODAY), fake.messages

    def test_a_paused_turn_is_resumed_until_it_answers(self):
        first, second = _paused("one"), _paused("two")
        done = text_message(json.dumps(full_result()))
        done.stop_reason = "end_turn"
        client, messages = self._client(first, second, done)
        raw, _ = client.research("Testland", None, use_search=True)
        assert raw["confidence"] == "high"
        assert len(messages.calls) == 3
        # Each continuation re-sends the prompt plus every paused turn so far,
        # as assistant messages, and nothing else changes.
        resumed = messages.calls[2]
        assert [m["role"] for m in resumed["messages"]] == ["user", "assistant", "assistant"]
        assert resumed["messages"][1]["content"] is first.content
        assert resumed["messages"][2]["content"] is second.content
        assert resumed["tools"] == messages.calls[0]["tools"]
        assert resumed["output_config"] == messages.calls[0]["output_config"]
        # The first request's message list was not mutated.
        assert len(messages.calls[0]["messages"]) == 1

    def test_gives_up_after_the_continuation_cap(self):
        from regulation_pipeline.api import MAX_CONTINUATIONS

        client, messages = self._client(*[_paused() for _ in range(MAX_CONTINUATIONS + 1)])
        raw, _ = client.research("Testland", None, use_search=True)
        assert raw is None
        assert len(messages.calls) == MAX_CONTINUATIONS + 1

    def test_a_finished_turn_is_not_resent(self):
        done = text_message(json.dumps(full_result()))
        client, messages = self._client(done)
        assert client.resume({"messages": []}, done, "X") is done
        assert messages.calls == []

    def test_continuation_usage_is_counted(self):
        class Usage:
            input_tokens = 10
            output_tokens = 2

        first = _paused()
        first.usage = Usage()
        done = text_message(json.dumps(full_result()))
        done.usage = Usage()
        client, _ = self._client(first, done)
        client.research("Testland", None, use_search=True)
        assert client.usage() == {"input": 20, "output": 4}


class _FakeMessages:
    def __init__(self, message):
        self._message = message
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return self._message


class _FakeClient:
    def __init__(self, message=None):
        self.messages = _FakeMessages(message)


def _client(message=None, evidence_provider=None):
    return ResearchClient(
        _FakeClient(message), model="m", today=TODAY, evidence_provider=evidence_provider,
    )


def _initiatives(n: int) -> list[dict]:
    return [
        {"name": f"Initiative {i}", "start_year": 2000 + i, "source_url": f"https://a.gov/{i}"}
        for i in range(n)
    ]


class CountingProvider:
    """An evidence provider that records every lookup."""

    def __init__(self, records: dict[str, list[dict]]):
        self._records = records
        self.calls: list[str] = []

    def __call__(self, country: str) -> list[dict]:
        self.calls.append(country)
        return self._records.get(country, [])


class TestRequestParams:
    def test_default_run(self):
        params = _client().request_params("Germany", None, use_search=False)
        assert params["model"] == "m"
        assert params["max_tokens"] == 16000
        assert "tools" not in params
        assert params["output_config"]["format"]["type"] == "json_schema"

    def test_search_run_adds_search_tool(self):
        params = _client().request_params("Germany", None, use_search=True)
        assert params["model"] == "m"
        assert params["tools"][0]["type"] == "web_search_20260209"
        assert params["tools"][0]["max_uses"] == 12

    def test_prompt_includes_country_and_existing_data(self):
        params = _client().request_params(
            "Germany", {"Regulation Status": "prior status"}, use_search=False
        )
        prompt = params["messages"][0]["content"]
        assert "Germany" in prompt
        assert "prior status" in prompt


class TestPromptEvidenceCount:
    """PRD 14: the prompt reports how many verified initiatives it embeds."""

    def test_no_provider_is_none_and_plain(self):
        prompt = _client()._prompt_for("Germany", None)
        assert prompt == ResearchPrompt(render_prompt("Germany", TODAY, None), None)

    def test_provider_without_records_is_zero_and_plain(self):
        prompt = _client(evidence_provider=CountingProvider({}))._prompt_for("Germany", None)
        assert prompt.initiatives_used == 0
        assert prompt.text == render_prompt("Germany", TODAY, None)

    def test_provider_records_are_counted_and_embedded(self):
        provider = CountingProvider({"Germany": _initiatives(7)})
        prompt = _client(evidence_provider=provider)._prompt_for("Germany", None)
        assert prompt.initiatives_used == 7
        assert "VERIFIED POLICY INITIATIVES for Germany (7 shown" in prompt.text

    def test_count_is_capped_like_the_evidence_block(self):
        provider = CountingProvider({"Germany": _initiatives(MAX_GROUNDED_INITIATIVES + 5)})
        prompt = _client(evidence_provider=provider)._prompt_for("Germany", None)
        assert prompt.initiatives_used == MAX_GROUNDED_INITIATIVES == 15
        assert f"({MAX_GROUNDED_INITIATIVES} shown" in prompt.text


class TestRequest:
    def test_grounded_request_provenance(self):
        provider = CountingProvider({"Germany": _initiatives(7)})
        request = _client(evidence_provider=provider).request("Germany", None, use_search=True)
        assert request.provenance == ResearchProvenance(initiatives_used=7, search=True, model="m")
        assert request.provenance.grounded is True
        assert "VERIFIED POLICY INITIATIVES" in request.params["messages"][0]["content"]
        assert request.params["tools"][0]["name"] == "web_search"

    def test_plain_request_provenance_with_provider(self):
        request = _client(evidence_provider=CountingProvider({})).request(
            "Germany", None, use_search=False,
        )
        assert request.provenance == ResearchProvenance(initiatives_used=0, search=False, model="m")
        assert request.provenance.grounded is False
        assert "tools" not in request.params

    def test_plain_request_provenance_without_provider(self):
        request = _client().request("Germany", None, use_search=True)
        assert request.provenance == ResearchProvenance(initiatives_used=None, search=True, model="m")
        assert request.provenance.grounded is False

    def test_provider_is_called_once_per_request(self):
        provider = CountingProvider({"Germany": _initiatives(3)})
        rc = _client(evidence_provider=provider)
        rc.request("Germany", None, use_search=False)
        assert provider.calls == ["Germany"]
        rc.request_params("France", None, use_search=False)
        assert provider.calls == ["Germany", "France"]

    def test_request_params_is_the_request_params(self):
        provider = CountingProvider({"Germany": _initiatives(2)})
        rc = _client(evidence_provider=provider)
        assert rc.request_params("Germany", None, use_search=True) == rc.request(
            "Germany", None, use_search=True,
        ).params


class TestResearch:
    def test_calls_client_and_parses(self):
        rc = _client(text_message(json.dumps(full_result())))
        raw, provenance = rc.research("Germany", None, use_search=False)
        assert raw["confidence"] == "high"
        assert provenance == ResearchProvenance(initiatives_used=None, search=False, model="m")

    def test_uses_selected_model(self):
        client = _FakeClient(text_message(json.dumps(full_result())))
        rc = ResearchClient(client, model="m", today=TODAY)
        rc.research("Germany", None, use_search=True)
        assert client.messages.kwargs["model"] == "m"

    @pytest.mark.parametrize("use_search", [True, False])
    def test_returns_the_sent_requests_provenance(self, use_search):
        client = _FakeClient(text_message(json.dumps(full_result())))
        provider = CountingProvider({"Germany": _initiatives(4)})
        rc = ResearchClient(client, model="claude-x", today=TODAY, evidence_provider=provider)
        _, provenance = rc.research("Germany", None, use_search=use_search)
        assert provenance == ResearchProvenance(initiatives_used=4, search=use_search, model="claude-x")
        assert ("tools" in client.messages.kwargs) is use_search
        assert "(4 shown" in client.messages.kwargs["messages"][0]["content"]
        assert provider.calls == ["Germany"]

    def test_unparseable_answer_still_reports_provenance(self):
        rc = _client(text_message("not json"), evidence_provider=CountingProvider({}))
        raw, provenance = rc.research("Germany", None, use_search=True)
        assert raw is None
        assert provenance == ResearchProvenance(initiatives_used=0, search=True, model="m")
