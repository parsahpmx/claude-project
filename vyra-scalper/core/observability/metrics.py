"""Prometheus exposition, with the credential filter applied to label names.

**Why label names are filtered.** A metrics endpoint is the least-guarded surface a service
has: it is scraped continuously, retained for months, and in most deployments readable by
anyone who can reach the network. A label is the one part of a metric that carries free text,
so it is where an account id or a key ends up if nobody stops it. The same list that filters
the config endpoint filters label names here, and a credential-shaped label is a
:class:`MetricLabelError` at registration — a startup failure, not a runtime leak.

Label *values* are escaped but not inspected. A secret cannot be recognised by looking at
it; what can be recognised is the field that conventionally holds one. Callers are expected
to keep values low-cardinality — an instrument id, a broker id, a state name — and the
cardinality rule and the credential rule turn out to be the same rule: anything unique per
account or per session belongs in neither.

**No client library.** The exposition format is a short, stable specification, and the
engine core deliberately depends on nothing beyond the standard library and PyYAML. A
backtest should not need a metrics client to run.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Literal

from core.util.redaction import is_credential_name

__all__ = ["Metric", "MetricLabelError", "MetricsRegistry", "render_prometheus"]

MetricKind = Literal["counter", "gauge"]

# Prometheus metric and label names: [a-zA-Z_:][a-zA-Z0-9_:]* and [a-zA-Z_][a-zA-Z0-9_]*.
_NAME_START = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_:")
_NAME_BODY = _NAME_START | set("0123456789")


class MetricLabelError(ValueError):
    """A label that must not be exported.

    Raised at registration rather than at scrape time, so the failure is a service that
    will not start rather than a service that quietly publishes a credential.
    """


def _validate_name(name: str, *, is_label: bool) -> None:
    if not name:
        raise MetricLabelError("a metric or label name cannot be empty")
    allowed_start = _NAME_START - {":"} if is_label else _NAME_START
    if name[0] not in allowed_start or any(c not in _NAME_BODY for c in name[1:]):
        raise MetricLabelError(f"{name!r} is not a valid Prometheus name")
    if is_label and is_credential_name(name):
        raise MetricLabelError(
            f"label {name!r} is credential-shaped and must not be exported. A metrics "
            "endpoint is scraped continuously and retained for months; anything unique "
            "per account or per session belongs in neither a label nor a log line."
        )


def _escape_value(value: str) -> str:
    """Escape a label value per the exposition format."""
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _escape_help(text: str) -> str:
    return text.replace("\\", "\\\\").replace("\n", " ")


@dataclass(slots=True)
class Metric:
    """One metric family and its samples."""

    name: str
    kind: MetricKind
    help: str
    samples: dict[tuple[tuple[str, str], ...], float] = field(default_factory=dict)


class MetricsRegistry:
    """Somewhere to put numbers the engine already counts.

    Deliberately not a global. A registry passed in can be inspected by a test and thrown
    away, and two runs in one process cannot contaminate each other's counters — which
    matters here, because the backtester runs many.
    """

    __slots__ = ("_metrics",)

    def __init__(self) -> None:
        self._metrics: dict[str, Metric] = {}

    def _metric(self, name: str, kind: MetricKind, help_text: str) -> Metric:
        _validate_name(name, is_label=False)
        existing = self._metrics.get(name)
        if existing is None:
            existing = Metric(name=name, kind=kind, help=help_text)
            self._metrics[name] = existing
        elif existing.kind != kind:
            raise MetricLabelError(
                f"metric {name!r} is already registered as a {existing.kind}, "
                f"and cannot also be a {kind}"
            )
        return existing

    @staticmethod
    def _key(labels: dict[str, str] | None) -> tuple[tuple[str, str], ...]:
        if not labels:
            return ()
        for label in labels:
            _validate_name(label, is_label=True)
        # Sorted so the same label set always produces the same key, whatever order the
        # caller happened to write it in.
        return tuple(sorted((k, str(v)) for k, v in labels.items()))

    def gauge(
        self, name: str, value: float, help_text: str = "", labels: dict[str, str] | None = None
    ) -> None:
        """Set a gauge. Last write wins, which is what a gauge means."""
        metric = self._metric(name, "gauge", help_text)
        metric.samples[self._key(labels)] = float(value)

    def counter(
        self, name: str, value: float, help_text: str = "", labels: dict[str, str] | None = None
    ) -> None:
        """Set a counter to an absolute value.

        Absolute rather than incremental because the engine's counters are already
        absolute: they are read from a stats object at scrape time, not accumulated here.
        Prometheus only requires that a counter never decrease between scrapes, and a
        counter read from a long-lived object does not.
        """
        metric = self._metric(name, "counter", help_text)
        metric.samples[self._key(labels)] = float(value)

    def observe_all(
        self, prefix: str, stats: Mapping[str, float | int], help_text: str = "",
        labels: dict[str, str] | None = None,
    ) -> None:
        """Export a whole stats dict under ``prefix``.

        Every component in the engine already exposes ``to_dict()`` of its counters, so
        this is how they reach the endpoint without a second instrumentation pass. Keys are
        validated like any other name — a stats dict that grew a credential-shaped key
        fails here rather than publishing it.
        """
        for key, value in stats.items():
            self.counter(f"{prefix}_{key}", float(value), help_text, labels)

    def render(self) -> str:
        return render_prometheus(self._metrics.values())


def render_prometheus(metrics: Iterable[Metric]) -> str:
    """Render metrics in the Prometheus text exposition format.

    Families are emitted in name order so a diff between two scrapes is readable, and each
    is preceded by its HELP and TYPE lines.
    """
    lines: list[str] = []
    for metric in sorted(metrics, key=lambda m: m.name):
        if metric.help:
            lines.append(f"# HELP {metric.name} {_escape_help(metric.help)}")
        lines.append(f"# TYPE {metric.name} {metric.kind}")
        for key in sorted(metric.samples):
            value = metric.samples[key]
            if key:
                rendered = ",".join(f'{name}="{_escape_value(val)}"' for name, val in key)
                lines.append(f"{metric.name}{{{rendered}}} {_format(value)}")
            else:
                lines.append(f"{metric.name} {_format(value)}")
    return "\n".join(lines) + "\n"


def _format(value: float) -> str:
    """Render a number the way the exposition format expects.

    Integers without a decimal point, so a counter reads as a count; NaN and the infinities
    spelled out, because Prometheus accepts those spellings and Python's repr does not
    match them.
    """
    if value != value:
        return "NaN"
    if value == float("inf"):
        return "+Inf"
    if value == float("-inf"):
        return "-Inf"
    if float(value).is_integer() and abs(value) < 1e15:
        return str(int(value))
    return repr(value)
