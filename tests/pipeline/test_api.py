import json
from datetime import date

from conftest import Block, Message, full_result, text_message
from regulation_pipeline.api import ResearchClient, parse_message


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


def _client(message=None):
    return ResearchClient(
        _FakeClient(message), default_model="m", search_model="s", today=date(2026, 6, 11)
    )


class TestRequestParams:
    def test_default_run(self):
        params = _client().request_params("Germany", None, use_search=False)
        assert params["model"] == "m"
        assert params["max_tokens"] == 2048
        assert "tools" not in params
        assert params["output_config"]["format"]["type"] == "json_schema"

    def test_search_run_uses_search_model_and_tool(self):
        params = _client().request_params("Germany", None, use_search=True)
        assert params["model"] == "s"
        assert params["max_tokens"] == 3072
        assert params["tools"][0]["type"] == "web_search_20260209"

    def test_prompt_includes_country_and_existing_data(self):
        params = _client().request_params(
            "Germany", {"Regulation Status": "prior status"}, use_search=False
        )
        prompt = params["messages"][0]["content"]
        assert "Germany" in prompt
        assert "prior status" in prompt


class TestResearch:
    def test_calls_client_and_parses(self):
        rc = _client(text_message(json.dumps(full_result())))
        result = rc.research("Germany", None, use_search=False)
        assert result["confidence"] == "high"

    def test_uses_selected_model(self):
        client = _FakeClient(text_message(json.dumps(full_result())))
        rc = ResearchClient(client, default_model="m", search_model="s", today=date(2026, 6, 11))
        rc.research("Germany", None, use_search=True)
        assert client.messages.kwargs["model"] == "s"
