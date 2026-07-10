from __future__ import annotations

import uuid
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from telemetry.context.propagation import (
    TelemetryContext,
    child_context,
    get_current_context,
    new_execution_context,
    reset_current_context,
    set_current_context,
)
from telemetry.events.catalog import CANONICAL_EVENTS
from telemetry.events.factory import make_event
from telemetry.metrics.aggregator import MetricsAggregator
from telemetry.scoring.efficiency import compute_efficiency_score
from telemetry.tracing.span import SpanRecord


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class _ExecutionScope(AbstractContextManager[TelemetryContext]):
    collector: "TelemetryCollector"
    context: TelemetryContext
    token: Any
    operation: str
    start_ts: str

    def __enter__(self) -> TelemetryContext:
        self.collector.record_event("ExecutionStarted", {"operation": self.operation, "started_at": self.start_ts})
        return self.context

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc is not None:
            self.collector.record_event("ExceptionThrown", {"operation": self.operation, "error": str(exc)}, level="ERROR")
            self.collector.metrics.bump("error_count")
        self.collector.metrics.snapshot.execution_time_ms = max(
            0.0,
            (datetime.fromisoformat(utc_now()) - datetime.fromisoformat(self.start_ts)).total_seconds() * 1000.0,
        )
        self.collector.record_metric("efficiency_score", compute_efficiency_score(self.collector.metrics.to_dict()), unit="score")
        self.collector.record_event("ExecutionFinished", {"operation": self.operation, "finished_at": utc_now()})
        self.collector.flush()
        reset_current_context(self.token)
        return False


@dataclass
class _SpanScope(AbstractContextManager[SpanRecord]):
    collector: "TelemetryCollector"
    span: SpanRecord
    token: Any

    def __enter__(self) -> SpanRecord:
        self.collector.record_event(
            "SpanStarted",
            {
                "name": self.span.name,
                "span_id": self.span.span_id,
                "parent_span_id": self.span.parent_span_id,
                "kind": self.span.kind,
            },
        )
        return self.span

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc is not None:
            self.span.end(status="ERROR", error=str(exc))
            self.collector.metrics.bump("error_count")
            self.collector.record_event("ExceptionThrown", {"span": self.span.name, "error": str(exc)}, level="ERROR")
        else:
            self.span.end(status="OK")

        if self.span.duration_ms is not None:
            self.collector.metrics.add_duration(self.span.duration_ms)

        self.collector._emit(
            make_event(
                event_name="SpanFinished",
                event_type="span",
                context=get_current_context(),
                payload={
                    "name": self.span.name,
                    "kind": self.span.kind,
                    "span_id": self.span.span_id,
                    "parent_span_id": self.span.parent_span_id,
                    "trace_id": self.span.trace_id,
                    "execution_id": self.span.execution_id,
                    "started_at": self.span.started_at,
                    "ended_at": self.span.ended_at,
                    "duration_ms": self.span.duration_ms,
                    "status": self.span.status,
                    "attributes": self.span.attributes,
                    "events": self.span.events,
                    "error": self.span.error,
                },
            )
        )
        reset_current_context(self.token)
        return False


class TelemetryCollector:
    def __init__(
        self,
        *,
        exporters: list[Any],
        enabled: bool = True,
        batch_size: int = 25,
    ) -> None:
        self.enabled = bool(enabled)
        self.exporters = exporters
        self.batch_size = max(1, int(batch_size))
        self.queue: list[dict[str, Any]] = []
        self.metrics = MetricsAggregator()
        self.warning_buffer: list[str] = []

    def start_execution(
        self,
        *,
        operation: str,
        request_id: str | None = None,
        session_id: str = "default-session",
        correlation_id: str | None = None,
        execution_id: str | None = None,
        user: str | None = None,
        provider: str | None = None,
        model: str | None = None,
    ) -> AbstractContextManager[TelemetryContext]:
        request = request_id or str(uuid.uuid4())
        correlation = correlation_id or request
        execution = execution_id or str(uuid.uuid4())
        context = new_execution_context(
            request_id=request,
            session_id=session_id,
            correlation_id=correlation,
            execution_id=execution,
            user=user,
            provider=provider,
            model=model,
        )
        token = set_current_context(context)
        return _ExecutionScope(self, context, token, operation, utc_now())

    def start_span(
        self,
        *,
        name: str,
        kind: str = "INTERNAL",
        attributes: dict[str, Any] | None = None,
    ) -> AbstractContextManager[SpanRecord]:
        current = get_current_context()
        if current is None:
            current = new_execution_context(
                request_id=str(uuid.uuid4()),
                session_id="implicit-session",
                correlation_id=str(uuid.uuid4()),
                execution_id=str(uuid.uuid4()),
            )
            token = set_current_context(current)
        else:
            child = child_context(current)
            token = set_current_context(child)
            current = child

        span = SpanRecord(
            name=name,
            kind=kind,
            span_id=current.span_id,
            parent_span_id=current.parent_span_id,
            trace_id=current.trace_id,
            execution_id=current.execution_id,
            started_at=utc_now(),
            attributes=attributes or {},
        )
        return _SpanScope(self, span, token)

    def record_event(self, event_name: str, payload: dict[str, Any] | None = None, *, level: str = "INFO") -> None:
        canonical = event_name if event_name in CANONICAL_EVENTS else "WarningGenerated"
        if canonical == "WarningGenerated" and event_name not in CANONICAL_EVENTS:
            payload = {"original_event": event_name, **(payload or {})}
        if level.upper() == "WARNING":
            self.metrics.bump("warning_count")
        self._emit(make_event(event_name=canonical, event_type="event", context=get_current_context(), payload=payload, level=level.upper()))

    def record_metric(self, metric_name: str, value: float, *, unit: str = "count", tags: dict[str, Any] | None = None) -> None:
        payload = {"name": metric_name, "value": value, "unit": unit, "tags": tags or {}}
        if metric_name == "estimated_cost":
            self.metrics.add_cost(float(value))
        self._emit(make_event(event_name="MetricCalculated", event_type="metric", context=get_current_context(), payload=payload))

    def record_usage(self, *, input_tokens: int, output_tokens: int, estimated_cost_usd: float) -> None:
        self.metrics.add_tokens(input_tokens, output_tokens)
        self.metrics.add_cost(estimated_cost_usd)
        self.record_metric("tokens_input", float(input_tokens), unit="tokens")
        self.record_metric("tokens_output", float(output_tokens), unit="tokens")
        self.record_metric("total_tokens", float(input_tokens + output_tokens), unit="tokens")
        self.record_metric("estimated_cost", float(estimated_cost_usd), unit="usd")

    def _emit(self, record: dict[str, Any]) -> None:
        if not self.enabled:
            return
        self.queue.append(record)
        if len(self.queue) >= self.batch_size:
            self.flush()

    def flush(self) -> None:
        if not self.enabled or not self.queue:
            return

        batch = self.queue[:]
        self.queue = []
        for exporter in self.exporters:
            try:
                exporter_started = make_event(
                    event_name="ExporterStarted",
                    event_type="event",
                    context=get_current_context(),
                    payload={"exporter": exporter.name},
                )
                batch_with_started = [exporter_started, *batch]
                exporter.export(batch_with_started)
                exporter.flush()
                exporter_finished = make_event(
                    event_name="ExporterFinished",
                    event_type="event",
                    context=get_current_context(),
                    payload={"exporter": exporter.name, "success": True},
                )
                exporter.export([exporter_finished])
            except Exception as exc:
                self.warning_buffer.append(f"exporter_failed:{exporter.name}:{exc}")
                warning = make_event(
                    event_name="WarningGenerated",
                    event_type="event",
                    context=get_current_context(),
                    payload={"warning": "exporter_failed", "exporter": exporter.name, "error": str(exc)},
                    level="WARNING",
                )
                for backup in self.exporters:
                    if backup.name == exporter.name:
                        continue
                    try:
                        backup.export([warning])
                    except Exception:
                        continue

    def shutdown(self) -> None:
        self.flush()
        for exporter in self.exporters:
            try:
                exporter.shutdown()
            except Exception:
                continue
