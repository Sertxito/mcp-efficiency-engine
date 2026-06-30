from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Enforce AutoLearning value gate from iteration-value report.")
    parser.add_argument("--report", default="observability/evals/iteration-value-report.json")
    parser.add_argument("--min-events-with-id", type=int, default=5)
    parser.add_argument("--min-confirmed", type=int, default=3)
    parser.add_argument("--min-metrics-coverage", type=float, default=0.6)
    parser.add_argument("--min-feedback-coverage", type=float, default=0.6)
    parser.add_argument("--min-success-rate", type=float, default=0.7)
    parser.add_argument("--max-cost-per-success", type=float, default=0.05)
    args = parser.parse_args()

    report_path = Path(args.report)
    if not report_path.exists():
        raise SystemExit(f"Missing report: {report_path}")

    data = json.loads(report_path.read_text(encoding="utf-8"))
    totals = data.get("totals", {}) if isinstance(data.get("totals", {}), dict) else {}
    kpis = data.get("kpis", {}) if isinstance(data.get("kpis", {}), dict) else {}
    assessment = data.get("assessment", {}) if isinstance(data.get("assessment", {}), dict) else {}

    events_with_id = int(totals.get("events_with_event_id", 0) or 0)
    confirmed = int(totals.get("feedback_confirmed", 0) or 0)

    metrics_cov = float(kpis.get("metrics_coverage_rate", 0.0) or 0.0)
    feedback_cov = float(kpis.get("confirmed_feedback_rate", 0.0) or 0.0)
    success_rate = float(kpis.get("confirmed_success_rate", 0.0) or 0.0)
    cps = float(kpis.get("cost_per_confirmed_success_usd", 0.0) or 0.0)
    has_value_signal = bool(assessment.get("has_value_signal", False))

    failures: list[str] = []
    if events_with_id < args.min_events_with_id:
        failures.append(f"events_with_event_id {events_with_id} < {args.min_events_with_id}")
    if confirmed < args.min_confirmed:
        failures.append(f"feedback_confirmed {confirmed} < {args.min_confirmed}")
    if metrics_cov < args.min_metrics_coverage:
        failures.append(f"metrics_coverage_rate {metrics_cov:.4f} < {args.min_metrics_coverage:.4f}")
    if feedback_cov < args.min_feedback_coverage:
        failures.append(f"confirmed_feedback_rate {feedback_cov:.4f} < {args.min_feedback_coverage:.4f}")
    if success_rate < args.min_success_rate:
        failures.append(f"confirmed_success_rate {success_rate:.4f} < {args.min_success_rate:.4f}")
    if has_value_signal and cps > args.max_cost_per_success:
        failures.append(f"cost_per_confirmed_success_usd {cps:.6f} > {args.max_cost_per_success:.6f}")

    print("AutoLearning Gate Summary")
    print(f"- events_with_event_id: {events_with_id}")
    print(f"- feedback_confirmed: {confirmed}")
    print(f"- metrics_coverage_rate: {metrics_cov:.4f}")
    print(f"- confirmed_feedback_rate: {feedback_cov:.4f}")
    print(f"- confirmed_success_rate: {success_rate:.4f}")
    print(f"- cost_per_confirmed_success_usd: {cps:.6f}")
    print(f"- has_value_signal: {has_value_signal}")

    if failures:
        print("AutoLearning Gate FAILED:")
        for f in failures:
            print(f"  - {f}")
        raise SystemExit(1)

    print("AutoLearning Gate PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
