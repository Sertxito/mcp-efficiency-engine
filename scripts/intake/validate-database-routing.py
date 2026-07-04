from __future__ import annotations

"""Validate database routing spec requirements.

Assertions:
  1. intent=sql with domain=dba selects agent=dba.
  2. An event with no resolvable source declares grounded=false.

Exit 0 = pass.  Exit 1 = fail.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RESOLVE_SCRIPT = REPO_ROOT / "scripts" / "intake" / "resolve-routing.py"


def run_routing(**kwargs: str) -> dict:
    cmd = [sys.executable, str(RESOLVE_SCRIPT)]
    for k, v in kwargs.items():
        cmd += [f"--{k.replace('_', '-')}", v]
    # Use utf-8 encoding and errors='replace' to handle non-ASCII chars
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    # Output contains a JSON block followed by a trailing log line; extract JSON.
    stdout = proc.stdout or ""
    brace = stdout.find("{")
    last_brace = stdout.rfind("}")
    if brace == -1 or last_brace == -1:
        raise ValueError(f"No JSON in output: {stdout[:200]}")
    return json.loads(stdout[brace : last_brace + 1])


def main() -> int:
    errors: list[str] = []
    print("=== validate-database-routing ===")

    # --- Assertion 1: intent=sql routes to dba ---
    try:
        event = run_routing(
            input="analiza esquema sql",
            intent="sql",
            domain="dba",
            source_type="technical-docs",
        )
        agent = event.get("agent", "")
        if agent != "dba":
            errors.append(f"[FAIL] intent=sql expected agent=dba, got agent={agent!r}")
        else:
            print(f"[OK] intent=sql → agent={agent}")
    except Exception as exc:
        errors.append(f"[FAIL] routing error for intent=sql: {exc}")

    # --- Assertion 2: no resolvable source → grounded=false ---
    try:
        event = run_routing(
            input="test grounding",
            intent="info",
            domain="unknown-domain",
            source_type="code",
        )
        grounded = event.get("grounded")
        if grounded is not False:
            errors.append(f"[FAIL] no-source event expected grounded=false, got grounded={grounded!r}")
        else:
            print("[OK] no-source event → grounded=false")
    except Exception as exc:
        errors.append(f"[FAIL] routing error for grounded check: {exc}")

    print()
    if errors:
        for e in errors:
            print(e)
        print(f"validate-database-routing FAILED: {len(errors)} issue(s)")
        return 1

    print("validate-database-routing PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
