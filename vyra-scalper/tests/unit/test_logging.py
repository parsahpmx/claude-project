"""Structured logging: a log call must never raise, and must never leak a secret."""

from __future__ import annotations

import io
import json

import pytest

from core.util.logging import configure_logging, get_logger, redact


@pytest.fixture
def stream() -> io.StringIO:
    buffer = io.StringIO()
    configure_logging("DEBUG", buffer)
    return buffer


def lines(stream: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


class TestReservedFieldNames:
    """``logging`` raises KeyError when ``extra`` collides with a record attribute.

    The natural place to write ``message=exc.message`` is inside an error handler, where an
    unhandled exception does the most damage, so the logger must absorb the collision.
    """

    @pytest.mark.parametrize(
        "name", ["message", "name", "module", "args", "filename", "lineno", "process"]
    )
    def test_a_reserved_field_name_does_not_raise(self, stream: io.StringIO, name: str) -> None:
        get_logger("test").info("event", **{name: "value"})
        assert len(lines(stream)) == 1

    def test_the_value_is_preserved_under_a_prefixed_key(self, stream: io.StringIO) -> None:
        get_logger("test").info("event", message="the detail")
        record = lines(stream)[0]
        assert record["field_message"] == "the detail"
        assert record["event"] == "event"

    def test_exception_logging_survives_a_reserved_field(self, stream: io.StringIO) -> None:
        log = get_logger("test")
        try:
            raise ValueError("boom")
        except ValueError as exc:
            log.exception("handler_failed", message=str(exc))
        record = lines(stream)[0]
        assert record["field_message"] == "boom"
        assert "ValueError" in record["exception"]

    def test_bound_context_is_sanitised_too(self, stream: io.StringIO) -> None:
        get_logger("test").bind(name="bound").info("event")
        assert lines(stream)[0]["field_name"] == "bound"


class TestRedaction:
    @pytest.mark.parametrize(
        "key",
        ["password", "api_key", "apiKey", "MT5_PASSWORD", "secret", "auth_token",
         "private_key", "account_number"],
    )
    def test_secret_shaped_keys_are_redacted(self, stream: io.StringIO, key: str) -> None:
        get_logger("test").info("connect", **{key: "hunter2"})
        assert "hunter2" not in stream.getvalue()

    def test_nested_secrets_are_redacted(self) -> None:
        result = redact("connection", {"host": "localhost", "password": "hunter2"})
        assert result["host"] == "localhost"
        assert result["password"] != "hunter2"

    def test_ordinary_fields_are_untouched(self, stream: io.StringIO) -> None:
        get_logger("test").info("fill", instrument="CME:MES", price=5100.25)
        record = lines(stream)[0]
        assert record["instrument"] == "CME:MES"
        assert record["price"] == 5100.25


class TestStructure:
    def test_every_record_carries_the_stable_field_set(self, stream: io.StringIO) -> None:
        get_logger("component").info("event_name")
        record = lines(stream)[0]
        for field in ("ts", "level", "component", "event"):
            assert field in record

    def test_bind_returns_a_child_without_mutating_the_parent(
        self, stream: io.StringIO
    ) -> None:
        parent = get_logger("test")
        parent.bind(run_id="r1").info("child_event")
        parent.info("parent_event")
        records = lines(stream)
        assert records[0]["run_id"] == "r1"
        assert "run_id" not in records[1]

    def test_configure_logging_is_idempotent(self) -> None:
        """Repeated configuration must not duplicate every line."""
        buffer = io.StringIO()
        configure_logging("INFO", buffer)
        configure_logging("INFO", buffer)
        get_logger("test").info("once")
        assert len(lines(buffer)) == 1
