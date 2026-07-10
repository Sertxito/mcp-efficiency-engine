import json
from pathlib import Path
from typing import Any, Dict


class IncrementalEngine:
    def __init__(self, cache_path: Path, telemetry_collector: Any | None = None) -> None:
        self.cache_path = cache_path
        self._telemetry = telemetry_collector

    def _extract_nodes(self, loaded: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        preferred = loaded.get("wiki_nodes")
        if isinstance(preferred, dict):
            return preferred

        compatibility = loaded.get("nodes")
        if isinstance(compatibility, dict):
            return compatibility

        return {}

    def _load_cached_graph(self) -> Dict[str, Any]:
        if not self.cache_path.exists():
            return {"last_updated": "", "nodes": {}}
        try:
            with self.cache_path.open("r", encoding="utf-8") as handle:
                loaded = json.load(handle)

            if not isinstance(loaded, dict):
                return {"last_updated": "", "nodes": {}}

            nodes = self._extract_nodes(loaded)
            return {
                "last_updated": str(loaded.get("last_updated", "")),
                "nodes": nodes,
            }
        except Exception:
            return {"last_updated": "", "nodes": {}}

    def diff(self, incoming_nodes: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        if self._telemetry is not None:
            self._telemetry.record_event(
                "ToolStarted",
                {
                    "tool": "incremental_diff",
                    "incoming_nodes": len(incoming_nodes),
                },
            )
        cached = self._load_cached_graph()
        cached_nodes = cached.get("nodes", {})

        dirty_nodes: Dict[str, Dict[str, Any]] = {}
        for node_key, incoming in incoming_nodes.items():
            old = cached_nodes.get(node_key)
            if old is None:
                dirty_nodes[node_key] = incoming
                continue
            if str(old.get("checksum", "")) != str(incoming.get("checksum", "")):
                dirty_nodes[node_key] = incoming

        deleted_nodes = [key for key in cached_nodes.keys() if key not in incoming_nodes]
        if self._telemetry is not None:
            cache_hits = max(0, len(incoming_nodes) - len(dirty_nodes))
            cache_misses = len(dirty_nodes)
            self._telemetry.record_event(
                "ToolFinished",
                {
                    "tool": "incremental_diff",
                    "dirty_nodes": len(dirty_nodes),
                    "deleted_nodes": len(deleted_nodes),
                },
            )
            self._telemetry.record_metric("cache_hits", float(cache_hits), unit="count")
            self._telemetry.record_metric("cache_misses", float(cache_misses), unit="count")
        return {
            "dirty_nodes": dirty_nodes,
            "deleted_nodes": deleted_nodes,
            "cached_graph": cached,
        }