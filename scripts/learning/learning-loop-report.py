from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pct(n: float) -> float:
    return round(n * 100.0, 2)


def safe_rate(num: int, den: int) -> float:
    if den <= 0:
        return 0.0
    return num / den


def parse_events(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if isinstance(obj, dict):
            events.append(obj)
    return events


def parse_feedback(path: Path) -> dict[str, dict[str, Any]]:
    latest_by_event: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return latest_by_event

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        event_id = str(obj.get("event_id", "")).strip()
        if not event_id:
            continue
        latest_by_event[event_id] = obj
    return latest_by_event


def build_report(
    events: list[dict[str, Any]], source_path: str, feedback_by_event: dict[str, dict[str, Any]], feedback_source: str
) -> dict[str, Any]:
    total = len(events)
    fallback_count = 0
    grounded_count = 0
    confirmed_count = 0
    success_count = 0
    pending_count = 0
    confidence_sum = 0.0
    confidence_count = 0

    by_pattern: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "total": 0,
            "fallback": 0,
            "grounded": 0,
            "success": 0,
            "pending": 0,
            "confirmed": 0,
            "confidence_sum": 0.0,
            "confidence_count": 0,
            "engines": defaultdict(int),
            "agents": defaultdict(int),
        }
    )

    for e in events:
        fb = bool(e.get("fallback", False))
        gr = bool(e.get("grounded", False))
        learning = e.get("learning", {}) if isinstance(e.get("learning", {}), dict) else {}
        event_id = str(e.get("event_id", "")).strip()

        feedback_obj = feedback_by_event.get(event_id, {}) if event_id else {}
        feedback_learning = feedback_obj.get("learning", {}) if isinstance(feedback_obj.get("learning", {}), dict) else {}

        # Source of truth: confirmed feedback overrides provisional learning state.
        if feedback_learning:
            success_raw = feedback_learning.get("success")
            outcome_status = str(feedback_learning.get("outcome_status", "confirmed"))
            confidence = feedback_learning.get("confidence")
        else:
            success_raw = learning.get("success")
            outcome_status = str(learning.get("outcome_status", "pending"))
            confidence = learning.get("confidence")

        is_confirmed = outcome_status == "confirmed" and isinstance(success_raw, bool)
        is_pending = not is_confirmed
        success = bool(success_raw) if is_confirmed else False

        pattern = str(learning.get("used_pattern", "unknown"))
        engine = str(e.get("engine", "unknown"))
        agent = str(e.get("agent", "unknown"))

        fallback_count += 1 if fb else 0
        grounded_count += 1 if gr else 0
        pending_count += 1 if is_pending else 0
        confirmed_count += 1 if is_confirmed else 0
        success_count += 1 if (is_confirmed and success) else 0

        if is_confirmed and isinstance(confidence, (int, float)):
            confidence_sum += float(confidence)
            confidence_count += 1

        p = by_pattern[pattern]
        p["total"] += 1
        p["fallback"] += 1 if fb else 0
        p["grounded"] += 1 if gr else 0
        p["pending"] += 1 if is_pending else 0
        p["confirmed"] += 1 if is_confirmed else 0
        p["success"] += 1 if (is_confirmed and success) else 0
        if is_confirmed and isinstance(confidence, (int, float)):
            p["confidence_sum"] += float(confidence)
            p["confidence_count"] += 1
        p["engines"][engine] += 1
        p["agents"][agent] += 1

    patterns_out: list[dict[str, Any]] = []
    for pattern, data in sorted(by_pattern.items(), key=lambda kv: kv[0]):
        den = int(data["total"])
        c_count = int(data["confidence_count"])
        c_avg = round((float(data["confidence_sum"]) / c_count), 3) if c_count else 0.0
        patterns_out.append(
            {
                "pattern": pattern,
                "total": den,
                "fallback_rate": round(safe_rate(int(data["fallback"]), den), 4),
                "grounded_rate": round(safe_rate(int(data["grounded"]), den), 4),
                "pending_count": int(data["pending"]),
                "confirmed_count": int(data["confirmed"]),
                "success_rate": round(safe_rate(int(data["success"]), int(data["confirmed"])), 4),
                "confidence_avg": c_avg,
                "engines": dict(sorted(data["engines"].items())),
                "agents": dict(sorted(data["agents"].items())),
            }
        )

    global_confidence_avg = round((confidence_sum / confidence_count), 3) if confidence_count else 0.0
    report = {
        "timestamp": utc_now(),
        "source": source_path,
        "feedback_source": feedback_source,
        "total_events": total,
        "pending_events": pending_count,
        "confirmed_events": confirmed_count,
        "kpis": {
            "fallback_rate": round(safe_rate(fallback_count, total), 4),
            "grounded_rate": round(safe_rate(grounded_count, total), 4),
            "success_rate": round(safe_rate(success_count, confirmed_count), 4),
            "confidence_avg": global_confidence_avg,
        },
        "thresholds": {
            "fallback_rate_max": 0.20,
            "grounded_rate_min": 0.80,
            "confidence_avg_min": 0.80,
        },
        "health": {
            "fallback_ok": round(safe_rate(fallback_count, total), 4) <= 0.20,
            "grounded_ok": round(safe_rate(grounded_count, total), 4) >= 0.80,
            "confidence_ok": global_confidence_avg >= 0.80,
        },
        "patterns": patterns_out,
    }
    return report


def report_to_markdown(report: dict[str, Any]) -> str:
    total = int(report.get("total_events", 0))
    pending = int(report.get("pending_events", 0))
    confirmed = int(report.get("confirmed_events", 0))
    kpis = report.get("kpis", {}) if isinstance(report.get("kpis", {}), dict) else {}
    health = report.get("health", {}) if isinstance(report.get("health", {}), dict) else {}
    patterns = report.get("patterns", []) if isinstance(report.get("patterns", []), list) else []

    lines = [
        "# Learning Loop Report",
        "",
        f"- timestamp: {report.get('timestamp', '')}",
        f"- total_events: {total}",
        f"- pending_events: {pending}",
        f"- confirmed_events: {confirmed}",
        "",
        "## Global KPIs",
        "",
        f"- fallback_rate: {pct(float(kpis.get('fallback_rate', 0.0)))}%",
        f"- grounded_rate: {pct(float(kpis.get('grounded_rate', 0.0)))}%",
        f"- success_rate: {pct(float(kpis.get('success_rate', 0.0)))}%",
        f"- confidence_avg: {kpis.get('confidence_avg', 0.0)}",
        "",
        "## Health",
        "",
        f"- fallback_ok: {health.get('fallback_ok', False)}",
        f"- grounded_ok: {health.get('grounded_ok', False)}",
        f"- confidence_ok: {health.get('confidence_ok', False)}",
        "",
        "## Patterns",
        "",
    ]

    if not patterns:
        lines.append("- none")
    else:
        for p in patterns:
            lines.append(
                f"- {p.get('pattern', 'unknown')}: total={p.get('total', 0)}, "
                f"pending={p.get('pending_count', 0)}, "
                f"confirmed={p.get('confirmed_count', 0)}, "
                f"fallback={pct(float(p.get('fallback_rate', 0.0)))}%, "
                f"grounded={pct(float(p.get('grounded_rate', 0.0)))}%, "
                f"confidence={p.get('confidence_avg', 0.0)}"
            )

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build learning loop report from routing decisions log.")
    parser.add_argument("--input", default="observability/logs/routing-decisions.jsonl")
    parser.add_argument("--feedback", default="observability/logs/learning-feedback.jsonl")
    parser.add_argument("--out-json", default="observability/evals/learning-loop-report.json")
    parser.add_argument("--out-md", default="observability/evals/learning-loop-report.md")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    in_path = (repo_root / args.input).resolve()
    feedback_path = (repo_root / args.feedback).resolve()
    out_json = (repo_root / args.out_json).resolve()
    out_md = (repo_root / args.out_md).resolve()

    events = parse_events(in_path)
    feedback = parse_feedback(feedback_path)
    report = build_report(events, str(in_path), feedback, str(feedback_path))

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_md.parent.mkdir(parents=True, exist_ok=True)

    out_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out_md.write_text(report_to_markdown(report), encoding="utf-8")

    print(f"Learning events processed: {len(events)}")
    print(f"Report JSON: {out_json}")
    print(f"Report MD: {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
