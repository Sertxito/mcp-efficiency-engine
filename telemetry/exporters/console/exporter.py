from __future__ import annotations

import json


class ConsoleExporter:
    name = "console"

    def export(self, records: list[dict]) -> None:
        for record in records:
            event_name = str(record.get("event_name", "unknown"))
            event_type = str(record.get("type", "event"))
            level = str(record.get("level", "INFO"))
            context = record.get("context", {})
            execution_id = context.get("execution_id", "n/a")
            print(f"[telemetry][{level}][{event_type}] {event_name} execution={execution_id}")
            if event_type == "span":
                payload = record.get("payload", {})
                summary = {
                    "name": payload.get("name"),
                    "duration_ms": payload.get("duration_ms"),
                    "status": payload.get("status"),
                }
                print(f"[telemetry][span] {json.dumps(summary, ensure_ascii=False)}")

    def flush(self) -> None:
        return

    def shutdown(self) -> None:
        return
