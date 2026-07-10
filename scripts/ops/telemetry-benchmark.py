from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_command(python_exe: str) -> list[str]:
    return [
        python_exe,
        "scripts/intake/resolve-routing.py",
        "--input",
        "telemetry benchmark",
        "--intent",
        "feature",
        "--domain",
        "backend",
        "--source-type",
        "code",
        "--input-tokens",
        "120",
        "--output-tokens",
        "45",
        "--estimated-cost-usd",
        "0.0032",
        "--model",
        "GPT-5.3-Codex",
        "--local-tools",
        "2",
        "--remote-tools",
        "1",
    ]


def run_variant(*, repo_root: Path, iterations: int, telemetry_enabled: bool, python_exe: str) -> dict[str, Any]:
    durations_ms: list[float] = []
    failures = 0
    for _ in range(iterations):
        env = os.environ.copy()
        env["TELEMETRY_ENABLED"] = "true" if telemetry_enabled else "false"
        env["TELEMETRY_EXPORTERS"] = "console,json"

        start = time.perf_counter()
        proc = subprocess.run(
            build_command(python_exe),
            cwd=str(repo_root),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        durations_ms.append(elapsed_ms)
        if proc.returncode != 0:
            failures += 1

    avg_ms = statistics.mean(durations_ms) if durations_ms else 0.0
    p95_ms = statistics.quantiles(durations_ms, n=20)[18] if len(durations_ms) >= 20 else max(durations_ms, default=0.0)

    return {
        "telemetry_enabled": telemetry_enabled,
        "iterations": iterations,
        "failures": failures,
        "avg_ms": round(avg_ms, 3),
        "min_ms": round(min(durations_ms) if durations_ms else 0.0, 3),
        "max_ms": round(max(durations_ms) if durations_ms else 0.0, 3),
        "p95_ms": round(p95_ms, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark telemetry overhead on/off using resolve-routing as workload.")
    parser.add_argument("--iterations", type=int, default=10)
    parser.add_argument("--python", default="py")
    parser.add_argument("--python-arg", default="-3")
    parser.add_argument("--out", default="observability/evals/telemetry-overhead-benchmark.json")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    iterations = max(2, int(args.iterations))
    python_exe = args.python

    # Windows default launcher pattern: py -3
    if args.python == "py" and args.python_arg:
        python_exe = f"{args.python} {args.python_arg}"  # handled below

    if " " in python_exe:
        tokens = python_exe.split()
        base = tokens[0]
        extra = tokens[1:]
    else:
        base = python_exe
        extra = []

    def build_python() -> str:
        if not extra:
            return base
        return base

    # Probe python command in current environment.
    probe = subprocess.run([base, *extra, "--version"], cwd=str(repo_root), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if probe.returncode != 0:
        print("Unable to resolve python interpreter for benchmark")
        return 1

    def command_python() -> str:
        return base

    # Wrap variant runner to include optional extra interpreter args.
    def run_with_variant(telemetry_enabled: bool) -> dict[str, Any]:
        durations_ms: list[float] = []
        failures = 0
        for _ in range(iterations):
            env = os.environ.copy()
            env["TELEMETRY_ENABLED"] = "true" if telemetry_enabled else "false"
            env["TELEMETRY_EXPORTERS"] = "console,json"
            cmd = [base, *extra, *build_command(command_python())[1:]]

            start = time.perf_counter()
            proc = subprocess.run(
                cmd,
                cwd=str(repo_root),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            durations_ms.append(elapsed_ms)
            if proc.returncode != 0:
                failures += 1

        avg_ms = statistics.mean(durations_ms) if durations_ms else 0.0
        p95_ms = statistics.quantiles(durations_ms, n=20)[18] if len(durations_ms) >= 20 else max(durations_ms, default=0.0)

        return {
            "telemetry_enabled": telemetry_enabled,
            "iterations": iterations,
            "failures": failures,
            "avg_ms": round(avg_ms, 3),
            "min_ms": round(min(durations_ms) if durations_ms else 0.0, 3),
            "max_ms": round(max(durations_ms) if durations_ms else 0.0, 3),
            "p95_ms": round(p95_ms, 3),
        }

    enabled = run_with_variant(True)
    disabled = run_with_variant(False)

    overhead_ms = enabled["avg_ms"] - disabled["avg_ms"]
    overhead_pct = ((overhead_ms / disabled["avg_ms"]) * 100.0) if disabled["avg_ms"] > 0 else 0.0

    report = {
        "timestamp": utc_now(),
        "workload": "scripts/intake/resolve-routing.py",
        "iterations": iterations,
        "with_telemetry": enabled,
        "without_telemetry": disabled,
        "overhead": {
            "avg_ms": round(overhead_ms, 3),
            "avg_pct": round(overhead_pct, 3),
        },
    }

    out_path = (repo_root / args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"Benchmark report: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
