from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_cases(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = data.get("cases", [])
    if not isinstance(cases, list):
        return []
    return [c for c in cases if isinstance(c, dict)]


def parse_event_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    ids: set[str] = set()
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
        if event_id:
            ids.add(event_id)
    return ids


def run_case(repo_root: Path, case: dict[str, Any], routing_log: Path) -> tuple[bool, str, str | None]:
    before_ids = parse_event_ids(routing_log)
    cmd = [
        sys.executable,
        str((repo_root / "scripts/intake/resolve-routing.py").resolve()),
        "--input",
        str(case.get("input", "")),
        "--intent",
        str(case.get("intent", "")),
        "--domain",
        str(case.get("domain", "")),
        "--source-type",
        str(case.get("source_type", "technical-docs")),
        "--capability",
        str(case.get("capability", "")),
    ]
    proc = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True)
    output = (proc.stdout or "") + (proc.stderr or "")

    event_id: str | None = None
    after_ids = parse_event_ids(routing_log)
    new_ids = after_ids - before_ids
    if new_ids:
        event_id = sorted(new_ids)[-1]

    return proc.returncode == 0, output, event_id


def record_feedback(repo_root: Path, event_id: str, case_id: str) -> tuple[bool, str]:
    cmd = [
        sys.executable,
        str((repo_root / "scripts/learning/record-learning-feedback.py").resolve()),
        "--event-id",
        event_id,
        "--success",
        "true",
        "--confidence",
        "0.95",
        "--source",
        "ci",
        "--notes",
        f"routing-eval-pass:{case_id}",
    ]
    proc = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True)
    output = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0, output


def main() -> int:
    parser = argparse.ArgumentParser(description="Run routing eval cases and write JSON report.")
    parser.add_argument("--cases", default="observability/evals/routing-eval-cases.json")
    parser.add_argument("--report", default="observability/evals/routing-eval-report.json")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    routing_log = (repo_root / "observability/logs/routing-decisions.jsonl").resolve()
    cases_path = (repo_root / args.cases).resolve()
    if not cases_path.exists():
        print(f"Missing eval cases file: {cases_path}")
        return 1

    cases = load_cases(cases_path)
    results: list[dict[str, Any]] = []
    passed = 0

    for case in cases:
        ok, output, event_id = run_case(repo_root, case, routing_log)
        feedback_ok = False
        feedback_output = ""
        case_id = str(case.get("id", "unknown"))

        if ok and event_id:
            feedback_ok, feedback_output = record_feedback(repo_root, event_id, case_id)
        if ok:
            passed += 1
        results.append(
            {
                "id": case_id,
                "ok": ok,
                "event_id": event_id,
                "feedback_recorded": feedback_ok,
                "feedback_output": feedback_output,
                "output": output,
            }
        )

    report = {
        "timestamp": utc_now(),
        "cases_total": len(cases),
        "cases_passed": passed,
        "cases_failed": len(cases) - passed,
        "results": results,
    }
    report_path = (repo_root / args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Routing evals completed: {passed}/{len(cases)} passed")
    print(f"Report: {report_path}")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
