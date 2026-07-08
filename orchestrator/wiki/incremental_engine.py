import json
from pathlib import Path
from typing import Any, Dict


class IncrementalEngine:
    def __init__(self, cache_path: Path) -> None:
        self.cache_path = cache_path

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