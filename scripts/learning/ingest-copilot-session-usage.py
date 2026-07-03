from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_timestamp(raw: Any) -> str:
    if raw is None:
        return utc_now()

    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(float(raw) / 1000.0, tz=timezone.utc).isoformat()
        except Exception:
            return utc_now()

    text = str(raw).strip()
    if not text:
        return utc_now()

    if text.isdigit():
        try:
            return datetime.fromtimestamp(float(text) / 1000.0, tz=timezone.utc).isoformat()
        except Exception:
            return utc_now()

    return text


def parse_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def normalize_model(raw: Any) -> str:
    model = str(raw or "").strip()
    return model or "unknown"


def read_seen_ids(metrics_rows: list[dict[str, Any]]) -> set[str]:
    seen: set[str] = set()
    for row in metrics_rows:
        usage = row.get("usage", {}) if isinstance(row.get("usage", {}), dict) else {}
        source = str(usage.get("source", "")).strip()
        source_event_id = str(usage.get("source_event_id", "")).strip()
        if source == "copilot-session" and source_event_id:
            seen.add(source_event_id)
    return seen


def index_existing_by_source_id(metrics_rows: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for i, row in enumerate(metrics_rows):
        usage = row.get("usage", {}) if isinstance(row.get("usage", {}), dict) else {}
        source = str(usage.get("source", "")).strip()
        source_event_id = str(usage.get("source_event_id", "")).strip()
        if source == "copilot-session" and source_event_id:
            out[source_event_id] = i
    return out


def extract_usage_event_from_debug_row(row: dict[str, Any]) -> dict[str, Any] | None:
    source_event_id = str(row.get("id") or row.get("event_id") or row.get("spanId") or "").strip()
    if not source_event_id:
        return None

    data_candidates: list[dict[str, Any]] = []
    for key in ("usage", "tokenUsage", "cost", "attrs"):
        value = row.get(key)
        if isinstance(value, dict):
            data_candidates.append(value)

    # Some event payloads keep nested data in a generic "data" envelope.
    data = row.get("data")
    if isinstance(data, dict):
        for key in ("usage", "tokenUsage", "cost", "attrs"):
            value = data.get(key)
            if isinstance(value, dict):
                data_candidates.append(value)

    input_tokens = None
    output_tokens = None
    estimated_cost = 0.0

    for bucket in data_candidates:
        if input_tokens is None:
            for key in ("input_tokens", "prompt_tokens", "inputTokens", "promptTokens"):
                if key in bucket:
                    try:
                        input_tokens = int(bucket.get(key, 0) or 0)
                    except Exception:
                        input_tokens = None
                    break
        if output_tokens is None:
            for key in ("output_tokens", "completion_tokens", "outputTokens", "completionTokens"):
                if key in bucket:
                    try:
                        output_tokens = int(bucket.get(key, 0) or 0)
                    except Exception:
                        output_tokens = None
                    break
        if "estimated_cost_usd" in bucket:
            try:
                estimated_cost = float(bucket.get("estimated_cost_usd", 0.0) or 0.0)
            except Exception:
                estimated_cost = 0.0

    if input_tokens is None or output_tokens is None:
        return None

    if input_tokens < 0 or output_tokens < 0:
        return None

    model = normalize_model(row.get("model") or row.get("modelId") or row.get("name"))
    ts = normalize_timestamp(row.get("timestamp") or row.get("ts"))

    return {
        "source_event_id": source_event_id,
        "timestamp": ts,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost_usd": round(estimated_cost, 6),
    }


def parse_chat_sessions_usage(chat_session_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # chatSessions JSONL is a state patch stream with records like:
    # {"kind":2,"k":["requests"],"v":[{"requestId":"..."}]}
    # {"kind":1,"k":["requests",N,"promptTokens"],"v":123}
    # {"kind":1,"k":["requests",N,"completionTokens"],"v":45}
    request_ids: list[str] = []
    request_models: dict[int, str] = {}
    prompt_tokens: dict[int, int] = {}
    completion_tokens: dict[int, int] = {}
    copilot_credits: dict[int, float] = {}
    request_timestamps: dict[int, str] = {}

    for row in chat_session_rows:
        kind = row.get("kind")
        key_path = row.get("k")
        value = row.get("v")

        if kind == 2 and key_path == ["requests"] and isinstance(value, list):
            for item in value:
                if not isinstance(item, dict):
                    continue
                request_id = str(item.get("requestId", "")).strip()
                if not request_id:
                    continue
                request_index = len(request_ids)
                request_ids.append(request_id)
                request_timestamps[request_index] = normalize_timestamp(item.get("timestamp") or row.get("timestamp"))
                request_models[request_index] = normalize_model(item.get("model") or item.get("modelId"))
            continue

        if kind != 1 or not isinstance(key_path, list) or len(key_path) < 3:
            continue

        if key_path[0] != "requests" or not isinstance(key_path[1], int):
            continue

        idx = int(key_path[1])
        field = str(key_path[2])
        if field == "promptTokens":
            try:
                prompt_tokens[idx] = int(value or 0)
            except Exception:
                pass
        elif field == "completionTokens":
            try:
                completion_tokens[idx] = int(value or 0)
            except Exception:
                pass
        elif field == "copilotCredits":
            try:
                copilot_credits[idx] = float(value or 0.0)
            except Exception:
                pass

    usage_events: list[dict[str, Any]] = []
    for idx, request_id in enumerate(request_ids):
        in_tok = int(prompt_tokens.get(idx, -1))
        out_tok = int(completion_tokens.get(idx, -1))
        if in_tok < 0 or out_tok < 0:
            continue

        usage_events.append(
            {
                "source_event_id": request_id,
                "timestamp": request_timestamps.get(idx, utc_now()),
                "model": request_models.get(idx, "copilot/auto"),
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                "estimated_cost_usd": 0.0,
                "copilot_credits": round(float(copilot_credits.get(idx, 0.0)), 6),
            }
        )

    return usage_events


def derive_chat_sessions_path_from_session_path(session_path: Path) -> Path | None:
    # Expected debug path pattern:
    # .../workspaceStorage/<wsid>/GitHub.copilot-chat/debug-logs/<sid>/main.jsonl
    parts = list(session_path.parts)
    try:
        i = parts.index("workspaceStorage")
    except ValueError:
        return None

    if i + 1 >= len(parts):
        return None

    workspace_root = Path(*parts[: i + 2])
    match = re.search(r"debug-logs[\\/](?P<sid>[0-9a-fA-F-]{36})", str(session_path))
    if not match:
        return None

    sid = match.group("sid")
    candidate = workspace_root / "chatSessions" / f"{sid}.jsonl"
    if candidate.exists():
        return candidate
    return None


def build_metric(event_id: str, usage_event: dict[str, Any]) -> dict[str, Any]:
    input_tokens = int(usage_event["input_tokens"])
    output_tokens = int(usage_event["output_tokens"])
    return {
        "timestamp": str(usage_event["timestamp"]),
        "event_id": event_id,
        "model": str(usage_event["model"]),
        "cost": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "estimated_cost_usd": float(usage_event["estimated_cost_usd"]),
            "copilot_credits": round(float(usage_event.get("copilot_credits", 0.0) or 0.0), 6),
        },
        "execution": {
            "local_tools": 0,
            "remote_tools": 0,
            "tool_mode": "model-only",
        },
        "usage": {
            "source": "copilot-session",
            "source_event_id": str(usage_event["source_event_id"]),
        },
        "notes": "auto-ingested from VS Code Copilot session log",
    }


def append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest token usage from VS Code Copilot debug session logs into iteration metrics (best effort)."
    )
    parser.add_argument("--session-log", default="", help="Absolute path to debug log path (file or directory)")
    parser.add_argument("--chat-session-log", default="", help="Absolute path to workspaceStorage/chatSessions/<sid>.jsonl")
    parser.add_argument("--metrics-log", default="observability/logs/iteration-metrics.jsonl")
    parser.add_argument("--report", default="observability/logs/copilot-usage-ingest-report.json")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]

    session_log = args.session_log.strip()
    if not session_log:
        session_log = os.environ.get("VSCODE_TARGET_SESSION_LOG", "").strip()

    if not session_log:
        print("No session log provided. Use --session-log or set VSCODE_TARGET_SESSION_LOG.")
        return 1

    session_path = Path(session_log).resolve()
    if session_path.is_dir():
        # In this environment the variable can point to a folder; prefer main.jsonl.
        candidate = session_path / "main.jsonl"
        if candidate.exists():
            session_path = candidate
        else:
            print(f"Session log directory does not contain main.jsonl: {session_path}")
            return 1

    if not session_path.exists():
        print(f"Session log not found: {session_path}")
        return 1

    metrics_path = (repo_root / args.metrics_log).resolve()
    report_path = (repo_root / args.report).resolve()

    debug_rows = parse_jsonl(session_path)

    chat_session_log = args.chat_session_log.strip()
    if chat_session_log:
        chat_session_path = Path(chat_session_log).resolve()
    else:
        chat_session_path = derive_chat_sessions_path_from_session_path(session_path)

    chat_rows: list[dict[str, Any]] = []
    if chat_session_path is not None and chat_session_path.exists():
        chat_rows = parse_jsonl(chat_session_path)

    metrics_rows = parse_jsonl(metrics_path)
    seen_source_ids = read_seen_ids(metrics_rows)
    existing_by_source_id = index_existing_by_source_id(metrics_rows)

    to_append: list[dict[str, Any]] = []
    scanned = 0
    usage_found = 0
    skipped_duplicates = 0
    updated_existing = 0

    # Prefer chatSessions since it contains per-request prompt/completion tokens.
    for usage_event in parse_chat_sessions_usage(chat_rows):
        scanned += 1
        usage_found += 1

        source_event_id = str(usage_event["source_event_id"])
        if source_event_id in seen_source_ids:
            skipped_duplicates += 1
            existing_idx = existing_by_source_id.get(source_event_id)
            if existing_idx is not None:
                existing_row = metrics_rows[existing_idx]
                cost = existing_row.get("cost", {}) if isinstance(existing_row.get("cost", {}), dict) else {}
                existing_credits = float(cost.get("copilot_credits", 0.0) or 0.0)
                incoming_credits = float(usage_event.get("copilot_credits", 0.0) or 0.0)
                if incoming_credits > existing_credits:
                    cost["copilot_credits"] = round(incoming_credits, 6)
                    existing_row["cost"] = cost
                    updated_existing += 1
            continue

        synthetic_event_id = f"copilot-session::{source_event_id}"
        to_append.append(build_metric(synthetic_event_id, usage_event))
        seen_source_ids.add(source_event_id)

    # Fallback to debug logs when chatSessions does not expose usage fields.
    for row in debug_rows:
        scanned += 1
        usage_event = extract_usage_event_from_debug_row(row)
        if usage_event is None:
            continue
        usage_found += 1

        source_event_id = str(usage_event["source_event_id"])
        if source_event_id in seen_source_ids:
            skipped_duplicates += 1
            continue

        synthetic_event_id = f"copilot-session::{source_event_id}"
        to_append.append(build_metric(synthetic_event_id, usage_event))
        seen_source_ids.add(source_event_id)

    append_jsonl(metrics_path, to_append)
    if updated_existing > 0:
        if to_append:
            metrics_rows.extend(to_append)
        metrics_path.parent.mkdir(parents=True, exist_ok=True)
        with metrics_path.open("w", encoding="utf-8") as fh:
            for row in metrics_rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    status = "no-usage-fields-found"
    if usage_found > 0 and len(to_append) > 0:
        status = "ok"
    elif usage_found > 0 and len(to_append) == 0:
        status = "duplicates-only"

    report = {
        "timestamp": utc_now(),
        "session_log": str(session_path),
        "chat_session_log": str(chat_session_path) if chat_session_path is not None else "",
        "metrics_log": args.metrics_log.replace("\\", "/"),
        "scanned_events": scanned,
        "usage_events_detected": usage_found,
        "inserted": len(to_append),
        "updated_existing": updated_existing,
        "skipped_duplicates": skipped_duplicates,
        "status": status,
        "note": "If status=no-usage-fields-found, this VS Code debug log currently does not expose per-turn token usage in a parseable shape.",
    }

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
