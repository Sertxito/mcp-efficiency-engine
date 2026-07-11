from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def _bootstrap_repo_root() -> Path:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    return repo_root


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a command wrapped with telemetry execution/span.")
    parser.add_argument("--operation", required=True, help="Telemetry operation name.")
    parser.add_argument("--session-id", default="mcpee-cli", help="Telemetry session identifier.")
    parser.add_argument("--cwd", default=".", help="Working directory for the command.")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="Command to execute after --.")
    return parser.parse_args()


def _normalize_command(raw: list[str]) -> list[str]:
    cmd = list(raw)
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    return cmd


def main() -> int:
    args = _parse_args()
    command = _normalize_command(args.command)
    if not command:
        print("trace-command.py: missing command to execute", file=sys.stderr)
        return 2

    repo_root = _bootstrap_repo_root()
    from telemetry import build_telemetry_collector

    collector = build_telemetry_collector(repo_root)
    cwd = Path(args.cwd).resolve()
    exit_code = 0

    try:
        with collector.start_execution(operation=args.operation, session_id=args.session_id, model="mcpee-cli"):
            with collector.start_span(
                name="subprocess",
                kind="TOOL",
                attributes={
                    "cwd": str(cwd),
                    "command": command[0],
                    "args_count": len(command) - 1,
                },
            ):
                completed = subprocess.run(command, cwd=str(cwd), check=False)
                exit_code = int(completed.returncode)
                collector.record_metric("subprocess_exit_code", float(exit_code), unit="code")
                if exit_code != 0:
                    raise RuntimeError(f"command failed with exit code {exit_code}")
    except RuntimeError:
        pass

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
