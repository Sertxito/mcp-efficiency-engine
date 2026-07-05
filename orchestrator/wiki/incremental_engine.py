import json
from pathlib import Path
from typing import Any, Dict


class IncrementalEngine:
    def __init__(self, cache_path: Path) -> None:
        self.cache_path = cache_path

    def _load_cached_graph(self) -> Dict[str, Any]:
        if not self.cache_path.exists():
            return {"last_updated": "", "nodes": {}}
        try:
            with self.cache_path.open("r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            nodes = loaded.get("nodes", {}) if isinstance(loaded, dict) else {}
            if not isinstance(nodes, dict):
                nodes = {}
            return {
                "last_updated": str(loaded.get("last_updated", "")) if isinstance(loaded, dict) else "",
                "nodes": nodes,
            }
        except Exception:
            return {"last_updated": "", "nodes": {}}

    def diff(self, incoming_nodes: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
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
        return {
            "dirty_nodes": dirty_nodes,
            "deleted_nodes": deleted_nodes,
            "cached_graph": cached,
        }