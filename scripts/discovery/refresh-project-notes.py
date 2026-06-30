from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

AUTO_START = "<!-- AUTO-GENERATED:START -->"
AUTO_END = "<!-- AUTO-GENERATED:END -->"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def get_number(value: Any, default: float = 0.0) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return default


def upsert_auto_section(path: Path, title: str, body_lines: list[str]) -> None:
    header = f"# {title}\n\n"
    auto_block = [AUTO_START, *body_lines, AUTO_END, ""]
    auto_text = "\n".join(auto_block)

    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(header + auto_text, encoding="utf-8")
        return

    text = path.read_text(encoding="utf-8")
    if not text.strip():
        text = header

    if AUTO_START in text and AUTO_END in text:
        start = text.index(AUTO_START)
        end = text.index(AUTO_END) + len(AUTO_END)
        new_text = text[:start].rstrip() + "\n\n" + auto_text
    else:
        new_text = text.rstrip() + "\n\n" + auto_text

    path.write_text(new_text, encoding="utf-8")


def build_decisions_lines(routing: dict[str, Any], learning: dict[str, Any], value: dict[str, Any]) -> list[str]:
    cases_total = int(routing.get("cases_total", 0) or 0)
    cases_passed = int(routing.get("cases_passed", 0) or 0)

    health = learning.get("health", {}) if isinstance(learning.get("health", {}), dict) else {}
    fallback_ok = bool(health.get("fallback_ok", False))
    grounded_ok = bool(health.get("grounded_ok", False))
    confidence_ok = bool(health.get("confidence_ok", False))

    assessment = value.get("assessment", {}) if isinstance(value.get("assessment", {}), dict) else {}
    has_value_signal = bool(assessment.get("has_value_signal", False))

    lines = [
        f"- updated_at: {utc_now()}",
        f"- decision: mantener routing gate activo (routing-evals {cases_passed}/{cases_total} passed).",
        f"- decision: priorizar reduccion de fallback si health.fallback_ok={fallback_ok}.",
        f"- decision: mantener evidencia obligatoria mientras health.grounded_ok={grounded_ok}.",
        f"- decision: mantener confidence floor mientras health.confidence_ok={confidence_ok}.",
        f"- decision: usar value-per-iteration para priorizacion (has_value_signal={has_value_signal}).",
    ]
    return lines


def build_glossary_lines(learning: dict[str, Any], value: dict[str, Any]) -> list[str]:
    kpis = learning.get("kpis", {}) if isinstance(learning.get("kpis", {}), dict) else {}
    vkpis = value.get("kpis", {}) if isinstance(value.get("kpis", {}), dict) else {}

    fallback_rate = round(get_number(kpis.get("fallback_rate")) * 100.0, 2)
    grounded_rate = round(get_number(kpis.get("grounded_rate")) * 100.0, 2)
    success_rate = round(get_number(kpis.get("success_rate")) * 100.0, 2)
    coverage_rate = round(get_number(vkpis.get("metrics_coverage_rate")) * 100.0, 2)
    tokens_per_success = get_number(vkpis.get("tokens_per_confirmed_success"))

    lines = [
        f"- updated_at: {utc_now()}",
        f"- fallback_rate: porcentaje de rutas en fallback. valor_actual={fallback_rate}%.",
        f"- grounded_rate: porcentaje de rutas con fuentes validas. valor_actual={grounded_rate}%.",
        f"- confirmed_success_rate: tasa de exito con feedback confirmado. valor_actual={success_rate}%.",
        f"- metrics_coverage_rate: porcentaje de eventos con metricas. valor_actual={coverage_rate}%.",
        f"- tokens_per_confirmed_success: tokens medios por exito confirmado. valor_actual={tokens_per_success}.",
        "- value_signal: indicador de que hay datos suficientes para optimizacion por iteracion.",
    ]
    return lines


def build_risks_lines(learning: dict[str, Any], value: dict[str, Any]) -> list[str]:
    total_events = int(learning.get("total_events", 0) or 0)
    pending_events = int(learning.get("pending_events", 0) or 0)

    kpis = learning.get("kpis", {}) if isinstance(learning.get("kpis", {}), dict) else {}
    thresholds = learning.get("thresholds", {}) if isinstance(learning.get("thresholds", {}), dict) else {}

    fallback_rate = get_number(kpis.get("fallback_rate"))
    grounded_rate = get_number(kpis.get("grounded_rate"))
    confidence_avg = get_number(kpis.get("confidence_avg"))

    fallback_max = get_number(thresholds.get("fallback_rate_max"), 0.2)
    grounded_min = get_number(thresholds.get("grounded_rate_min"), 0.8)
    confidence_min = get_number(thresholds.get("confidence_avg_min"), 0.8)

    vkpis = value.get("kpis", {}) if isinstance(value.get("kpis", {}), dict) else {}
    metrics_coverage_rate = get_number(vkpis.get("metrics_coverage_rate"))
    confirmed_feedback_rate = get_number(vkpis.get("confirmed_feedback_rate"))

    risks: list[str] = [f"- updated_at: {utc_now()}"]

    if fallback_rate > fallback_max:
        risks.append(
            f"- high_fallback: fallback_rate={round(fallback_rate * 100.0, 2)}% supera max={round(fallback_max * 100.0, 2)}%."
        )

    if grounded_rate < grounded_min:
        risks.append(
            f"- low_grounding: grounded_rate={round(grounded_rate * 100.0, 2)}% por debajo de min={round(grounded_min * 100.0, 2)}%."
        )

    if confidence_avg < confidence_min:
        risks.append(f"- low_confidence: confidence_avg={round(confidence_avg, 3)} por debajo de min={confidence_min}.")

    if pending_events > 0:
        pending_pct = round((pending_events / total_events) * 100.0, 2) if total_events > 0 else 0.0
        risks.append(f"- pending_feedback: pending_events={pending_events}/{total_events} ({pending_pct}%).")

    if metrics_coverage_rate < 1.0:
        risks.append(f"- incomplete_metrics: metrics_coverage_rate={round(metrics_coverage_rate * 100.0, 2)}%.")

    if confirmed_feedback_rate < 1.0:
        risks.append(f"- incomplete_feedback: confirmed_feedback_rate={round(confirmed_feedback_rate * 100.0, 2)}%.")

    if len(risks) == 1:
        risks.append("- no_critical_risks_detected: umbrales clave en rango.")

    return risks


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh context/project-notes from observability reports.")
    parser.add_argument("--routing", default="observability/evals/routing-eval-report.json")
    parser.add_argument("--learning", default="observability/evals/learning-loop-report.json")
    parser.add_argument("--value", default="observability/evals/iteration-value-report.json")
    parser.add_argument("--notes-dir", default="context/project-notes")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    routing = load_json((repo_root / args.routing).resolve())
    learning = load_json((repo_root / args.learning).resolve())
    value = load_json((repo_root / args.value).resolve())

    notes_dir = (repo_root / args.notes_dir).resolve()
    decisions = notes_dir / "decisions.md"
    glossary = notes_dir / "glossary.md"
    known_risks = notes_dir / "known-risks.md"

    upsert_auto_section(decisions, "Decisions", build_decisions_lines(routing, learning, value))
    upsert_auto_section(glossary, "Glossary", build_glossary_lines(learning, value))
    upsert_auto_section(known_risks, "Known Risks", build_risks_lines(learning, value))

    print(f"Project notes refreshed in: {notes_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
