from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PLAN_INCLUDED_CREDITS_PER_USER = {
    "free": 0.0,
    "pro": 15.0,
    "pro+": 70.0,
    "max": 200.0,
    "business": 19.0,
    "enterprise": 39.0,
}


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


def parse_iso8601(value: str) -> datetime | None:
    text = value.strip()
    if not text:
        return None
    if text.isdigit():
        try:
            raw = float(text)
            # Copilot session logs use epoch milliseconds.
            if raw > 10_000_000_000:
                raw = raw / 1000.0
            return datetime.fromtimestamp(raw, tz=timezone.utc)
        except Exception:
            return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except Exception:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_date_arg(value: str, label: str) -> datetime:
    dt = parse_iso8601(value)
    if dt is None:
        raise ValueError(f"{label} must be ISO-8601, for example 2026-07-03T00:00:00Z")
    return dt


def is_copilot_session_row(row: dict[str, Any]) -> bool:
    usage = row.get("usage", {}) if isinstance(row.get("usage", {}), dict) else {}
    source = str(usage.get("source", "")).strip()
    if source == "copilot-session":
        return True
    event_id = str(row.get("event_id", "")).strip()
    return event_id.startswith("copilot-session::")


def row_timestamp(row: dict[str, Any]) -> datetime | None:
    raw = str(row.get("timestamp", "")).strip()
    if not raw:
        return None
    return parse_iso8601(raw)


def build_report(
    rows: list[dict[str, Any]],
    source_label: str,
    dt_from: datetime | None,
    dt_to: datetime | None,
    plan: str,
    seats: int,
) -> dict[str, Any]:
    filtered: list[dict[str, Any]] = []

    for row in rows:
        if not is_copilot_session_row(row):
            continue

        ts = row_timestamp(row)
        if dt_from is not None and (ts is None or ts < dt_from):
            continue
        if dt_to is not None and (ts is None or ts > dt_to):
            continue
        filtered.append(row)

    total_input_tokens = 0
    total_output_tokens = 0
    total_tokens = 0
    total_copilot_credits = 0.0

    by_model = defaultdict(lambda: {"count": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "copilot_credits": 0.0})
    by_day = defaultdict(lambda: {"count": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "copilot_credits": 0.0})

    for row in filtered:
        cost = row.get("cost", {}) if isinstance(row.get("cost", {}), dict) else {}
        model = str(row.get("model", "unknown"))
        ts = row_timestamp(row)
        day = ts.date().isoformat() if ts is not None else "unknown"

        input_tokens = int(cost.get("input_tokens", 0) or 0)
        output_tokens = int(cost.get("output_tokens", 0) or 0)
        row_total = int(cost.get("total_tokens", input_tokens + output_tokens) or 0)
        row_credits = float(cost.get("copilot_credits", 0.0) or 0.0)

        total_input_tokens += input_tokens
        total_output_tokens += output_tokens
        total_tokens += row_total
        total_copilot_credits += row_credits

        by_model[model]["count"] += 1
        by_model[model]["input_tokens"] += input_tokens
        by_model[model]["output_tokens"] += output_tokens
        by_model[model]["total_tokens"] += row_total
        by_model[model]["copilot_credits"] += row_credits

        by_day[day]["count"] += 1
        by_day[day]["input_tokens"] += input_tokens
        by_day[day]["output_tokens"] += output_tokens
        by_day[day]["total_tokens"] += row_total
        by_day[day]["copilot_credits"] += row_credits

    report = {
        "timestamp": utc_now(),
        "source": source_label,
        "filters": {
            "source": "copilot-session",
            "from": dt_from.isoformat() if dt_from is not None else "",
            "to": dt_to.isoformat() if dt_to is not None else "",
        },
        "totals": {
            "events": len(filtered),
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "total_tokens": total_tokens,
            "copilot_credits": round(total_copilot_credits, 6),
        },
        "breakdown": {
            "model": dict(sorted(by_model.items())),
            "day": dict(sorted(by_day.items())),
        },
    }

    included_per_user = float(PLAN_INCLUDED_CREDITS_PER_USER.get(plan, 0.0))
    included_total = included_per_user * float(seats)
    used_credits = float(report["totals"].get("copilot_credits", 0.0) or 0.0)
    overage_credits = max(0.0, used_credits - included_total)
    utilization = 0.0
    equivalent_seats_used = 0.0
    percent_of_one_seat = 0.0
    if included_total > 0:
        utilization = used_credits / included_total
    if included_per_user > 0:
        equivalent_seats_used = used_credits / included_per_user
        percent_of_one_seat = equivalent_seats_used * 100.0

    report["license"] = {
        "plan": plan,
        "seats": seats,
        "included_credits_per_user_month": included_per_user,
        "included_credits_total_month": round(included_total, 6),
    }
    report["budget"] = {
        "used_copilot_credits": round(used_credits, 6),
        "budget_utilization_rate": round(utilization, 6),
        "overage_credits": round(overage_credits, 6),
        "equivalent_seats_used": round(equivalent_seats_used, 6),
        "percent_of_one_seat": round(percent_of_one_seat, 2),
    }

    return report


def to_markdown(report: dict[str, Any]) -> str:
    totals = report.get("totals", {}) if isinstance(report.get("totals", {}), dict) else {}
    breakdown = report.get("breakdown", {}) if isinstance(report.get("breakdown", {}), dict) else {}
    filters = report.get("filters", {}) if isinstance(report.get("filters", {}), dict) else {}
    license_info = report.get("license", {}) if isinstance(report.get("license", {}), dict) else {}
    budget = report.get("budget", {}) if isinstance(report.get("budget", {}), dict) else {}

    lines = [
        "# Chat Token Usage Report",
        "",
        f"- timestamp: {report.get('timestamp', '')}",
        f"- source: {report.get('source', '')}",
        f"- filter.source: {filters.get('source', '')}",
        f"- filter.from: {filters.get('from', '')}",
        f"- filter.to: {filters.get('to', '')}",
        f"- plan: {license_info.get('plan', '')}",
        f"- seats: {license_info.get('seats', 0)}",
        "",
        "## Totals",
        "",
        f"- events: {totals.get('events', 0)}",
        f"- input_tokens: {totals.get('input_tokens', 0)}",
        f"- output_tokens: {totals.get('output_tokens', 0)}",
        f"- total_tokens: {totals.get('total_tokens', 0)}",
        f"- copilot_credits: {totals.get('copilot_credits', 0.0)}",
        f"- included_credits_total_month: {license_info.get('included_credits_total_month', 0.0)}",
        f"- budget_utilization_rate: {budget.get('budget_utilization_rate', 0.0)}",
        f"- overage_credits: {budget.get('overage_credits', 0.0)}",
        f"- equivalent_seats_used: {budget.get('equivalent_seats_used', 0.0)}",
        f"- percent_of_one_seat: {budget.get('percent_of_one_seat', 0.0)}",
        "",
        "## Breakdown by Model",
        "",
    ]

    by_model = breakdown.get("model", {}) if isinstance(breakdown.get("model", {}), dict) else {}
    if not by_model:
        lines.append("- none")
    else:
        for model, data in by_model.items():
            if not isinstance(data, dict):
                continue
            lines.append(
                f"- {model}: count={data.get('count', 0)}, input={data.get('input_tokens', 0)}, output={data.get('output_tokens', 0)}, total={data.get('total_tokens', 0)}, credits={round(float(data.get('copilot_credits', 0.0)), 6)}"
            )

    lines.extend(["", "## Breakdown by Day", ""])
    by_day = breakdown.get("day", {}) if isinstance(breakdown.get("day", {}), dict) else {}
    if not by_day:
        lines.append("- none")
    else:
        for day, data in by_day.items():
            if not isinstance(data, dict):
                continue
            lines.append(
                f"- {day}: count={data.get('count', 0)}, input={data.get('input_tokens', 0)}, output={data.get('output_tokens', 0)}, total={data.get('total_tokens', 0)}, credits={round(float(data.get('copilot_credits', 0.0)), 6)}"
            )

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build chat-only token usage report from iteration-metrics.")
    parser.add_argument("--metrics-log", default="observability/logs/iteration-metrics.jsonl")
    parser.add_argument("--from", dest="dt_from", default="", help="ISO-8601 lower bound, inclusive")
    parser.add_argument("--to", dest="dt_to", default="", help="ISO-8601 upper bound, inclusive")
    parser.add_argument(
        "--plan",
        default="business",
        choices=["free", "pro", "pro+", "max", "business", "enterprise"],
        help="Copilot plan for budget context",
    )
    parser.add_argument("--seats", type=int, default=1, help="Number of licensed users for pooled monthly credits")
    parser.add_argument("--out-json", default="observability/evals/chat-token-usage-report.json")
    parser.add_argument("--out-md", default="observability/evals/chat-token-usage-report.md")
    args = parser.parse_args()

    if args.seats <= 0:
        print("--seats must be >= 1")
        return 1

    dt_from = None
    dt_to = None
    if args.dt_from.strip():
        try:
            dt_from = parse_date_arg(args.dt_from, "--from")
        except ValueError as ex:
            print(str(ex))
            return 1
    if args.dt_to.strip():
        try:
            dt_to = parse_date_arg(args.dt_to, "--to")
        except ValueError as ex:
            print(str(ex))
            return 1

    if dt_from is not None and dt_to is not None and dt_from > dt_to:
        print("--from must be <= --to")
        return 1

    repo_root = Path(__file__).resolve().parents[2]
    metrics_path = (repo_root / args.metrics_log).resolve()
    out_json = (repo_root / args.out_json).resolve()
    out_md = (repo_root / args.out_md).resolve()

    rows = parse_jsonl(metrics_path)
    report = build_report(rows, args.metrics_log.replace("\\", "/"), dt_from, dt_to, args.plan, args.seats)

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out_md.write_text(to_markdown(report), encoding="utf-8")

    totals = report.get("totals", {}) if isinstance(report.get("totals", {}), dict) else {}
    print("Chat token usage report generated")
    print(f"events={totals.get('events', 0)} total_tokens={totals.get('total_tokens', 0)}")
    print(f"JSON: {out_json}")
    print(f"MD: {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
