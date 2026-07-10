from __future__ import annotations

import contextvars
import secrets
from dataclasses import dataclass, replace
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_trace_id() -> str:
    # 16 bytes -> 32 lowercase hex chars, aligned with OTel expectations.
    return secrets.token_hex(16)


def new_span_id() -> str:
    # 8 bytes -> 16 lowercase hex chars, aligned with OTel expectations.
    return secrets.token_hex(8)


@dataclass(frozen=True)
class TelemetryContext:
    execution_id: str
    trace_id: str
    span_id: str
    parent_span_id: str | None
    request_id: str
    session_id: str
    correlation_id: str
    timestamp: str
    user: str | None = None
    provider: str | None = None
    model: str | None = None


_context_var: contextvars.ContextVar[TelemetryContext | None] = contextvars.ContextVar("telemetry_context", default=None)


def get_current_context() -> TelemetryContext | None:
    return _context_var.get()


def set_current_context(context: TelemetryContext | None) -> contextvars.Token[TelemetryContext | None]:
    return _context_var.set(context)


def reset_current_context(token: contextvars.Token[TelemetryContext | None]) -> None:
    _context_var.reset(token)


def new_execution_context(
    *,
    request_id: str,
    session_id: str,
    correlation_id: str,
    execution_id: str,
    user: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> TelemetryContext:
    root_span_id = new_span_id()
    return TelemetryContext(
        execution_id=execution_id,
        trace_id=new_trace_id(),
        span_id=root_span_id,
        parent_span_id=None,
        request_id=request_id,
        session_id=session_id,
        correlation_id=correlation_id,
        timestamp=utc_now(),
        user=user,
        provider=provider,
        model=model,
    )


def child_context(parent: TelemetryContext) -> TelemetryContext:
    return replace(
        parent,
        span_id=new_span_id(),
        parent_span_id=parent.span_id,
        timestamp=utc_now(),
    )
