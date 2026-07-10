from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from datetime import timezone
from uuid import UUID
from uuid import uuid5
from uuid import NAMESPACE_URL
from typing import Any


class LangSmithExporter:
    name = "langsmith"

    def __init__(
        self,
        *,
        api_key: str,
        project: str,
        endpoint: str | None = None,
        workspace_id: str | None = None,
        high_signal_only: bool = True,
        min_span_duration_ms: float = 100.0,
        emit_execution_summary: bool = True,
    ) -> None:
        self.api_key = api_key.strip()
        self.project = project.strip()
        self.endpoint = (endpoint or "").strip() or None
        self.workspace_id = (workspace_id or "").strip() or None
        self.high_signal_only = bool(high_signal_only)
        self.min_span_duration_ms = max(0.0, float(min_span_duration_ms))
        self.emit_execution_summary = bool(emit_execution_summary)
        self._client: Any | None = None
        self._usage_by_execution: dict[str, dict[str, float]] = defaultdict(dict)
        self._execution_state: dict[str, dict[str, Any]] = defaultdict(dict)
        if not self.api_key or not self.project:
            raise ValueError("LangSmith exporter requires api_key and project")

    def _update_execution_state(self, record: dict[str, Any], timestamp: datetime) -> None:
        context = record.get("context", {})
        payload = record.get("payload", {})
        execution_id = str(context.get("execution_id") or "")
        if not execution_id:
            return

        state = self._execution_state[execution_id]
        state.setdefault("warnings", 0)
        state.setdefault("errors", 0)
        state.setdefault("operation", payload.get("operation"))
        state.setdefault("provider", context.get("provider"))
        state.setdefault("model", context.get("model"))

        event_name = str(record.get("event_name", ""))
        record_type = str(record.get("type", "event"))
        level = str(record.get("level", "INFO")).upper()

        if event_name == "ExecutionStarted":
            started_at = payload.get("started_at") or record.get("timestamp")
            state["started_at"] = self._parse_timestamp(started_at)
            if payload.get("operation"):
                state["operation"] = payload.get("operation")
        elif event_name == "RoutingResolved":
            if payload.get("agent"):
                state["agent"] = payload.get("agent")
            if payload.get("engine"):
                state["engine"] = payload.get("engine")
        elif event_name in {"WarningGenerated"} or level == "WARNING":
            state["warnings"] = int(state.get("warnings", 0)) + 1
        elif event_name in {"ExceptionThrown"} or level == "ERROR":
            state["errors"] = int(state.get("errors", 0)) + 1
            if payload.get("error"):
                state["last_error"] = payload.get("error")

        if record_type == "span":
            status = str(payload.get("status", "OK")).upper()
            if status != "OK":
                state["errors"] = int(state.get("errors", 0)) + 1
            state["last_span_duration_ms"] = payload.get("duration_ms")

    def _build_execution_summary(self, execution_id: str, context: dict[str, Any], timestamp: datetime) -> dict[str, Any]:
        state = self._execution_state.get(execution_id, {})
        started_at = state.get("started_at")
        if isinstance(started_at, datetime):
            duration_ms = max(0.0, (timestamp - started_at).total_seconds() * 1000.0)
        else:
            duration_ms = 0.0

        warnings = int(state.get("warnings", 0))
        errors = int(state.get("errors", 0))
        status = "error" if errors > 0 else "ok"

        usage = self._usage_by_execution.get(execution_id, {})
        usage_summary = {
            "input_tokens": int(usage.get("tokens_input", 0.0)),
            "output_tokens": int(usage.get("tokens_output", 0.0)),
            "total_tokens": int(usage.get("total_tokens", 0.0)),
            "total_cost": float(usage.get("estimated_cost", 0.0)),
        }

        summary = {
            "name": "ExecutionSummary",
            "run_type": "chain",
            "inputs": {
                "execution_id": execution_id,
                "operation": state.get("operation"),
                "agent": state.get("agent"),
                "engine": state.get("engine"),
            },
            "outputs": {
                "status": status,
                "duration_ms": duration_ms,
                "warning_count": warnings,
                "error_count": errors,
                "usage_metadata": usage_summary,
                "provider": context.get("provider") or state.get("provider"),
                "model": context.get("model") or state.get("model"),
            },
            "extra": {
                "metadata": {
                    "execution_id": execution_id,
                    "telemetry_kind": "execution_summary",
                    "last_error": state.get("last_error"),
                    "usage_metadata": usage_summary,
                    "ls_provider": context.get("provider") or state.get("provider"),
                    "ls_model_name": context.get("model") or state.get("model"),
                }
            },
            "id": self._to_uuid(f"{execution_id}:execution-summary", salt="run"),
            "start_time": started_at if isinstance(started_at, datetime) else timestamp,
            "end_time": timestamp,
            "total_tokens": usage_summary["total_tokens"],
            "total_cost": usage_summary["total_cost"],
            "tags": ["telemetry", "execution", "summary"],
        }
        return summary

    def _is_high_signal_record(self, record: dict[str, Any]) -> bool:
        record_type = str(record.get("type", "event"))
        event_name = str(record.get("event_name", "TelemetryEvent"))
        payload = record.get("payload", {})
        level = str(record.get("level", "INFO")).upper()

        if level in {"ERROR", "WARNING"}:
            return True

        if record_type == "metric":
            # Emit only the per-execution summary for usage/cost to avoid noise.
            return False

        if record_type == "span":
            duration_ms = float(payload.get("duration_ms") or 0.0)
            status = str(payload.get("status", "OK")).upper()
            return status != "OK" or duration_ms >= self.min_span_duration_ms

        return event_name in {
            "ExecutionStarted",
            "ExecutionFinished",
            "RoutingResolved",
            "ExceptionThrown",
            "WarningGenerated",
        }

    def _to_uuid(self, value: Any, *, salt: str = "") -> str | None:
        if value is None:
            return None
        raw = str(value).strip()
        if not raw:
            return None
        try:
            return str(UUID(raw))
        except Exception:
            try:
                return str(UUID(hex=raw))
            except Exception:
                return str(uuid5(NAMESPACE_URL, f"mcpee:{salt}:{raw}"))

    def _parse_timestamp(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value.astimezone(timezone.utc)
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value).astimezone(timezone.utc)
            except Exception:
                pass
        return datetime.now(timezone.utc)

    def _build_usage_summary(self, execution_id: str, context: dict[str, Any], timestamp: datetime) -> dict[str, Any]:
        usage = self._usage_by_execution.get(execution_id, {})
        model = context.get("model")
        provider = context.get("provider")
        input_tokens = int(usage.get("tokens_input", 0.0))
        output_tokens = int(usage.get("tokens_output", 0.0))
        total_tokens = int(usage.get("total_tokens", 0.0))
        total_cost = float(usage.get("estimated_cost", 0.0))
        usage_metadata = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "total_cost": total_cost,
        }
        return {
            "name": "UsageSummary",
            "run_type": "llm",
            "inputs": {
                "execution_id": execution_id,
                "provider": provider,
                "model": model,
            },
            "outputs": {
                "model": model,
                "provider": provider,
                "usage_metadata": usage_metadata,
                "status": "recorded",
            },
            "extra": {
                "metadata": {
                    "execution_id": execution_id,
                    "trace_id": context.get("trace_id"),
                    "provider": provider,
                    "model": model,
                    "ls_provider": provider,
                    "ls_model_name": model,
                    "usage_metadata": usage_metadata,
                    "telemetry_kind": "usage_summary",
                }
            },
            "id": self._to_uuid(f"{execution_id}:usage-summary", salt="run"),
            "start_time": timestamp,
            "end_time": timestamp,
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": total_tokens,
            "total_cost": total_cost,
            "tags": ["telemetry", "usage", "cost"],
        }

    def _run_payload(self, record: dict[str, Any], *, index: int) -> dict[str, Any]:
        event_name = str(record.get("event_name", "TelemetryEvent"))
        context = record.get("context", {})
        payload = record.get("payload", {})
        record_type = str(record.get("type", "event"))
        level = str(record.get("level", "INFO"))
        execution_id = str(context.get("execution_id") or "")
        provider = context.get("provider")
        model = context.get("model")
        timestamp = self._parse_timestamp(record.get("timestamp"))

        inputs: dict[str, Any] = {"event": event_name, "type": record_type}
        outputs: dict[str, Any] = {"status": "recorded", "level": level}
        run_type = "chain"
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        total_tokens: int | None = None
        total_cost: float | None = None

        if record_type == "metric":
            metric_name = str(payload.get("name", "unknown"))
            metric_value = payload.get("value")
            metric_unit = payload.get("unit")
            inputs = {
                "metric": metric_name,
                "value": metric_value,
                "unit": metric_unit,
                "execution_id": execution_id,
            }
            outputs = {
                "metric": metric_name,
                "value": metric_value,
                "unit": metric_unit,
                "provider": provider,
                "model": model,
                "status": "recorded",
            }
            if metric_name in {"tokens_input", "tokens_output", "total_tokens", "estimated_cost"} and execution_id:
                self._usage_by_execution[execution_id][metric_name] = float(metric_value or 0.0)
                run_type = "llm"
                if metric_name == "tokens_input":
                    prompt_tokens = int(float(metric_value or 0.0))
                elif metric_name == "tokens_output":
                    completion_tokens = int(float(metric_value or 0.0))
                elif metric_name == "total_tokens":
                    total_tokens = int(float(metric_value or 0.0))
                elif metric_name == "estimated_cost":
                    total_cost = float(metric_value or 0.0)
        elif record_type == "span":
            run_type = "tool"
            inputs = {
                "span": payload.get("name"),
                "kind": payload.get("kind"),
                "execution_id": execution_id,
            }
            outputs = {
                "status": payload.get("status", "recorded"),
                "duration_ms": payload.get("duration_ms"),
                "error": payload.get("error"),
                "provider": provider,
                "model": model,
            }
        else:
            inputs = {
                "event": event_name,
                "operation": payload.get("operation"),
                "execution_id": execution_id,
            }
            outputs = {
                "status": payload.get("status", "recorded"),
                "provider": provider,
                "model": model,
            }

        metadata = {
            "execution_id": context.get("execution_id"),
            "trace_id": context.get("trace_id"),
            "span_id": context.get("span_id"),
            "parent_span_id": context.get("parent_span_id"),
            "request_id": context.get("request_id"),
            "session_id": context.get("session_id"),
            "correlation_id": context.get("correlation_id"),
            "user": context.get("user"),
            "provider": provider,
            "model": model,
            "ls_provider": provider,
            "ls_model_name": model,
            "event_name": event_name,
            "type": record_type,
            "level": level,
            "payload": payload,
        }

        if prompt_tokens is not None or completion_tokens is not None or total_tokens is not None or total_cost is not None:
            metadata["usage_metadata"] = {
                "input_tokens": prompt_tokens or 0,
                "output_tokens": completion_tokens or 0,
                "total_tokens": total_tokens or 0,
                "total_cost": total_cost or 0.0,
            }

        run_id = self._to_uuid(
            f"{execution_id or 'no-exec'}:{context.get('span_id') or 'no-span'}:{event_name}:{record_type}:{index}",
            salt="run",
        )

        run_payload: dict[str, Any] = {
            "name": event_name,
            "run_type": run_type,
            "inputs": inputs,
            "outputs": outputs,
            "project_name": self.project,
            "extra": {"metadata": metadata},
            "id": run_id,
            "start_time": timestamp,
            "end_time": timestamp,
            "tags": ["telemetry", record_type],
            "_usage_ready": record_type == "metric" and str(payload.get("name", "")) == "estimated_cost" and bool(execution_id),
            "_execution_id": execution_id,
            "_context": context,
        }
        if prompt_tokens is not None:
            run_payload["prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            run_payload["completion_tokens"] = completion_tokens
        if total_tokens is not None:
            run_payload["total_tokens"] = total_tokens
        if total_cost is not None:
            run_payload["total_cost"] = total_cost
        return run_payload

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from langsmith import Client  # type: ignore
        except Exception as exc:
            raise RuntimeError("langsmith SDK is not installed") from exc

        kwargs: dict[str, Any] = {"api_key": self.api_key}
        if self.endpoint:
            kwargs["api_url"] = self.endpoint
        if self.workspace_id:
            kwargs["workspace_id"] = self.workspace_id
        self._client = Client(**kwargs)
        return self._client

    def export(self, records: list[dict]) -> None:
        client = self._get_client()
        for index, record in enumerate(records):
            run = self._run_payload(record, index=index)
            usage_ready = bool(run.pop("_usage_ready", False))
            execution_id = str(run.pop("_execution_id", "") or "")
            context = run.pop("_context", {})
            timestamp = run["end_time"]

            self._update_execution_state(record, timestamp)

            should_emit = True
            if self.high_signal_only:
                should_emit = self._is_high_signal_record(record)

            if should_emit:
                client.create_run(**run)

            if usage_ready and execution_id:
                summary = self._build_usage_summary(execution_id, context, run["end_time"])
                client.create_run(project_name=self.project, **summary)

            event_name = str(record.get("event_name", ""))
            if self.emit_execution_summary and execution_id and event_name == "ExecutionFinished":
                execution_summary = self._build_execution_summary(execution_id, context, timestamp)
                client.create_run(project_name=self.project, **execution_summary)

    def flush(self) -> None:
        return

    def shutdown(self) -> None:
        return
