"""Metrics export.

The structured log schema was designed so exporters need no engine change, and this is that
exporter: it reads counters the engine already keeps and renders them, rather than
instrumenting the hot path a second time.
"""

from core.observability.collect import collect_engine_metrics
from core.observability.metrics import (
    MetricLabelError,
    MetricsRegistry,
    render_prometheus,
)

__all__ = [
    "MetricLabelError",
    "MetricsRegistry",
    "collect_engine_metrics",
    "render_prometheus",
]
