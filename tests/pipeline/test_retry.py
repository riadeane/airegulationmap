import pytest
from regulation_pipeline.errors import FatalAPIError
from regulation_pipeline.retry import MAX_ATTEMPTS, call_with_retries


def test_success_returns_value():
    assert call_with_retries(lambda: "ok", label="x") == "ok"


def test_auth_error_is_fatal(anthropic_errors):
    def call():
        raise anthropic_errors["auth"]()

    with pytest.raises(FatalAPIError):
        call_with_retries(call, label="x", sleep=lambda s: None)


def test_permission_error_is_fatal(anthropic_errors):
    def call():
        raise anthropic_errors["permission"]()

    with pytest.raises(FatalAPIError):
        call_with_retries(call, label="x", sleep=lambda s: None)


def test_4xx_is_fatal(anthropic_errors):
    def call():
        raise anthropic_errors["bad_request"]()

    with pytest.raises(FatalAPIError):
        call_with_retries(call, label="x", sleep=lambda s: None)


def test_transient_then_success(anthropic_errors):
    state = {"n": 0}

    def call():
        state["n"] += 1
        if state["n"] == 1:
            raise anthropic_errors["timeout"]()
        return "ok"

    sleeps: list[float] = []
    assert call_with_retries(call, label="x", sleep=sleeps.append) == "ok"
    assert state["n"] == 2
    assert len(sleeps) == 1


def test_exhaustion_returns_none(anthropic_errors):
    def call():
        raise anthropic_errors["connection"]()

    sleeps: list[float] = []
    assert call_with_retries(call, label="x", sleep=sleeps.append) is None
    # One sleep per retry (not after the final attempt).
    assert len(sleeps) == MAX_ATTEMPTS - 1


def test_retry_after_honored_on_rate_limit(anthropic_errors):
    def call():
        raise anthropic_errors["rate_limit"](retry_after=7)

    sleeps: list[float] = []
    call_with_retries(call, label="x", sleep=sleeps.append)
    assert sleeps and all(s == 7.0 for s in sleeps)


def test_retry_after_honored_on_5xx(anthropic_errors):
    # Regression: the old code passed no exception to the backoff on the 5xx
    # path, so Retry-After was ignored there.
    def call():
        raise anthropic_errors["server_500"](retry_after=5)

    sleeps: list[float] = []
    call_with_retries(call, label="x", sleep=sleeps.append)
    assert sleeps and all(s == 5.0 for s in sleeps)
