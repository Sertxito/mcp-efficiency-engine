from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_rate(num: int, den: int) -> float:
    if den <= 0:
        return 0.0
    return num / den


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


def latest_by_event(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        event_id = str(row.get("event_id", "")).strip()
        if not event_id:
            continue
        out[event_id] = row
    return out


def build_report(
    events: list[dict[str, Any]],
    feedback_map: dict[str, dict[str, Any]],
    metrics_map: dict[str, dict[str, Any]],
    sources: dict[str, str],
) -> dict[str, Any]:
    total = len(events)
    with_event_id = 0
    metrics_covered = 0
    confirmed = 0
    confirmed_success = 0

    total_tokens = 0
    total_cost_usd = 0.0

    by_mode = defaultdict(lambda: {"count": 0, "tokens": 0, "cost_usd": 0.0})
    by_model = defaultdict(lambda: {"count": 0, "tokens": 0, "cost_usd": 0.0})
    by_engine = defaultdict(lambda: {"count": 0, "tokens": 0, "cost_usd": 0.0})

    for event in events:
        event_id = str(event.get("event_id", "")).strip()
        if not event_id:
            continue
        with_event_id += 1

        fb = feedback_map.get(event_id, {})
        fb_learning = fb.get("learning", {}) if isinstance(fb.get("learning", {}), dict) else {}
        if str(fb_learning.get("outcome_status", "")) == "confirmed" and isinstance(fb_learning.get("success"), bool):
            confirmed += 1
            if bool(fb_learning.get("success")):
                confirmed_success += 1

        metric = metrics_map.get(event_id)
        if not metric:
            continue
        metrics_covered += 1

        cost = metric.get("cost", {}) if isinstance(metric.get("cost", {}), dict) else {}
        exec_data = metric.get("execution", {}) if isinstance(metric.get("execution", {}), dict) else {}

        tokens = int(cost.get("total_tokens", 0) or 0)
        cost_usd = float(cost.get("estimated_cost_usd", 0.0) or 0.0)
        mode = str(exec_data.get("tool_mode", "unknown"))
        model = str(metric.get("model", "unknown"))
        engine = str(event.get("engine", "unknown"))

        total_tokens += tokens
        total_cost_usd += cost_usd

        by_mode[mode]["count"] += 1
        by_mode[mode]["tokens"] += tokens
        by_mode[mode]["cost_usd"] += cost_usd

        by_model[model]["count"] += 1
        by_model[model]["tokens"] += tokens
        by_model[model]["cost_usd"] += cost_usd

        by_engine[engine]["count"] += 1
        by_engine[engine]["tokens"] += tokens
        by_engine[engine]["cost_usd"] += cost_usd

    tokens_per_confirmed_success = 0.0
    cost_per_confirmed_success = 0.0
    if confirmed_success > 0:
        tokens_per_confirmed_success = round(total_tokens / confirmed_success, 2)
        cost_per_confirmed_success = round(total_cost_usd / confirmed_success, 6)

    report = {
        "timestamp": utc_now(),
        "sources": sources,
        "totals": {
            "events": total,
            "events_with_event_id": with_event_id,
            "metrics_covered": metrics_covered,
            "feedback_confirmed": confirmed,
            "confirmed_success": confirmed_success,
        },
        "kpis": {
            "metrics_coverage_rate": round(safe_rate(metrics_covered, with_event_id), 4),
            "confirmed_feedback_rate": round(safe_rate(confirmed, with_event_id), 4),
            "confirmed_success_rate": round(safe_rate(confirmed_success, confirmed), 4),
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost_usd, 6),
            "tokens_per_confirmed_success": tokens_per_confirmed_success,
            "cost_per_confirmed_success_usd": cost_per_confirmed_success,
        },
        "breakdown": {
            "tool_mode": dict(sorted(by_mode.items())),
            "model": dict(sorted(by_model.items())),
            "engine": dict(sorted(by_engine.items())),
        },
        "assessment": {
            "has_value_signal": confirmed_success > 0 and metrics_covered > 0,
            "notes": (
                "Insufficient confirmed outcomes or metrics coverage."
                if not (confirmed_success > 0 and metrics_covered > 0)
                else "Value signal available. Track trend, not one-point absolute values."
            ),
        },
    }
    return report


def to_markdown(report: dict[str, Any]) -> str:
    totals = report.get("totals", {}) if isinstance(report.get("totals", {}), dict) else {}
    kpis = report.get("kpis", {}) if isinstance(report.get("kpis", {}), dict) else {}
    breakdown = report.get("breakdown", {}) if isinstance(report.get("breakdown", {}), dict) else {}
    assessment = report.get("assessment", {}) if isinstance(report.get("assessment", {}), dict) else {}

    lines = [
        "# Iteration Value Report",
        "",
        f"- timestamp: {report.get('timestamp', '')}",
        f"- events: {totals.get('events', 0)}",
        f"- events_with_event_id: {totals.get('events_with_event_id', 0)}",
        f"- metrics_covered: {totals.get('metrics_covered', 0)}",
        f"- feedback_confirmed: {totals.get('feedback_confirmed', 0)}",
        f"- confirmed_success: {totals.get('confirmed_success', 0)}",
        "",
        "## KPI",
        "",
        f"- metrics_coverage_rate: {round(float(kpis.get('metrics_coverage_rate', 0.0)) * 100, 2)}%",
        f"- confirmed_feedback_rate: {round(float(kpis.get('confirmed_feedback_rate', 0.0)) * 100, 2)}%",
        f"- confirmed_success_rate: {round(float(kpis.get('confirmed_success_rate', 0.0)) * 100, 2)}%",
        f"- total_tokens: {kpis.get('total_tokens', 0)}",
        f"- total_cost_usd: {kpis.get('total_cost_usd', 0.0)}",
        f"- tokens_per_confirmed_success: {kpis.get('tokens_per_confirmed_success', 0.0)}",
        f"- cost_per_confirmed_success_usd: {kpis.get('cost_per_confirmed_success_usd', 0.0)}",
        "",
        "## Breakdown",
        "",
        "### Tool mode",
    ]

    tool_mode = breakdown.get("tool_mode", {}) if isinstance(breakdown.get("tool_mode", {}), dict) else {}
    if not tool_mode:
        lines.append("- none")
    else:
        for mode, data in tool_mode.items():
            if not isinstance(data, dict):
                continue
            lines.append(
                f"- {mode}: count={data.get('count', 0)}, tokens={data.get('tokens', 0)}, cost_usd={round(float(data.get('cost_usd', 0.0)), 6)}"
            )

    lines.extend(["", "### Model"])
    by_model = breakdown.get("model", {}) if isinstance(breakdown.get("model", {}), dict) else {}
    if not by_model:
        lines.append("- none")
    else:
        for model, data in by_model.items():
            if not isinstance(data, dict):
                continue
            lines.append(
                f"- {model}: count={data.get('count', 0)}, tokens={data.get('tokens', 0)}, cost_usd={round(float(data.get('cost_usd', 0.0)), 6)}"
            )

    lines.extend(["", "### Engine"])
    by_engine = breakdown.get("engine", {}) if isinstance(breakdown.get("engine", {}), dict) else {}
    if not by_engine:
        lines.append("- none")
    else:
        for engine, data in by_engine.items():
            if not isinstance(data, dict):
                continue
            lines.append(
                f"- {engine}: count={data.get('count', 0)}, tokens={data.get('tokens', 0)}, cost_usd={round(float(data.get('cost_usd', 0.0)), 6)}"
            )

    lines.extend(
        [
            "",
            "## Assessment",
            "",
            f"- has_value_signal: {assessment.get('has_value_signal', False)}",
            f"- notes: {assessment.get('notes', '')}",
            "",
        ]
    )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build value-per-iteration report from routing, feedback and token metrics.")
    parser.add_argument("--routing-log", default="observability/logs/routing-decisions.jsonl")
    parser.add_argument("--feedback-log", default="observability/logs/learning-feedback.jsonl")
    parser.add_argument("--metrics-log", default="observability/logs/iteration-metrics.jsonl")
    parser.add_argument("--out-json", default="observability/evals/iteration-value-report.json")
    parser.add_argument("--out-md", default="observability/evals/iteration-value-report.md")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    routing_path = (repo_root / args.routing_log).resolve()
    feedback_path = (repo_root / args.feedback_log).resolve()
    metrics_path = (repo_root / args.metrics_log).resolve()
    out_json = (repo_root / args.out_json).resolve()
    out_md = (repo_root / args.out_md).resolve()

    events = parse_jsonl(routing_path)
    feedback_rows = parse_jsonl(feedback_path)
    metrics_rows = parse_jsonl(metrics_path)

    report = build_report(
        events,
        latest_by_event(feedback_rows),
        latest_by_event(metrics_rows),
        {
            "routing": args.routing_log.replace("\\", "/"),
            "feedback": args.feedback_log.replace("\\", "/"),
            "metrics": args.metrics_log.replace("\\", "/"),
        },
    )

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_md.parent.mkdir(parents=True, exist_ok=True)

    out_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out_md.write_text(to_markdown(report), encoding="utf-8")

    print(f"Iteration value report generated.")
    print(f"JSON: {out_json}")
    print(f"MD: {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
