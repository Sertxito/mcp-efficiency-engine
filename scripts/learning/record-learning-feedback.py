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
    parser = argparse.ArgumentParser(description="Record real execution feedback for a routing event.")
    parser.add_argument("--event-id", default="", help="Routing event_id to confirm. If omitted, uses latest event with event_id.")
    parser.add_argument("--success", required=True, choices=["true", "false"], help="Real execution outcome.")
    parser.add_argument("--confidence", type=float, default=0.9, help="Confidence in the feedback (0..1).")
    parser.add_argument("--source", default="human", help="Feedback source: human|ci|runtime|other")
    parser.add_argument("--notes", default="", help="Optional notes")
    parser.add_argument("--routing-log", default="observability/logs/routing-decisions.jsonl")
    parser.add_argument("--output", default="observability/logs/learning-feedback.jsonl")
    args = parser.parse_args()

    if args.confidence < 0 or args.confidence > 1:
        print("confidence must be between 0 and 1")
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

    feedback = {
        "timestamp": utc_now(),
        "event_id": event_id,
        "learning": {
            "success": True if args.success == "true" else False,
            "outcome_status": "confirmed",
            "confidence": round(float(args.confidence), 3),
            "feedback_source": args.source,
            "notes": args.notes,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(feedback, ensure_ascii=False) + "\n")

    print(f"Feedback recorded for event_id: {event_id}")
    print(f"Output: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
