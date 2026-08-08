from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def parse_jsonl(path: Path) -> list[dict[str, Any]]:
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


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def is_eval_feedback(row: dict[str, Any]) -> bool:
    learning = row.get("learning", {}) if isinstance(row.get("learning", {}), dict) else {}
    source = str(learning.get("feedback_source", "")).strip().lower()
    notes = str(learning.get("notes", "")).strip().lower()
    return source == "ci" and notes.startswith("routing-eval-pass:")


def backup_file(path: Path) -> Path | None:
    if not path.exists():
        return None
    backup_path = path.with_suffix(path.suffix + f".bak.{utc_stamp()}")
    backup_path.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    return backup_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove synthetic routing-eval noise from operational observability logs.")
    parser.add_argument("--routing-log", default="observability/logs/routing-decisions.jsonl")
    parser.add_argument("--feedback-log", default="observability/logs/learning-feedback.jsonl")
    parser.add_argument("--metrics-log", default="observability/logs/iteration-metrics.jsonl")
    parser.add_argument("--no-backup", action="store_true", help="Do not create .bak backup files before rewriting logs.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    routing_path = (repo_root / args.routing_log).resolve()
    feedback_path = (repo_root / args.feedback_log).resolve()
    metrics_path = (repo_root / args.metrics_log).resolve()

    feedback_rows = parse_jsonl(feedback_path)
    eval_event_ids = {
        str(row.get("event_id", "")).strip()
        for row in feedback_rows
        if is_eval_feedback(row)
    }
    eval_event_ids.discard("")

    if not eval_event_ids:
        print("No routing-eval synthetic events found in feedback log. Nothing to prune.")
        return 0

    routing_rows = parse_jsonl(routing_path)
    metrics_rows = parse_jsonl(metrics_path)

    kept_feedback = [row for row in feedback_rows if str(row.get("event_id", "")).strip() not in eval_event_ids]
    kept_routing = [row for row in routing_rows if str(row.get("event_id", "")).strip() not in eval_event_ids]
    kept_metrics = [row for row in metrics_rows if str(row.get("event_id", "")).strip() not in eval_event_ids]

    if not args.no_backup:
        routing_backup = backup_file(routing_path)
        feedback_backup = backup_file(feedback_path)
        metrics_backup = backup_file(metrics_path)
        if routing_backup:
            print(f"Backup created: {routing_backup}")
        if feedback_backup:
            print(f"Backup created: {feedback_backup}")
        if metrics_backup:
            print(f"Backup created: {metrics_backup}")

    write_jsonl(routing_path, kept_routing)
    write_jsonl(feedback_path, kept_feedback)
    write_jsonl(metrics_path, kept_metrics)

    print(f"Pruned event_ids: {len(eval_event_ids)}")
    print(f"Routing rows: {len(routing_rows)} -> {len(kept_routing)}")
    print(f"Feedback rows: {len(feedback_rows)} -> {len(kept_feedback)}")
    print(f"Metrics rows: {len(metrics_rows)} -> {len(kept_metrics)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
