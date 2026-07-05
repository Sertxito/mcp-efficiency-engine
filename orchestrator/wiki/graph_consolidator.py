import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


class GraphConsolidator:
    def __init__(self, output_graph_path: Path, markdown_output_dir: Path) -> None:
        self.output_graph_path = output_graph_path
        self.markdown_output_dir = markdown_output_dir

    def consolidate(self, provider_contracts: List[Dict[str, Any]]) -> Dict[str, Any]:
        nodes: Dict[str, Dict[str, Any]] = {}
        for contract in provider_contracts:
            provider_id = str(contract.get("provider_id", "unknown"))
            entities = contract.get("entities", [])
            if not isinstance(entities, list):
                continue

            for entity in entities:
                if not isinstance(entity, dict):
                    continue
                entity_id = str(entity.get("id", "")).strip()
                if not entity_id:
                    continue

                node_key = f"{provider_id}::{entity_id}"
                relations = self._normalize_relations(provider_id, entity.get("relations", []))
                raw_data = entity.get("raw_data", {})
                metadata = raw_data if isinstance(raw_data, dict) else {}

                nodes[node_key] = {
                    "node_id": node_key,
                    "provider": provider_id,
                    "type": str(entity.get("type", "unknown")),
                    "checksum": str(entity.get("checksum", "")),
                    "metadata": metadata,
                    "relations": relations,
                    "semantic_summary": str(metadata.get("semantic_summary", "")),
                }

        return {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "nodes": nodes,
        }

    def persist_graph(self, unified_graph: Dict[str, Any]) -> None:
        self.output_graph_path.parent.mkdir(parents=True, exist_ok=True)
        with self.output_graph_path.open("w", encoding="utf-8") as handle:
            json.dump(unified_graph, handle, indent=2, ensure_ascii=True)

    def project_dirty_nodes(self, dirty_nodes: Dict[str, Dict[str, Any]], deleted_nodes: List[str]) -> Dict[str, int]:
        self.markdown_output_dir.mkdir(parents=True, exist_ok=True)

        rendered = 0
        for node_key, node in dirty_nodes.items():
            file_path = self._node_markdown_path(node_key)
            with file_path.open("w", encoding="utf-8") as handle:
                handle.write(self._render_node_markdown(node_key, node))
            rendered += 1

        deleted = 0
        for node_key in deleted_nodes:
            file_path = self._node_markdown_path(node_key)
            if file_path.exists():
                file_path.unlink()
                deleted += 1

        return {"rendered": rendered, "deleted": deleted}

    def _normalize_relations(self, provider_id: str, relations: Any) -> List[Dict[str, str]]:
        if not isinstance(relations, list):
            return []
        normalized: List[Dict[str, str]] = []
        for relation in relations:
            if not isinstance(relation, dict):
                continue
            target = str(relation.get("target", "")).strip()
            rel_type = str(relation.get("type", "related_to")).strip() or "related_to"
            if not target:
                continue
            if "::" not in target:
                target = f"{provider_id}::{target}"
            normalized.append({"target": target, "type": rel_type})
        return normalized

    def _node_markdown_path(self, node_key: str) -> Path:
        safe_name = node_key.replace("::", "__").replace("/", "_").replace("\\", "_")
        return self.markdown_output_dir / f"{safe_name}.md"

    def _render_node_markdown(self, node_key: str, node: Dict[str, Any]) -> str:
        lines: List[str] = []
        lines.append(f"# {node_key}")
        lines.append("")
        lines.append("## Metadata")
        lines.append("")
        lines.append(f"- provider: {node.get('provider', '')}")
        lines.append(f"- type: {node.get('type', '')}")
        lines.append(f"- checksum: {node.get('checksum', '')}")
        summary = str(node.get("semantic_summary", "")).strip()
        if summary:
            lines.append(f"- semantic_summary: {summary}")
        lines.append("")

        metadata = node.get("metadata", {})
        if isinstance(metadata, dict) and metadata:
            lines.append("## Raw Data")
            lines.append("")
            lines.append("```json")
            lines.append(json.dumps(metadata, indent=2, ensure_ascii=True))
            lines.append("```")
            lines.append("")

        lines.append("## Relations")
        lines.append("")
        lines.append("| relation_type | target |")
        lines.append("|---|---|")
        for relation in node.get("relations", []):
            if not isinstance(relation, dict):
                continue
            lines.append(f"| {relation.get('type', '')} | {relation.get('target', '')} |")

        if len(lines) == 8:
            lines.append("| none | none |")

        lines.append("")
        return "\n".join(lines)