from __future__ import annotations

import json
import os
import sys
import uuid
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
    for key, raw_value in metrics.items():
        try:
            value = float(raw_value)
        except Exception:
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

    learning = _read_json(learning_path)
    value = _read_json(value_path)

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

    print(
        f"Published KPI runs: {published} to project '{cfg.langsmith.project}' "
        f"(host_project='{host_project}', scope='{telemetry_scope}')."
    )
    if published == 0:
        print("No local KPI report JSON files were found in observability/evals.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
