from __future__ import annotations

"""Validate RAG local routing spec requirements.

Assertions:
  1. domain=rag with source_type=technical-docs selects agent=rag-local.
  2. The routing event declares grounded=true with explicit sources from the repo.

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
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, encoding="utf-8")
    stdout = proc.stdout or ""
    brace = stdout.find("{")
    last_brace = stdout.rfind("}")
    if brace == -1 or last_brace == -1:
        raise ValueError(f"No JSON in output: {stdout[:200]}")
    return json.loads(stdout[brace : last_brace + 1])


def main() -> int:
    errors: list[str] = []
    print("=== validate-rag-routing ===")

    # --- Assertion 1: rag domain + technical-docs → rag-local ---
    try:
        event = run_routing(
            input="explica guia tecnica local",
            intent="info",
            domain="rag",
            source_type="technical-docs",
        )
        agent = event.get("agent", "")
        if agent != "rag-local":
            errors.append(f"[FAIL] expected agent=rag-local, got agent={agent!r}")
        else:
            print(f"[OK] domain=rag + technical-docs → agent={agent}")

        # --- Assertion 2: grounded=true with explicit sources ---
        grounded = event.get("grounded")
        sources = event.get("sources", [])
        if not grounded:
            errors.append(f"[FAIL] rag-local event expected grounded=true, got grounded={grounded!r}")
        elif not sources:
            errors.append("[FAIL] rag-local event grounded=true but sources list is empty")
        else:
            print(f"[OK] grounded=true with sources: {sources}")

    except Exception as exc:
        errors.append(f"[FAIL] routing error: {exc}")

    print()
    if errors:
        for e in errors:
            print(e)
        print(f"validate-rag-routing FAILED: {len(errors)} issue(s)")
        return 1

    print("validate-rag-routing PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
