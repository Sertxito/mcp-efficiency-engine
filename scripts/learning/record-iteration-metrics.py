from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def latest_event_id(events: list[dict[str, Any]]) -> str | None:
    for e in reversed(events):
        event_id = str(e.get("event_id", "")).strip()
        if event_id:
            return event_id
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Record per-iteration cost and execution metrics for a routing event.")
    parser.add_argument("--event-id", default="", help="Routing event_id. If omitted, uses latest routing event with event_id.")
    parser.add_argument("--model", required=True, help="Model used in the iteration, e.g. GPT-5.3-Codex")
    parser.add_argument("--input-tokens", type=int, required=True)
    parser.add_argument("--output-tokens", type=int, required=True)
    parser.add_argument("--local-tools", type=int, default=0, help="Count of local tools used")
    parser.add_argument("--remote-tools", type=int, default=0, help="Count of remote/cloud tools used")
    parser.add_argument("--estimated-cost-usd", type=float, default=0.0)
    parser.add_argument("--notes", default="")
    parser.add_argument("--routing-log", default="observability/logs/routing-decisions.jsonl")
    parser.add_argument("--output", default="observability/logs/iteration-metrics.jsonl")
    args = parser.parse_args()

    if args.input_tokens < 0 or args.output_tokens < 0:
        print("input/output tokens must be >= 0")
        return 1
    if args.local_tools < 0 or args.remote_tools < 0:
        print("tool counters must be >= 0")
        return 1
    if args.estimated_cost_usd < 0:
        print("estimated-cost-usd must be >= 0")
        return 1

    repo_root = Path(__file__).resolve().parents[2]
    routing_log = (repo_root / args.routing_log).resolve()
    output_path = (repo_root / args.output).resolve()

    events = parse_jsonl(routing_log)
    event_id = args.event_id.strip() or (latest_event_id(events) or "")
    if not event_id:
        print("No event_id provided and no eligible routing events found.")
        return 1

    exists = any(str(e.get("event_id", "")).strip() == event_id for e in events)
    if not exists:
        print(f"event_id not found in routing log: {event_id}")
        return 1

    total_tokens = args.input_tokens + args.output_tokens
    if args.local_tools > 0 and args.remote_tools == 0:
        tool_mode = "local-only"
    elif args.local_tools == 0 and args.remote_tools > 0:
        tool_mode = "remote-only"
    elif args.local_tools > 0 and args.remote_tools > 0:
        tool_mode = "hybrid"
    else:
        tool_mode = "model-only"

    metric = {
        "timestamp": utc_now(),
        "event_id": event_id,
        "model": args.model,
        "cost": {
            "input_tokens": args.input_tokens,
            "output_tokens": args.output_tokens,
            "total_tokens": total_tokens,
            "estimated_cost_usd": round(float(args.estimated_cost_usd), 6),
        },
        "execution": {
            "local_tools": args.local_tools,
            "remote_tools": args.remote_tools,
            "tool_mode": tool_mode,
        },
        "notes": args.notes,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(metric, ensure_ascii=False) + "\n")

    print(f"Iteration metrics recorded for event_id: {event_id}")
    print(f"Output: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
