from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path


def _bootstrap_repo_root() -> Path:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    return repo_root


def _hash_command(command: str) -> str:
    return hashlib.sha256(command.encode("utf-8")).hexdigest()[:16]


def main() -> int:
    parser = argparse.ArgumentParser(description="Emit telemetry for an already executed terminal command.")
    parser.add_argument("--session-id", default="terminal-session", help="Session identifier")
    parser.add_argument("--cwd", default=".", help="Current working directory")
    parser.add_argument("--command", default="", help="Executed command text")
    parser.add_argument("--success", default="true", help="Whether command succeeded (true/false)")
    parser.add_argument("--exit-code", type=int, default=0, help="Exit code for native commands")
    args = parser.parse_args()

    command_text = (args.command or "").strip()
    if not command_text:
        return 0

    repo_root = _bootstrap_repo_root()
    from telemetry import build_telemetry_collector

    collector = build_telemetry_collector(repo_root)

    success = str(args.success).strip().lower() in {"1", "true", "yes", "ok"}
    normalized_cwd = str(Path(args.cwd).resolve())

    with collector.start_execution(
        operation="terminal.command",
        session_id=str(args.session_id).strip() or "terminal-session",
        model="powershell",
        provider="local-shell",
    ):
        with collector.start_span(
            name="terminal.executed_command",
            kind="TOOL",
            attributes={
                "cwd": normalized_cwd,
                "command_hash": _hash_command(command_text),
                "success": success,
                "exit_code": int(args.exit_code),
            },
        ):
            collector.record_event(
                "RoutingResolved",
                {
                    "source": "terminal-hook",
                    "cwd": normalized_cwd,
                    "success": success,
                    "exit_code": int(args.exit_code),
                },
                level="INFO",
            )
            collector.record_metric("terminal_command_count", 1.0, unit="count")
            collector.record_metric("terminal_last_exit_code", float(int(args.exit_code)), unit="code")
            if not success:
                collector.record_event(
                    "ExceptionThrown",
                    {
                        "source": "terminal-hook",
                        "message": "command_reported_failure",
                        "exit_code": int(args.exit_code),
                    },
                    level="ERROR",
                )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
