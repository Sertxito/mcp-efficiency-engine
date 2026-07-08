import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from scripts.wiki.normalizer import normalize_node, section_catalog


SECTIONS = section_catalog()


class GraphConsolidator:
    def __init__(self, output_graph_path: Path, markdown_output_dir: Path) -> None:
        self.output_graph_path = output_graph_path
        self.markdown_output_dir = markdown_output_dir
        self.generated_output_dir = output_graph_path.parent

    def consolidate(self, provider_contracts: List[Dict[str, Any]]) -> Dict[str, Any]:
        raw_nodes: Dict[str, Dict[str, Any]] = {}
        wiki_nodes: Dict[str, Dict[str, Any]] = {}
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

                raw_node = {
                    "node_id": node_key,
                    "provider": provider_id,
                    "type": str(entity.get("type", "unknown")),
                    "checksum": str(entity.get("checksum", "")),
                    "metadata": metadata,
                    "relations": relations,
                    "semantic_summary": str(metadata.get("semantic_summary", "")),
                }
                raw_nodes[node_key] = raw_node
                wiki_nodes[node_key] = normalize_node(node_key, raw_node)

        navigation_tree = self._build_navigation_tree(wiki_nodes)
        search_index = self._build_search_index(wiki_nodes)
        relations_index = self._build_relations_index(wiki_nodes)
        section_manifest = self._build_section_manifest(wiki_nodes)

        return {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "nodes": wiki_nodes,
            "raw_nodes": raw_nodes,
            "wiki_nodes": wiki_nodes,
            "navigation_tree": navigation_tree,
            "search_index": search_index,
            "relations_index": relations_index,
            "section_manifest": section_manifest,
        }

    def persist_graph(self, unified_graph: Dict[str, Any]) -> None:
        self.output_graph_path.parent.mkdir(parents=True, exist_ok=True)
        with self.output_graph_path.open("w", encoding="utf-8") as handle:
            json.dump(unified_graph, handle, indent=2, ensure_ascii=True)

    def persist_manifests(self, unified_graph: Dict[str, Any]) -> Dict[str, int]:
        self.generated_output_dir.mkdir(parents=True, exist_ok=True)
        artifacts = {
            "search-index.json": unified_graph.get("search_index", []),
            "relations-index.json": unified_graph.get("relations_index", []),
            "section-manifest.json": unified_graph.get("section_manifest", []),
            "navigation-tree.json": unified_graph.get("navigation_tree", {}),
        }
        for file_name, payload in artifacts.items():
            output_path = self.generated_output_dir / file_name
            with output_path.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=True)
        return {"manifests": len(artifacts)}

    def project_dirty_nodes(
        self,
        dirty_nodes: Dict[str, Dict[str, Any]],
        deleted_nodes: List[str],
        all_nodes: Dict[str, Dict[str, Any]],
        cached_nodes: Dict[str, Dict[str, Any]],
    ) -> Dict[str, int]:
        self.markdown_output_dir.mkdir(parents=True, exist_ok=True)

        rendered = 0
        for node_key, node in dirty_nodes.items():
            previous_node = cached_nodes.get(node_key)
            if isinstance(previous_node, dict):
                previous_path = self._node_markdown_path(previous_node)
                next_path = self._node_markdown_path(node)
                if previous_path != next_path and previous_path.exists():
                    previous_path.unlink()

            file_path = self._node_markdown_path(node)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            with file_path.open("w", encoding="utf-8") as handle:
                handle.write(self._render_node_markdown(node_key, node, all_nodes))
            rendered += 1

        deleted = 0
        for node_key in deleted_nodes:
            cached_node = cached_nodes.get(node_key)
            if not isinstance(cached_node, dict):
                continue
            file_path = self._node_markdown_path(cached_node)
            if file_path.exists():
                file_path.unlink()
                deleted += 1

        indexes = self._render_index_pages(all_nodes)
        return {
            "rendered": rendered,
            "deleted": deleted,
            "indexes": indexes,
            "manifests": 4,
        }

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

    def _node_markdown_path(self, node: Dict[str, Any]) -> Path:
        navigation = node.get("navigation", {}) if isinstance(node.get("navigation", {}), dict) else {}
        section = str(navigation.get("section", "misc")).strip() or "misc"
        slug = str(node.get("slug", "untitled")).strip() or "untitled"
        return self.markdown_output_dir / section / f"{slug}.md"

    def _render_node_markdown(
        self,
        node_key: str,
        node: Dict[str, Any],
        all_nodes: Dict[str, Dict[str, Any]],
    ) -> str:
        lines: List[str] = []
        lines.append(f"# {node.get('title', node_key)}")
        lines.append("")
        summary = str(node.get("summary", "")).strip()
        if summary:
            lines.append(summary)
            lines.append("")

        lines.append("## Contexto")
        lines.append("")
        lines.append(f"- kind: {node.get('kind', '')}")
        lines.append(f"- domain: {node.get('domain', '')}")
        lines.append(f"- section: {node.get('navigation', {}).get('section', '')}")
        lines.append(f"- provider: {node.get('provider', '')}")
        lines.append(f"- checksum: {node.get('checksum', '')}")

        owner = str(node.get("owner", "")).strip()
        if owner:
            lines.append(f"- owner: {owner}")

        tags = node.get("tags", [])
        if isinstance(tags, list) and tags:
            lines.append(f"- tags: {', '.join(str(tag) for tag in tags)}")

        lines.append("")

        lines.append("## Navegacion")
        lines.append("")
        section = str(node.get("navigation", {}).get("section", "misc"))
        lines.append(f"- section_index: [{section}](index.md)")
        lines.append(f"- wiki_home: [autodocs](../index.md)")
        sibling_links = self._sibling_links(node, all_nodes)
        if sibling_links:
            lines.append(f"- related_in_section: {', '.join(sibling_links)}")
        lines.append("")

        lines.append("## Fuentes")
        lines.append("")
        source_refs = node.get("source_refs", [])
        if isinstance(source_refs, list) and source_refs:
            current_path = self._node_markdown_path(node)
            for source_ref in source_refs:
                target_path = self.output_graph_path.parents[1] / str(source_ref)
                relative = os.path.relpath(target_path, current_path.parent).replace("\\", "/")
                lines.append(f"- [{source_ref}]({relative})")
        else:
            lines.append("- none")

        lines.append("")
        lines.append("## Relaciones")
        lines.append("")
        lines.append("| relation_type | target |")
        lines.append("|---|---|")

        relation_count = 0
        for relation in node.get("relations", []):
            if not isinstance(relation, dict):
                continue
            target_key = str(relation.get("target", "")).strip()
            if not target_key:
                continue

            relation_count += 1
            relation_type = str(relation.get("type", "related_to")).strip() or "related_to"
            target_node = all_nodes.get(target_key)

            if isinstance(target_node, dict):
                current_path = self._node_markdown_path(node)
                target_path = self._node_markdown_path(target_node)
                relative = os.path.relpath(target_path, current_path.parent).replace("\\", "/")
                target_title = str(target_node.get("title", target_key))
                lines.append(f"| {relation_type} | [{target_title}]({relative}) |")
            else:
                lines.append(f"| {relation_type} | {target_key} |")

        if relation_count == 0:
            lines.append("| none | none |")

        metadata = node.get("metadata", {}) if isinstance(node.get("metadata", {}), dict) else {}
        if metadata:
            lines.append("")
            lines.append("## Datos tecnicos")
            lines.append("")
            lines.append("<details>")
            lines.append("<summary>Ver payload normalizado</summary>")
            lines.append("")
            lines.append("```json")
            lines.append(json.dumps(metadata, indent=2, ensure_ascii=True))
            lines.append("```")
            lines.append("</details>")
            lines.append("")

        return "\n".join(lines)

    def _build_navigation_tree(self, wiki_nodes: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        sections = []
        for section in SECTIONS:
            section_id = section["id"]
            pages = [
                {
                    "title": node.get("title", ""),
                    "slug": node.get("slug", ""),
                    "path": node.get("path", ""),
                }
                for node in wiki_nodes.values()
                if node.get("navigation", {}).get("section") == section_id
            ]
            pages.sort(key=lambda item: item["title"])
            sections.append(
                {
                    "id": section_id,
                    "title": section["title"],
                    "description": section["description"],
                    "page_count": len(pages),
                    "pages": pages,
                }
            )
        return {"sections": sections}

    def _build_search_index(self, wiki_nodes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        entries = []
        for node in wiki_nodes.values():
            entries.append(
                {
                    "title": node.get("title", ""),
                    "summary": node.get("summary", ""),
                    "kind": node.get("kind", ""),
                    "domain": node.get("domain", ""),
                    "section": node.get("navigation", {}).get("section", ""),
                    "tags": node.get("tags", []),
                    "path": node.get("path", ""),
                }
            )
        entries.sort(key=lambda item: (str(item.get("section", "")), str(item.get("title", ""))))
        return entries

    def _build_relations_index(self, wiki_nodes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        edges: List[Dict[str, Any]] = []
        for node_key, node in wiki_nodes.items():
            for relation in node.get("relations", []):
                if not isinstance(relation, dict):
                    continue
                edges.append(
                    {
                        "source": node_key,
                        "source_title": node.get("title", node_key),
                        "type": relation.get("type", "related_to"),
                        "target": relation.get("target", ""),
                    }
                )
        edges.sort(key=lambda item: (str(item.get("type", "")), str(item.get("source_title", ""))))
        return edges

    def _build_section_manifest(self, wiki_nodes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        manifests: List[Dict[str, Any]] = []
        for section in SECTIONS:
            section_id = section["id"]
            pages = [
                node.get("path", "")
                for node in wiki_nodes.values()
                if node.get("navigation", {}).get("section") == section_id
            ]
            pages.sort()
            manifests.append(
                {
                    "id": section_id,
                    "title": section["title"],
                    "description": section["description"],
                    "page_count": len(pages),
                    "pages": pages,
                }
            )
        return manifests

    def _render_index_pages(self, wiki_nodes: Dict[str, Dict[str, Any]]) -> int:
        count = 0
        self.markdown_output_dir.mkdir(parents=True, exist_ok=True)

        root_index = self.markdown_output_dir / "index.md"
        with root_index.open("w", encoding="utf-8") as handle:
            handle.write(self._render_root_index(wiki_nodes))
        count += 1

        for section in SECTIONS:
            section_dir = self.markdown_output_dir / section["id"]
            section_dir.mkdir(parents=True, exist_ok=True)
            section_index = section_dir / "index.md"
            with section_index.open("w", encoding="utf-8") as handle:
                handle.write(self._render_section_index(section, wiki_nodes))
            count += 1

        return count

    def _render_root_index(self, wiki_nodes: Dict[str, Dict[str, Any]]) -> str:
        top_sections = self._top_sections(wiki_nodes, limit=4)
        featured_pages = self._featured_pages(wiki_nodes, limit=8)
        lines = [
            "# AutoDocs",
            "",
            "Wiki interna de MCP Efficiency Engine. El source of truth es el grafo",
            "unificado y el Markdown es una proyeccion derivada para lectura humana.",
            "",
            "## Resumen",
            "",
            f"- total_pages: {len(wiki_nodes)}",
            f"- generated_graph: {self.output_graph_path.as_posix().replace(str(self.output_graph_path.parents[1]).replace('\\', '/'), 'autodocs') if False else 'autodocs/generated/unified-graph.json'}",
            f"- search_manifest: autodocs/generated/search-index.json",
            f"- validation_report: autodocs/generated/validation-report.md",
            "",
            "## Entry Points",
            "",
        ]

        for section_id, page_count in top_sections:
            section = next((item for item in SECTIONS if item["id"] == section_id), None)
            if not section:
                continue
            lines.append(f"- [{section['title']}]({section_id}/index.md) - {page_count} paginas")

        lines.extend([
            "",
            "## Destacados",
            "",
        ])

        for page in featured_pages:
            lines.append(
                f"- [{page.get('title', '')}]({page.get('path', '')}) - {page.get('summary', '')}"
            )

        lines.extend([
            "",
            "## Secciones",
            "",
            "| section | description | pages |",
            "|---|---|---|",
        ])

        for section in SECTIONS:
            page_count = sum(
                1
                for node in wiki_nodes.values()
                if node.get("navigation", {}).get("section") == section["id"]
            )
            lines.append(
                f"| [{section['title']}]({section['id']}/index.md) | {section['description']} | {page_count} |"
            )

        lines.append("")
        return "\n".join(lines)

    def _render_section_index(self, section: Dict[str, str], wiki_nodes: Dict[str, Dict[str, Any]]) -> str:
        pages = [
            node
            for node in wiki_nodes.values()
            if node.get("navigation", {}).get("section") == section["id"]
        ]
        pages.sort(key=lambda item: str(item.get("title", "")))

        lines = [
            f"# {section['title']}",
            "",
            section["description"],
            "",
            "[Volver a AutoDocs](../index.md)",
            "",
        ]

        if not pages:
            lines.append("Sin contenido proyectado todavia.")
            lines.append("")
            return "\n".join(lines)

        lines.append("## Resumen")
        lines.append("")
        lines.append(f"- total_pages: {len(pages)}")
        domain_counts = self._domain_counts(pages)
        if domain_counts:
            lines.append(
                "- domains: " + ", ".join(f"{domain} ({count})" for domain, count in domain_counts)
            )
        lines.append("")

        lines.append("## Paginas")
        lines.append("")

        for page in pages:
            page_path = Path(str(page.get("path", ""))).name
            lines.append(f"- [{page.get('title', '')}]({page_path}) - {page.get('summary', '')}")

        lines.append("")
        return "\n".join(lines)

    def _top_sections(self, wiki_nodes: Dict[str, Dict[str, Any]], limit: int) -> List[tuple[str, int]]:
        counts = []
        for section in SECTIONS:
            page_count = sum(
                1
                for node in wiki_nodes.values()
                if node.get("navigation", {}).get("section") == section["id"]
            )
            if page_count > 0:
                counts.append((section["id"], page_count))
        counts.sort(key=lambda item: (-item[1], item[0]))
        return counts[:limit]

    def _featured_pages(self, wiki_nodes: Dict[str, Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
        preferred_sections = ["routing", "agents", "skills", "policies", "specs", "observability", "reports"]
        featured: List[Dict[str, Any]] = []
        for section_id in preferred_sections:
            candidates = [
                node
                for node in wiki_nodes.values()
                if node.get("navigation", {}).get("section") == section_id
            ]
            candidates.sort(key=lambda item: str(item.get("title", "")))
            if candidates:
                featured.append(candidates[0])
            if len(featured) >= limit:
                break
        return featured[:limit]

    def _domain_counts(self, pages: List[Dict[str, Any]]) -> List[tuple[str, int]]:
        counts: Dict[str, int] = {}
        for page in pages:
            domain = str(page.get("domain", "unknown")).strip() or "unknown"
            counts[domain] = counts.get(domain, 0) + 1
        ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        return ordered[:6]

    def _sibling_links(self, node: Dict[str, Any], all_nodes: Dict[str, Dict[str, Any]]) -> List[str]:
        section = str(node.get("navigation", {}).get("section", "misc"))
        current_path = self._node_markdown_path(node)
        siblings = [
            candidate
            for candidate in all_nodes.values()
            if candidate.get("navigation", {}).get("section") == section and candidate.get("slug") != node.get("slug")
        ]
        siblings.sort(key=lambda item: str(item.get("title", "")))
        links: List[str] = []
        for sibling in siblings[:3]:
            sibling_path = self._node_markdown_path(sibling)
            relative = os.path.relpath(sibling_path, current_path.parent).replace("\\", "/")
            links.append(f"[{sibling.get('title', '')}]({relative})")
        return links