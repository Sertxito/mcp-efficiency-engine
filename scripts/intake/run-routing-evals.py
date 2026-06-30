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


def run_case(repo_root: Path, case: dict[str, Any]) -> tuple[bool, str]:
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
    return proc.returncode == 0, (proc.stdout or "") + (proc.stderr or "")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run routing eval cases and write JSON report.")
    parser.add_argument("--cases", default="observability/evals/routing-eval-cases.json")
    parser.add_argument("--report", default="observability/evals/routing-eval-report.json")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    cases_path = (repo_root / args.cases).resolve()
    if not cases_path.exists():
        print(f"Missing eval cases file: {cases_path}")
        return 1

    cases = load_cases(cases_path)
    results: list[dict[str, Any]] = []
    passed = 0

    for case in cases:
        ok, output = run_case(repo_root, case)
        if ok:
            passed += 1
        results.append(
            {
                "id": case.get("id", "unknown"),
                "ok": ok,
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
