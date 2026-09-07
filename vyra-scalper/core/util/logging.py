"""Structured JSON logging.

One log line is one JSON object with a stable field set, so that logs are queryable
without regex archaeology and can be shipped to any collector without an engine change
(``ARCHITECTURE.md`` §8).

Reserved fields, always present when known: ``ts``, ``level``, ``component``, ``event``,
``instrument``, ``strategy_id``, ``run_id``, ``correlation_id``, ``reason_codes``.

The engine never logs credentials.  :func:`redact` is applied to every value whose key
matches a secret-ish name, so a config dump cannot leak an API key into a log file.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

from core.util.clock import now_ns, to_iso

__all__ = ["JsonFormatter", "StructuredLogger", "configure_logging", "get_logger", "redact"]

_SECRET_KEY_HINTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "private_key",
    "credential",
    "authorization",
    "account_number",
)
_REDACTED = "***REDACTED***"

_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


def redact(key: str, value: Any) -> Any:
    """Replace ``value`` with a placeholder when ``key`` names a secret.

    Matching is substring-based and case-insensitive: it is better to over-redact a log
    field than to publish a broker password.
    """
    lowered = key.lower()
    if any(hint in lowered for hint in _SECRET_KEY_HINTS):
        return _REDACTED
    if isinstance(value, dict):
        return {k: redact(k, v) for k, v in value.items()}
    return value


class JsonFormatter(logging.Formatter):
    """Render a :class:`logging.LogRecord` as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": to_iso(int(record.created * 1_000_000_000)),
            "level": record.levelname,
            "component": record.name,
            "event": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            payload[key] = redact(key, value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


class StructuredLogger:
    """Thin wrapper binding persistent context onto every emitted record.

    ``bind`` returns a new logger rather than mutating, so a per-instrument or
    per-strategy logger can be handed out without leaking context back to the parent.
    """

    __slots__ = ("_context", "_logger")

    def __init__(self, logger: logging.Logger, context: dict[str, Any] | None = None) -> None:
        self._logger = logger
        self._context = dict(context or {})

    def bind(self, **context: Any) -> StructuredLogger:
        """Return a child logger carrying ``context`` on every record."""
        merged = {**self._context, **context}
        return StructuredLogger(self._logger, merged)

    def _emit(self, level: int, event: str, **fields: Any) -> None:
        extra = {**self._context, **fields}
        self._logger.log(level, event, extra=extra, stacklevel=3)

    def debug(self, event: str, **fields: Any) -> None:
        self._emit(logging.DEBUG, event, **fields)

    def info(self, event: str, **fields: Any) -> None:
        self._emit(logging.INFO, event, **fields)

    def warning(self, event: str, **fields: Any) -> None:
        self._emit(logging.WARNING, event, **fields)

    def error(self, event: str, **fields: Any) -> None:
        self._emit(logging.ERROR, event, **fields)

    def exception(self, event: str, **fields: Any) -> None:
        """Log at ERROR with the active exception's traceback attached."""
        extra = {**self._context, **fields}
        self._logger.error(event, extra=extra, exc_info=True, stacklevel=3)

    def critical(self, event: str, **fields: Any) -> None:
        self._emit(logging.CRITICAL, event, **fields)


def configure_logging(level: str = "INFO", stream: Any = None) -> None:
    """Install the JSON formatter on the root logger.

    Idempotent: repeated calls replace the handler rather than stacking duplicates, which
    otherwise produces every log line N times after a few test modules have run.
    """
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


def get_logger(component: str, **context: Any) -> StructuredLogger:
    """Return a :class:`StructuredLogger` for ``component`` with optional bound context."""
    return StructuredLogger(logging.getLogger(component), context)


def timestamped_context(**fields: Any) -> dict[str, Any]:
    """Helper producing a context dict stamped with the current engine time."""
    return {"ts_ns": now_ns(), **fields}
