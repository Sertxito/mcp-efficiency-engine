from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SpanRecord:
    name: str
    kind: str
    span_id: str
    parent_span_id: str | None
    trace_id: str
    execution_id: str
    started_at: str
    ended_at: str | None = None
    duration_ms: float | None = None
    status: str = "UNSET"
    attributes: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        self.events.append(
            {
                "name": name,
                "timestamp": utc_now(),
                "attributes": attributes or {},
            }
        )

    def end(self, *, status: str = "OK", error: str | None = None) -> None:
        self.ended_at = utc_now()
        self.status = status
        self.error = error
        start_dt = datetime.fromisoformat(self.started_at)
        end_dt = datetime.fromisoformat(self.ended_at)
        self.duration_ms = max(0.0, (end_dt - start_dt).total_seconds() * 1000.0)
