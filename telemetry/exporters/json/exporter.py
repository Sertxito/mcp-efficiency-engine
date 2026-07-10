from __future__ import annotations

import json
from pathlib import Path


class JsonExporter:
    name = "json"

    def __init__(self, telemetry_dir: Path) -> None:
        self.telemetry_dir = telemetry_dir
        self.telemetry_dir.mkdir(parents=True, exist_ok=True)
        self.traces_file = self.telemetry_dir / "traces.jsonl"
        self.metrics_file = self.telemetry_dir / "metrics.jsonl"

    def _append_lines(self, file_path: Path, entries: list[dict]) -> None:
        if not entries:
            return
        with file_path.open("a", encoding="utf-8") as handle:
            for entry in entries:
                handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")))
                handle.write("\n")

    def export(self, records: list[dict]) -> None:
        traces = [r for r in records if str(r.get("type", "")) in {"event", "span"}]
        metrics = [r for r in records if str(r.get("type", "")) == "metric"]
        self._append_lines(self.traces_file, traces)
        self._append_lines(self.metrics_file, metrics)

    def flush(self) -> None:
        return

    def shutdown(self) -> None:
        return
