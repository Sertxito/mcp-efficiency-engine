from __future__ import annotations

"""Validate security posture against security-policy.md.

Checks:
  1. security-policy.md exists and contains required rule keywords.
  2. No secret-like patterns in observable artefacts (logs, snapshots, repomix output).
  3. Routing events with hitl_required=true have a valid HITL structure.

Exit 0 = all checks pass.  Exit 1 = one or more failures.
"""

import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]

SECURITY_POLICY_PATH = REPO_ROOT / "policies" / "security-policy.md"

REQUIRED_POLICY_KEYWORDS = [
    "secretos",
    "tokens",
    "credenciales",
    "confirmacion",
    "sensible",
]

SECRET_PATTERN = re.compile(
    r"""(?xi)
    (?:
        (?:api[_\-]?key|api[_\-]?secret|access[_\-]?token|auth[_\-]?token|
           client[_\-]?secret|private[_\-]?key|password|passwd|
           bearer\s+[a-z0-9\-._~+/]+=*)
        \s*[=:]\s*['"]?[a-z0-9\-._~+/]{16,}['"]?
    )
    |
    -----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----
    """,
    re.IGNORECASE,
)

SCAN_PATHS = [
    REPO_ROOT / "observability" / "logs",
    REPO_ROOT / "context" / "repomix",
]

ROUTING_LOG = REPO_ROOT / "observability" / "logs" / "routing-decisions.jsonl"


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------


def check_policy_exists() -> list[str]:
    errors: list[str] = []
    if not SECURITY_POLICY_PATH.exists():
        errors.append(f"MISSING: {SECURITY_POLICY_PATH.relative_to(REPO_ROOT)}")
        return errors
    content = SECURITY_POLICY_PATH.read_text(encoding="utf-8").lower()
    for kw in REQUIRED_POLICY_KEYWORDS:
        if kw not in content:
            errors.append(f"security-policy.md missing required keyword: '{kw}'")
    return errors


def check_no_secrets_in_artefacts() -> list[str]:
    errors: list[str] = []
    for base in SCAN_PATHS:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            # Skip binary files larger than 1 MB
            if path.stat().st_size > 1_048_576:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for m in SECRET_PATTERN.finditer(text):
                line_no = text[: m.start()].count("\n") + 1
                rel = path.relative_to(REPO_ROOT)
                errors.append(f"POTENTIAL SECRET at {rel}:{line_no} → {m.group()[:60]!r}")
    return errors


def check_hitl_events() -> list[str]:
    errors: list[str] = []
    if not ROUTING_LOG.exists():
        return errors
    for raw in ROUTING_LOG.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            event = json.loads(raw)
        except Exception:
            continue
        if not isinstance(event, dict):
            continue
        hitl = event.get("hitl")
        if not isinstance(hitl, dict):
            continue
        required = hitl.get("required")
        if required is not True:
            continue
        # High-risk events must declare an action (not "none")
        action = str(hitl.get("action", "none")).lower()
        if action == "none":
            eid = event.get("event_id", "unknown")
            errors.append(f"Event {eid}: hitl.required=true but action='none' (HITL not routed)")
    return errors


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def main() -> int:
    all_errors: list[str] = []

    print("=== validate-security: checking security posture ===")

    policy_errors = check_policy_exists()
    if policy_errors:
        print("[FAIL] Policy check:")
        for e in policy_errors:
            print(f"  - {e}")
    else:
        print("[OK] security-policy.md present and contains required keywords")
    all_errors.extend(policy_errors)

    secret_errors = check_no_secrets_in_artefacts()
    if secret_errors:
        print("[FAIL] Secret scan:")
        for e in secret_errors:
            print(f"  - {e}")
    else:
        print("[OK] No secret-like patterns found in observable artefacts")
    all_errors.extend(secret_errors)

    hitl_errors = check_hitl_events()
    if hitl_errors:
        print("[FAIL] HITL routing check:")
        for e in hitl_errors:
            print(f"  - {e}")
    else:
        print("[OK] All high-risk routing events have valid HITL routing")
    all_errors.extend(hitl_errors)

    print()
    if all_errors:
        print(f"validate-security FAILED: {len(all_errors)} issue(s) found")
        return 1

    print("validate-security PASSED: all security checks OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
