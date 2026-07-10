from __future__ import annotations

from typing import Protocol


class ITelemetryExporter(Protocol):
    name: str

    def export(self, records: list[dict]) -> None:
        ...

    def flush(self) -> None:
        ...

    def shutdown(self) -> None:
        ...
