from __future__ import annotations

import json
import os
import sys
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from telemetry.config import load_config


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _iso_now() -> datetime:
    return datetime.now(timezone.utc)


def _slug(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


def _resolve_host_scope(repo_root: Path) -> tuple[str, str]:
    host_project = (os.getenv("MCPEE_HOST_PROJECT") or repo_root.name or "unknown-project").strip()
    host_slug = _slug(host_project) or "unknown-project"
    platform_slugs = {"mcp-efficiency-engine", "efficiency", "mcpee"}
    scope = "platform" if host_slug in platform_slugs else "consumer"
    return host_project, scope


def _flatten_kpis(payload: dict[str, Any]) -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, value in payload.items():
        flat[f"kpi_{key}"] = value
    return flat


def _build_telemetry_snapshot(repo_root: Path) -> dict[str, Any]:
    traces_path = repo_root / ".telemetry" / "traces.jsonl"
    metrics_path = repo_root / ".telemetry" / "metrics.jsonl"
    traces = _read_jsonl(traces_path)
    metrics = _read_jsonl(metrics_path)

    execution_ids: set[str] = set()
    operations = Counter()
    sessions = Counter()
    engines = Counter()
    agents = Counter()
    warnings = 0
    errors = 0
    fallback_count = 0
    grounded_count = 0
    routing_count = 0
    durations: list[float] = []
    exporter_failures = Counter()

    for row in traces:
        context = row.get("context", {}) if isinstance(row.get("context"), dict) else {}
        payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
        event_name = str(row.get("event_name", ""))
        level = str(row.get("level", "INFO")).upper()

        execution_id = str(context.get("execution_id", "")).strip()
        if execution_id:
            execution_ids.add(execution_id)

        session_id = str(context.get("session_id", "")).strip()
        if session_id:
            sessions[session_id] += 1

        if level == "WARNING":
            warnings += 1
        if level == "ERROR":
            errors += 1

        if event_name == "ExecutionStarted":
            op = str(payload.get("operation", "")).strip() or "unknown"
            operations[op] += 1

        if event_name == "RoutingResolved":
            routing_count += 1
            engine = str(payload.get("engine", "")).strip() or "unknown"
            agent = str(payload.get("agent", "")).strip() or "unknown"
            engines[engine] += 1
            agents[agent] += 1
            if bool(payload.get("fallback", False)):
                fallback_count += 1
            if bool(payload.get("grounded", False)):
                grounded_count += 1

        if event_name == "SpanFinished":
            try:
                durations.append(float(payload.get("duration_ms") or 0.0))
            except Exception:
                pass

        if event_name == "WarningGenerated" and str(payload.get("warning", "")) == "exporter_failed":
            exporter = str(payload.get("exporter", "unknown")).strip() or "unknown"
            exporter_failures[exporter] += 1

    metric_totals = {
        "tokens_input": 0.0,
        "tokens_output": 0.0,
        "total_tokens": 0.0,
        "estimated_cost": 0.0,
        "efficiency_score_samples": 0,
        "efficiency_score_avg": 0.0,
    }
    efficiency_sum = 0.0
    for row in metrics:
        payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
        if str(row.get("event_name", "")) != "MetricCalculated":
            continue
        name = str(payload.get("name", "")).strip()
        try:
            value = float(payload.get("value") or 0.0)
        except Exception:
            continue

        if name in {"tokens_input", "tokens_output", "total_tokens", "estimated_cost"}:
            metric_totals[name] += value
        elif name == "efficiency_score":
            efficiency_sum += value
            metric_totals["efficiency_score_samples"] += 1

    samples = int(metric_totals["efficiency_score_samples"])
    if samples > 0:
        metric_totals["efficiency_score_avg"] = round(efficiency_sum / samples, 4)

    avg_duration = round(sum(durations) / len(durations), 4) if durations else 0.0
    p95_duration = 0.0
    if durations:
        sorted_d = sorted(durations)
        idx = max(0, min(len(sorted_d) - 1, int(round(0.95 * (len(sorted_d) - 1)))))
        p95_duration = round(sorted_d[idx], 4)

    fallback_rate = round((fallback_count / routing_count), 4) if routing_count else 0.0
    grounded_rate = round((grounded_count / routing_count), 4) if routing_count else 0.0

    return {
        "timestamp": _iso_now().isoformat(),
        "source": {
            "traces": str(traces_path),
            "metrics": str(metrics_path),
        },
        "totals": {
            "trace_records": len(traces),
            "metric_records": len(metrics),
            "executions": len(execution_ids),
            "warnings": warnings,
            "errors": errors,
        },
        "kpis": {
            "routing_fallback_rate": fallback_rate,
            "routing_grounded_rate": grounded_rate,
            "avg_span_duration_ms": avg_duration,
            "p95_span_duration_ms": p95_duration,
            "tokens_input": int(metric_totals["tokens_input"]),
            "tokens_output": int(metric_totals["tokens_output"]),
            "total_tokens": int(metric_totals["total_tokens"]),
            "total_cost_usd": round(float(metric_totals["estimated_cost"]), 6),
            "efficiency_score_avg": metric_totals["efficiency_score_avg"],
        },
        "breakdown": {
            "operation": dict(operations),
            "session": dict(sessions),
            "engine": dict(engines),
            "agent": dict(agents),
            "exporter_failures": dict(exporter_failures),
        },
    }


def _build_chat_usage_snapshot(repo_root: Path) -> dict[str, Any]:
    chat_path = repo_root / "observability" / "evals" / "chat-token-usage-report.json"
    payload = _read_json(chat_path)
    totals = payload.get("totals", {}) if isinstance(payload.get("totals", {}), dict) else {}
    budget = payload.get("budget", {}) if isinstance(payload.get("budget", {}), dict) else {}
    return {
        "timestamp": payload.get("timestamp"),
        "source": str(chat_path),
        "kpis": {
            "input_tokens": int(totals.get("input_tokens", 0) or 0),
            "output_tokens": int(totals.get("output_tokens", 0) or 0),
            "total_tokens": int(totals.get("total_tokens", 0) or 0),
            "copilot_credits": float(totals.get("copilot_credits", 0.0) or 0.0),
            "budget_utilization_rate": float(budget.get("budget_utilization_rate", 0.0) or 0.0),
        },
        "raw": payload,
    }


def _publish_run(
    client: Any,
    *,
    project: str,
    name: str,
    inputs: dict[str, Any],
    outputs: dict[str, Any],
    tags: list[str],
    metadata: dict[str, Any] | None = None,
    total_cost: float | None = None,
    total_tokens: int | None = None,
    run_type: str = "chain",
) -> str:
    now = _iso_now()
    run_id = str(uuid.uuid4())
    payload: dict[str, Any] = {
        "id": run_id,
        "project_name": project,
        "name": name,
        "run_type": run_type,
        "inputs": inputs,
        "outputs": outputs,
        "start_time": now,
        "end_time": now,
        "tags": tags,
        "extra": {"metadata": metadata or {}},
    }

    if total_cost is not None:
        payload["total_cost"] = float(total_cost)
        payload["prompt_cost"] = 0.0
        payload["completion_cost"] = float(total_cost)
    if total_tokens is not None:
        payload["total_tokens"] = int(total_tokens)
        # For LLM-compatible dashboard metrics, expose token fields explicitly.
        payload["prompt_tokens"] = 0
        payload["completion_tokens"] = int(total_tokens)

    usage_metadata: dict[str, Any] = {
        "input_tokens": int(payload.get("prompt_tokens", 0) or 0),
        "output_tokens": int(payload.get("completion_tokens", 0) or 0),
        "total_tokens": int(payload.get("total_tokens", 0) or 0),
        "total_cost": float(payload.get("total_cost", 0.0) or 0.0),
    }

    outputs_kpi = payload.setdefault("outputs", {})
    outputs_kpi["usage_metadata"] = usage_metadata

    meta = payload.setdefault("extra", {}).setdefault("metadata", {})
    meta["usage_metadata"] = usage_metadata

    client.create_run(**payload)
    return run_id


def _publish_feedback_metrics(client: Any, *, run_id: str, metrics: dict[str, Any], source: str) -> None:
    min_score = -99999.9999
    max_score = 99999.9999
    for key, raw_value in metrics.items():
        try:
            value = float(raw_value)
        except Exception:
            continue

        if value < min_score or value > max_score:
            # LangSmith feedback score has bounded range.
            continue

        try:
            client.create_feedback(
                run_id=run_id,
                key=str(key),
                score=value,
                comment=f"mcpee kpi:{source}",
            )
        except Exception:
            # Feedback is optional. Keep publishing resilient.
            continue


def main() -> int:
    repo_root = REPO_ROOT
    cfg = load_config(repo_root)
    host_project, telemetry_scope = _resolve_host_scope(repo_root)
    host_slug = _slug(host_project)

    if not cfg.langsmith.enabled:
        print("LangSmith disabled in effective config. Nothing to publish.")
        return 0

    if not cfg.langsmith.api_key.strip() or not cfg.langsmith.project.strip():
        print("LangSmith config missing api_key or project. Nothing to publish.")
        return 0

    try:
        from langsmith import Client  # type: ignore
    except Exception as exc:
        print(f"langsmith SDK is not available: {exc}")
        return 1

    kwargs: dict[str, Any] = {"api_key": cfg.langsmith.api_key}
    if cfg.langsmith.endpoint:
        kwargs["api_url"] = cfg.langsmith.endpoint
    if cfg.langsmith.workspace_id:
        kwargs["workspace_id"] = cfg.langsmith.workspace_id

    client = Client(**kwargs)

    learning_path = repo_root / "observability" / "evals" / "learning-loop-report.json"
    value_path = repo_root / "observability" / "evals" / "iteration-value-report.json"
    telemetry_snapshot_path = repo_root / "observability" / "evals" / "telemetry-flow-cost-token-report.json"
    chat_snapshot_path = repo_root / "observability" / "evals" / "chat-token-usage-report.json"

    learning = _read_json(learning_path)
    value = _read_json(value_path)
    telemetry_snapshot = _build_telemetry_snapshot(repo_root)
    _write_json(telemetry_snapshot_path, telemetry_snapshot)
    chat_snapshot = _build_chat_usage_snapshot(repo_root)

    project_traceability_path = (
        repo_root
        / "projects"
        / "techriders"
        / "analysis_mcpee"
        / f"telemetry-recovery-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.json"
    )
    unified_snapshot = {
        "timestamp": _iso_now().isoformat(),
        "host_project": host_project,
        "telemetry_scope": telemetry_scope,
        "sources": {
            "learning": str(learning_path),
            "iteration_value": str(value_path),
            "telemetry_snapshot": str(telemetry_snapshot_path),
            "chat_usage": str(chat_snapshot_path),
        },
        "learning": learning,
        "iteration_value": value,
        "telemetry": telemetry_snapshot,
        "chat_usage": chat_snapshot,
    }
    _write_json(project_traceability_path, unified_snapshot)

    published = 0

    if learning:
        learning_kpis = learning.get("kpis", {}) if isinstance(learning.get("kpis", {}), dict) else {}
        learning_flat_kpis = _flatten_kpis(learning_kpis)
        run_id = _publish_run(
            client,
            project=cfg.langsmith.project,
            name="KPI::LearningLoop",
            inputs={
                "source_file": str(learning_path),
                "timestamp": learning.get("timestamp"),
            },
            outputs={
                "kpis": learning_kpis,
                **learning_flat_kpis,
                "health": learning.get("health", {}),
                "totals": {
                    "total_events": learning.get("total_events"),
                    "confirmed_events": learning.get("confirmed_events"),
                    "pending_events": learning.get("pending_events"),
                },
            },
            tags=[
                "mcpee",
                "kpi",
                "learning-loop",
                "dashboard",
                f"scope:{telemetry_scope}",
                f"host:{host_slug}",
            ],
            metadata={
                "kpi_source": "learning-loop",
                "kpi_kind": "snapshot",
                "host_project": host_project,
                "host_project_slug": host_slug,
                "telemetry_scope": telemetry_scope,
                **learning_flat_kpis,
            },
        )
        _publish_feedback_metrics(client, run_id=run_id, metrics=learning_flat_kpis, source="learning-loop")
        published += 1

    if value:
        value_kpis = value.get("kpis", {}) if isinstance(value.get("kpis", {}), dict) else {}
        value_flat_kpis = _flatten_kpis(value_kpis)
        run_id = _publish_run(
            client,
            project=cfg.langsmith.project,
            name="KPI::IterationValue",
            inputs={
                "source_file": str(value_path),
                "timestamp": value.get("timestamp"),
            },
            outputs={
                "kpis": value_kpis,
                **value_flat_kpis,
                "totals": value.get("totals", {}),
                "assessment": value.get("assessment", {}),
            },
            tags=[
                "mcpee",
                "kpi",
                "iteration-value",
                "dashboard",
                f"scope:{telemetry_scope}",
                f"host:{host_slug}",
            ],
            metadata={
                "kpi_source": "iteration-value",
                "kpi_kind": "snapshot",
                "host_project": host_project,
                "host_project_slug": host_slug,
                "telemetry_scope": telemetry_scope,
                **value_flat_kpis,
            },
            total_cost=float(value_kpis.get("total_cost_usd", 0.0) or 0.0),
            total_tokens=int(value_kpis.get("total_tokens", 0) or 0),
            run_type="llm",
        )
        _publish_feedback_metrics(client, run_id=run_id, metrics=value_flat_kpis, source="iteration-value")
        published += 1

    if learning or value:
        learning_kpis = learning.get("kpis", {}) if isinstance(learning.get("kpis", {}), dict) else {}
        value_kpis = value.get("kpis", {}) if isinstance(value.get("kpis", {}), dict) else {}
        learning_flat_kpis = _flatten_kpis(learning_kpis)
        value_flat_kpis = _flatten_kpis(value_kpis)
        run_id = _publish_run(
            client,
            project=cfg.langsmith.project,
            name="KPI::AlignmentSnapshot",
            inputs={
                "source": "local-observability-evals",
                "learning_present": bool(learning),
                "value_present": bool(value),
            },
            outputs={
                "learning_kpis": learning_kpis,
                "value_kpis": value_kpis,
                **{f"learning_{k}": v for k, v in learning_flat_kpis.items()},
                **{f"value_{k}": v for k, v in value_flat_kpis.items()},
                "published_at": _iso_now().isoformat(),
            },
            tags=[
                "mcpee",
                "kpi",
                "alignment",
                "dashboard",
                f"scope:{telemetry_scope}",
                f"host:{host_slug}",
            ],
            metadata={
                "kpi_source": "alignment",
                "kpi_kind": "snapshot",
                "host_project": host_project,
                "host_project_slug": host_slug,
                "telemetry_scope": telemetry_scope,
                **{f"learning_{k}": v for k, v in learning_flat_kpis.items()},
                **{f"value_{k}": v for k, v in value_flat_kpis.items()},
            },
            total_cost=float(value_kpis.get("total_cost_usd", 0.0) or 0.0),
            total_tokens=int(value_kpis.get("total_tokens", 0) or 0),
            run_type="llm",
        )
        alignment_feedback = {
            **{f"learning_{k}": v for k, v in learning_flat_kpis.items()},
            **{f"value_{k}": v for k, v in value_flat_kpis.items()},
        }
        _publish_feedback_metrics(client, run_id=run_id, metrics=alignment_feedback, source="alignment")
        published += 1

    telemetry_kpis = telemetry_snapshot.get("kpis", {}) if isinstance(telemetry_snapshot.get("kpis", {}), dict) else {}
    if telemetry_kpis:
        telemetry_flat_kpis = _flatten_kpis(telemetry_kpis)
        run_id = _publish_run(
            client,
            project=cfg.langsmith.project,
            name="KPI::TelemetryFlowCostToken",
            inputs={
                "source_file": str(telemetry_snapshot_path),
                "timestamp": telemetry_snapshot.get("timestamp"),
            },
            outputs={
                "kpis": telemetry_kpis,
                **telemetry_flat_kpis,
                "totals": telemetry_snapshot.get("totals", {}),
                "breakdown": telemetry_snapshot.get("breakdown", {}),
            },
            tags=[
                "mcpee",
                "kpi",
                "telemetry",
                "cost-token-flow",
                "dashboard",
                f"scope:{telemetry_scope}",
                f"host:{host_slug}",
            ],
            metadata={
                "kpi_source": "telemetry-flow-cost-token",
                "kpi_kind": "snapshot",
                "host_project": host_project,
                "host_project_slug": host_slug,
                "telemetry_scope": telemetry_scope,
                **telemetry_flat_kpis,
            },
            total_cost=float(telemetry_kpis.get("total_cost_usd", 0.0) or 0.0),
            total_tokens=int(telemetry_kpis.get("total_tokens", 0) or 0),
            run_type="llm",
        )
        _publish_feedback_metrics(client, run_id=run_id, metrics=telemetry_flat_kpis, source="telemetry-flow-cost-token")
        published += 1

    chat_kpis = chat_snapshot.get("kpis", {}) if isinstance(chat_snapshot.get("kpis", {}), dict) else {}
    if chat_kpis:
        chat_flat_kpis = _flatten_kpis(chat_kpis)
        run_id = _publish_run(
            client,
            project=cfg.langsmith.project,
            name="KPI::ChatTokenUsage",
            inputs={
                "source_file": str(chat_snapshot_path),
                "timestamp": chat_snapshot.get("timestamp"),
            },
            outputs={
                "kpis": chat_kpis,
                **chat_flat_kpis,
                "budget": (chat_snapshot.get("raw", {}) or {}).get("budget", {}),
            },
            tags=[
                "mcpee",
                "kpi",
                "chat-usage",
                "cost-token-flow",
                "dashboard",
                f"scope:{telemetry_scope}",
                f"host:{host_slug}",
            ],
            metadata={
                "kpi_source": "chat-token-usage",
                "kpi_kind": "snapshot",
                "host_project": host_project,
                "host_project_slug": host_slug,
                "telemetry_scope": telemetry_scope,
                **chat_flat_kpis,
            },
            total_tokens=int(chat_kpis.get("total_tokens", 0) or 0),
            run_type="llm",
        )
        _publish_feedback_metrics(client, run_id=run_id, metrics=chat_flat_kpis, source="chat-token-usage")
        published += 1

    print(
        f"Published KPI runs: {published} to project '{cfg.langsmith.project}' "
        f"(host_project='{host_project}', scope='{telemetry_scope}')."
    )
    print(f"Local telemetry snapshot: {telemetry_snapshot_path}")
    print(f"Project traceability snapshot: {project_traceability_path}")
    if published == 0:
        print("No local KPI report JSON files were found in observability/evals.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
