from __future__ import annotations

from pathlib import Path

from telemetry.collector.engine import TelemetryCollector
from telemetry.config import load_config
from telemetry.exporters.console.exporter import ConsoleExporter
from telemetry.exporters.json.exporter import JsonExporter
from telemetry.exporters.langsmith.exporter import LangSmithExporter


def build_telemetry_collector(repo_root: Path) -> TelemetryCollector:
    cfg = load_config(repo_root)
    exporters: list[object] = []

    # Console exporter is always available in runtime.
    if "console" in cfg.exporters:
        exporters.append(ConsoleExporter())
    elif not cfg.exporters:
        exporters.append(ConsoleExporter())

    if "json" in cfg.exporters:
        exporters.append(JsonExporter((repo_root / cfg.telemetry_dir).resolve()))

    if "langsmith" in cfg.exporters and cfg.langsmith.enabled:
        has_langsmith_config = bool(cfg.langsmith.api_key.strip()) and bool(cfg.langsmith.project.strip())
        if has_langsmith_config:
            try:
                exporters.append(
                    LangSmithExporter(
                        api_key=cfg.langsmith.api_key,
                        project=cfg.langsmith.project,
                        endpoint=cfg.langsmith.endpoint,
                        workspace_id=cfg.langsmith.workspace_id,
                        high_signal_only=cfg.langsmith.high_signal_only,
                        min_span_duration_ms=cfg.langsmith.min_span_duration_ms,
                        emit_execution_summary=cfg.langsmith.emit_execution_summary,
                    )
                )
            except Exception:
                # LangSmith is optional and must never break startup.
                pass

    if not exporters:
        exporters.append(ConsoleExporter())

    return TelemetryCollector(exporters=exporters, enabled=cfg.enabled, batch_size=cfg.batch_size)
