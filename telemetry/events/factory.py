from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from telemetry.context.propagation import TelemetryContext


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_event(
    *,
    event_name: str,
    event_type: str,
    context: TelemetryContext | None,
    payload: dict[str, Any] | None = None,
    level: str = "INFO",
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "event_schema_version": "1.0.0",
        "timestamp": utc_now(),
        "type": event_type,
        "event_name": event_name,
        "level": level,
        "payload": payload or {},
    }
    if context is not None:
        data["context"] = {
            "execution_id": context.execution_id,
            "trace_id": context.trace_id,
            "span_id": context.span_id,
            "parent_span_id": context.parent_span_id,
            "request_id": context.request_id,
            "session_id": context.session_id,
            "correlation_id": context.correlation_id,
            "user": context.user,
            "provider": context.provider,
            "model": context.model,
        }
    return data
