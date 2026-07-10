from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _parse_bool(value: str | bool | None, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_float(value: str | float | int | None, default: float) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return default
    try:
        return float(str(value).strip())
    except Exception:
        return default


@dataclass
class LangSmithConfig:
    enabled: bool = False
    api_key: str = ""
    project: str = ""
    endpoint: str = ""
    workspace_id: str = ""
    high_signal_only: bool = True
    min_span_duration_ms: float = 100.0
    emit_execution_summary: bool = True


@dataclass
class TelemetryConfig:
    enabled: bool = True
    exporters: list[str] = field(default_factory=lambda: ["console", "json"])
    batch_size: int = 25
    telemetry_dir: str = ".telemetry"
    langsmith: LangSmithConfig = field(default_factory=LangSmithConfig)


def _load_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _load_dotenv_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        env_key = key.strip()
        if not env_key:
            continue

        env_value = value.strip()
        if len(env_value) >= 2 and env_value[0] == env_value[-1] and env_value[0] in {'"', "'"}:
            env_value = env_value[1:-1]
        values[env_key] = env_value

    return values


def load_config(repo_root: Path) -> TelemetryConfig:
    raw = _load_json_file(repo_root / "telemetry" / "config.json")
    dotenv = _load_dotenv_file(repo_root / ".env")
    telemetry_raw = raw.get("telemetry", {}) if isinstance(raw.get("telemetry"), dict) else {}
    langsmith_raw = raw.get("langsmith", {}) if isinstance(raw.get("langsmith"), dict) else {}

    def _get_env(name: str, default: str | None = None) -> str | None:
        if name in os.environ:
            value = os.environ.get(name)
            return None if value is None else str(value)
        return dotenv.get(name, default)

    exporters = telemetry_raw.get("exporters", ["console", "json"])
    if not isinstance(exporters, list):
        exporters = ["console", "json"]

    env_exporters = (_get_env("TELEMETRY_EXPORTERS", "") or "").strip()
    if env_exporters:
        exporters = [item.strip().lower() for item in env_exporters.split(",") if item.strip()]

    cfg = TelemetryConfig(
        enabled=_parse_bool(_get_env("TELEMETRY_ENABLED"), _parse_bool(telemetry_raw.get("enabled"), True)),
        exporters=[str(item).lower() for item in exporters],
        batch_size=max(1, int((_get_env("TELEMETRY_BATCH_SIZE", str(telemetry_raw.get("batch_size", 25))) or str(telemetry_raw.get("batch_size", 25))))),
        telemetry_dir=str((_get_env("TELEMETRY_DIR", str(telemetry_raw.get("telemetry_dir", ".telemetry"))) or str(telemetry_raw.get("telemetry_dir", ".telemetry")))),
        langsmith=LangSmithConfig(
            enabled=_parse_bool(
                _get_env("LANGSMITH_ENABLED", _get_env("LANGSMITH_TRACING")),
                _parse_bool(langsmith_raw.get("enabled"), False),
            ),
            api_key=str((_get_env("LANGSMITH_API_KEY", str(langsmith_raw.get("api_key", ""))) or str(langsmith_raw.get("api_key", "")))),
            project=str((_get_env("LANGSMITH_PROJECT", str(langsmith_raw.get("project", ""))) or str(langsmith_raw.get("project", "")))),
            endpoint=str((_get_env("LANGSMITH_ENDPOINT", str(langsmith_raw.get("endpoint", ""))) or str(langsmith_raw.get("endpoint", "")))),
            workspace_id=str((_get_env("LANGSMITH_WORKSPACE_ID", str(langsmith_raw.get("workspace_id", ""))) or str(langsmith_raw.get("workspace_id", "")))),
            high_signal_only=_parse_bool(
                _get_env("LANGSMITH_HIGH_SIGNAL_ONLY"),
                _parse_bool(langsmith_raw.get("high_signal_only"), True),
            ),
            min_span_duration_ms=_parse_float(
                _get_env("LANGSMITH_MIN_SPAN_DURATION_MS"),
                _parse_float(langsmith_raw.get("min_span_duration_ms"), 100.0),
            ),
            emit_execution_summary=_parse_bool(
                _get_env("LANGSMITH_EMIT_EXECUTION_SUMMARY"),
                _parse_bool(langsmith_raw.get("emit_execution_summary"), True),
            ),
        ),
    )
    return cfg
