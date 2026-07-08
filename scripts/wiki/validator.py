import json
import hashlib
from pathlib import Path
from typing import Any, Dict, List

from scripts.wiki.normalizer import section_catalog


class WikiValidator:
    def __init__(self, schema_path: Path) -> None:
        self.schema_path = schema_path
        self.allowed_sections = {section["id"] for section in section_catalog()}
        self.allowed_kinds = {
            "agent",
            "skill",
            "prompt",
            "policy",
            "project",
            "spec",
            "report",
            "capability",
        }

    def validate(self, wiki_nodes: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        errors: List[Dict[str, Any]] = []
        warnings: List[Dict[str, Any]] = []
        info: List[Dict[str, Any]] = []
        slug_registry: Dict[str, str] = {}

        if not self.schema_path.exists():
            warnings.append(self._issue("schema", "schema_missing", "Schema file not found", "warning"))

        for node_key, node in wiki_nodes.items():
            self._validate_required(node_key, node, errors)
            self._validate_kind(node_key, node, errors)
            self._validate_section(node_key, node, errors)
            self._validate_slug(node_key, node, slug_registry, errors)
            self._validate_sources(node_key, node, warnings)
            self._validate_summary(node_key, node, warnings)
            self._validate_relations(node_key, node, wiki_nodes, errors)

        quality_score = self._quality_score(total=len(wiki_nodes), errors=len(errors), warnings=len(warnings))
        info.append(self._issue("summary", "quality_score", f"quality_score={quality_score}", "info"))

        signature = hashlib.sha256(
            json.dumps(wiki_nodes, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

        return {
            "generated_at": f"sha256:{signature}",
            "schema_path": self.schema_path.as_posix(),
            "summary": {
                "node_count": len(wiki_nodes),
                "error_count": len(errors),
                "warning_count": len(warnings),
                "info_count": len(info),
                "quality_score": quality_score,
            },
            "errors": errors,
            "warnings": warnings,
            "info": info,
        }

    def write_reports(self, json_path: Path, markdown_path: Path, report: Dict[str, Any]) -> None:
        json_path.parent.mkdir(parents=True, exist_ok=True)
        with json_path.open("w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=True)

        markdown = self._render_markdown_report(report)
        with markdown_path.open("w", encoding="utf-8") as handle:
            handle.write(markdown)

    def _validate_required(self, node_key: str, node: Dict[str, Any], errors: List[Dict[str, Any]]) -> None:
        required = ["title", "slug", "kind", "summary", "source_refs", "navigation"]
        for field in required:
            value = node.get(field)
            if value in (None, "", [], {}):
                errors.append(self._issue(node_key, "required", f"Missing required field: {field}", "error"))

    def _validate_kind(self, node_key: str, node: Dict[str, Any], errors: List[Dict[str, Any]]) -> None:
        kind = str(node.get("kind", "")).strip()
        if kind and kind not in self.allowed_kinds:
            errors.append(self._issue(node_key, "kind", f"Unsupported kind: {kind}", "error"))

    def _validate_section(self, node_key: str, node: Dict[str, Any], errors: List[Dict[str, Any]]) -> None:
        navigation = node.get("navigation", {}) if isinstance(node.get("navigation", {}), dict) else {}
        section = str(navigation.get("section", "")).strip()
        if section and section not in self.allowed_sections:
            errors.append(self._issue(node_key, "section", f"Unsupported section: {section}", "error"))

    def _validate_slug(
        self,
        node_key: str,
        node: Dict[str, Any],
        slug_registry: Dict[str, str],
        errors: List[Dict[str, Any]],
    ) -> None:
        slug = str(node.get("slug", "")).strip()
        if not slug:
            return
        owner = slug_registry.get(slug)
        if owner and owner != node_key:
            errors.append(self._issue(node_key, "slug_duplicate", f"Duplicate slug: {slug}", "error"))
            return
        slug_registry[slug] = node_key

    def _validate_sources(self, node_key: str, node: Dict[str, Any], warnings: List[Dict[str, Any]]) -> None:
        source_refs = node.get("source_refs", [])
        if not isinstance(source_refs, list) or not source_refs:
            warnings.append(self._issue(node_key, "sources", "Node has no source refs", "warning"))

    def _validate_summary(self, node_key: str, node: Dict[str, Any], warnings: List[Dict[str, Any]]) -> None:
        summary = str(node.get("summary", "")).strip()
        if len(summary) < 24:
            warnings.append(self._issue(node_key, "summary", "Summary is too short", "warning"))

    def _validate_relations(
        self,
        node_key: str,
        node: Dict[str, Any],
        wiki_nodes: Dict[str, Dict[str, Any]],
        errors: List[Dict[str, Any]],
    ) -> None:
        relations = node.get("relations", [])
        if not isinstance(relations, list):
            errors.append(self._issue(node_key, "relations", "Relations must be a list", "error"))
            return

        for relation in relations:
            if not isinstance(relation, dict):
                errors.append(self._issue(node_key, "relations", "Relation must be an object", "error"))
                continue
            target = str(relation.get("target", "")).strip()
            if target and target not in wiki_nodes:
                errors.append(self._issue(node_key, "relation_target", f"Relation target not found: {target}", "error"))

    def _quality_score(self, total: int, errors: int, warnings: int) -> int:
        if total <= 0:
            return 100
        penalty = errors * 20 + warnings * 5
        score = max(0, 100 - penalty)
        return score

    def _issue(self, node: str, code: str, message: str, severity: str) -> Dict[str, str]:
        return {
            "node": node,
            "code": code,
            "severity": severity,
            "message": message,
        }

    def _render_markdown_report(self, report: Dict[str, Any]) -> str:
        summary = report.get("summary", {}) if isinstance(report.get("summary", {}), dict) else {}
        lines = [
            "# AutoDocs Validation Report",
            "",
            f"- generated_at: {report.get('generated_at', '')}",
            f"- schema_path: {report.get('schema_path', '')}",
            f"- node_count: {summary.get('node_count', 0)}",
            f"- error_count: {summary.get('error_count', 0)}",
            f"- warning_count: {summary.get('warning_count', 0)}",
            f"- quality_score: {summary.get('quality_score', 0)}",
            "",
        ]

        lines.extend(self._render_issue_block("Errors", report.get("errors", [])))
        lines.extend(self._render_issue_block("Warnings", report.get("warnings", [])))
        lines.extend(self._render_issue_block("Info", report.get("info", [])))
        return "\n".join(lines)

    def _render_issue_block(self, title: str, issues: Any) -> List[str]:
        lines = [f"## {title}", ""]
        if not isinstance(issues, list) or not issues:
            lines.append("- none")
            lines.append("")
            return lines

        for issue in issues:
            if not isinstance(issue, dict):
                continue
            lines.append(f"- [{issue.get('severity', '')}] {issue.get('node', '')}: {issue.get('message', '')}")
        lines.append("")
        return lines