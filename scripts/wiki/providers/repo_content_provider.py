from pathlib import Path
import subprocess
from typing import Any, Dict, Iterable, List, Tuple

from scripts.wiki.providers.base_provider import BaseWikiProvider


class RepoContentProvider(BaseWikiProvider):
    provider_id = "repo-content"

    def __init__(self, repo_root: Path) -> None:
        super().__init__(repo_root)
        self.repo_root = repo_root

    def gather_knowledge(self) -> Dict[str, Any]:
        entities: List[Dict[str, Any]] = []
        entities.extend(self._collect_core_docs())
        entities.extend(self._collect_agents())
        entities.extend(self._collect_skills())
        entities.extend(self._collect_policies())
        entities.extend(self._collect_specs())
        entities.extend(self._collect_observability())
        entities.extend(self._collect_projects())
        entities.extend(self._collect_routing())
        entities.extend(self._collect_reports())
        self._enrich_relations(entities)
        return {"provider_id": self.provider_id, "entities": entities}

    def _collect_core_docs(self) -> List[Dict[str, Any]]:
        targets: List[Tuple[Path, str]] = [
            (self.repo_root / "README.md", "Guia principal del engine y sus flujos operativos."),
            (self.repo_root / "README_WIKI.md", "Guia de uso y alcance de la wiki AutoDocs del repositorio."),
            (self.repo_root / "FINAL_USAGE_GUIDE.md", "Guia de uso final con pasos operativos y buenas practicas."),
            (self.repo_root / "FILE_INDEX.md", "Indice del contenido y estructura del repositorio."),
            (self.repo_root / "autodocs" / "README.md", "Referencia de ejecucion y artefactos de AutoDocs."),
        ]

        entities: List[Dict[str, Any]] = []
        for path, fallback_summary in targets:
            if not path.exists():
                continue
            entities.append(
                self._entity_from_markdown(
                    path,
                    kind="report",
                    section="reports",
                    domain="documentation",
                    fallback_summary=fallback_summary,
                )
            )

        package_json = self.repo_root / "package.json"
        if package_json.exists():
            entities.append(
                self._entity_from_json(
                    package_json,
                    kind="report",
                    section="reports",
                    domain="packaging",
                )
            )

        return entities

    def _collect_agents(self) -> List[Dict[str, Any]]:
        agents_dir = self.repo_root / ".github" / "agents"
        if not agents_dir.exists():
            return []
        files = sorted(agents_dir.glob("*.agent.md"))
        return [self._entity_from_markdown(path, kind="agent", section="agents", domain="agents") for path in files]

    def _collect_skills(self) -> List[Dict[str, Any]]:
        skills_dir = self.repo_root / ".github" / "skills"
        if not skills_dir.exists():
            return []
        entities: List[Dict[str, Any]] = []
        for path in sorted(skills_dir.iterdir()):
            if path.is_dir():
                skill_file = path / "SKILL.md"
                if skill_file.exists():
                    entities.append(self._entity_from_markdown(skill_file, kind="skill", section="skills", domain="skills"))
            elif path.is_file() and path.suffix == ".json":
                entities.append(self._entity_from_json(path, kind="skill", section="skills", domain="skills"))
        return entities

    def _collect_policies(self) -> List[Dict[str, Any]]:
        policies_dir = self.repo_root / "policies"
        if not policies_dir.exists():
            return []
        return [
            self._entity_from_markdown(path, kind="policy", section="policies", domain="governance")
            for path in sorted(policies_dir.glob("*.md"))
        ]

    def _collect_specs(self) -> List[Dict[str, Any]]:
        specs_dir = self.repo_root / "specs"
        if not specs_dir.exists():
            return []
        return [
            self._entity_from_markdown(path, kind="spec", section="specs", domain="specifications")
            for path in sorted(specs_dir.rglob("*.md"))
        ]

    def _collect_observability(self) -> List[Dict[str, Any]]:
        observability_dir = self.repo_root / "observability"
        if not observability_dir.exists():
            return []
        entities: List[Dict[str, Any]] = []
        for path in sorted(observability_dir.glob("*.md")):
            entities.append(self._entity_from_markdown(path, kind="report", section="observability", domain="observability"))
        for path in sorted(observability_dir.glob("*.json")):
            entities.append(self._entity_from_json(path, kind="report", section="observability", domain="observability"))
        return entities

    def _collect_projects(self) -> List[Dict[str, Any]]:
        projects_dir = self.repo_root / "projects"
        if not projects_dir.exists():
            return []
        entities: List[Dict[str, Any]] = []
        for path in sorted(projects_dir.iterdir()):
            if not path.is_dir():
                continue
            if not self._is_tracked(path):
                continue
            summary = f"Espacio de proyecto interno ubicado en {self._relative(path)}."
            payload = {
                "title": path.name,
                "slug": self._slug_for("project", path),
                "kind": "project",
                "section": "projects",
                "domain": "projects",
                "summary": summary,
                "owner": "repo",
                "source_refs": [self._relative(path)],
                "tags": ["project", "workspace"],
            }
            entities.append(self._entity(path.name, payload))
        return entities

    def _collect_routing(self) -> List[Dict[str, Any]]:
        targets: List[Tuple[Path, str]] = [
            (self.repo_root / "AGENTS.md", "Contrato global de routing y seleccion de motores."),
            (self.repo_root / "ARCHITECTURE.md", "Vista de arquitectura y flujo de agentes y motores."),
            (self.repo_root / "autodocs" / "site" / "guides" / "03-mcp-routing-guide.md", "Guia de routing corporativo del sistema."),
            (self.repo_root / "orchestrator" / "router.md", "Contrato operativo del router."),
            (self.repo_root / "orchestrator" / "corporate-routing.md", "Reglas corporativas de routing."),
            (self.repo_root / "orchestrator" / "decision-matrix.md", "Matriz de decision de routing."),
            (self.repo_root / "orchestrator" / "fallback.md", "Estrategias de fallback de routing."),
        ]
        entities: List[Dict[str, Any]] = []
        for path, fallback_summary in targets:
            if not path.exists():
                continue
            entities.append(
                self._entity_from_markdown(
                    path,
                    kind="report",
                    section="routing",
                    domain="routing",
                    fallback_summary=fallback_summary,
                )
            )
        return entities

    def _collect_reports(self) -> List[Dict[str, Any]]:
        reports_dir = self.repo_root / "autodocs" / "analysis_mcpee"
        if not reports_dir.exists():
            return []
        entities: List[Dict[str, Any]] = []
        for path in sorted(reports_dir.iterdir()):
            if path.suffix == ".md":
                entities.append(self._entity_from_markdown(path, kind="report", section="reports", domain="autodocs"))
            elif path.suffix == ".json":
                entities.append(self._entity_from_json(path, kind="report", section="reports", domain="autodocs"))
        return entities

    def _entity_from_markdown(
        self,
        path: Path,
        kind: str,
        section: str,
        domain: str,
        fallback_summary: str = "",
    ) -> Dict[str, Any]:
        content = path.read_text(encoding="utf-8")
        title = self._extract_title(content) or path.stem
        summary = self._extract_summary(content) or fallback_summary or f"Contenido {kind} en {self._relative(path)}."
        payload = {
            "title": title,
            "slug": self._slug_for(kind, path),
            "kind": kind,
            "section": section,
            "domain": domain,
            "summary": self._normalize_summary(summary, fallback_summary or f"Contenido {kind} en {self._relative(path)}."),
            "owner": self._owner_for(path),
            "source_refs": [self._relative(path)],
            "tags": [kind, section, domain],
        }
        return self._entity(self._relative(path), payload)

    def _entity_from_json(self, path: Path, kind: str, section: str, domain: str) -> Dict[str, Any]:
        payload_json = self._load_json_file(path)
        title = str(payload_json.get("name") or payload_json.get("title") or path.stem)
        summary = str(payload_json.get("description") or f"Artefacto JSON de tipo {kind} en {self._relative(path)}.")
        payload = {
            "title": title,
            "slug": self._slug_for(kind, path),
            "kind": kind,
            "section": section,
            "domain": domain,
            "summary": self._normalize_summary(summary, f"Artefacto JSON de tipo {kind} en {self._relative(path)}."),
            "owner": self._owner_for(path),
            "source_refs": [self._relative(path)],
            "tags": [kind, section, domain, "json"],
        }
        return self._entity(self._relative(path), payload)

    def _entity(self, entity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        relations = list(payload.get("relations", [])) if isinstance(payload.get("relations", []), list) else []
        checksum_payload = {
            "payload": payload,
            "relations": relations,
        }
        return {
            "id": entity_id,
            "type": payload.get("kind", "report"),
            "checksum": self._checksum(checksum_payload),
            "raw_data": payload,
            "relations": relations,
        }

    def _enrich_relations(self, entities: List[Dict[str, Any]]) -> None:
        if not entities:
            return

        entities_by_id = {
            str(entity.get("id", "")): entity
            for entity in entities
            if isinstance(entity, dict) and str(entity.get("id", "")).strip()
        }

        for entity in entities:
            if not isinstance(entity, dict):
                continue
            raw_data = entity.get("raw_data", {}) if isinstance(entity.get("raw_data", {}), dict) else {}
            kind = str(raw_data.get("kind", "")).strip()
            source_refs = raw_data.get("source_refs", []) if isinstance(raw_data.get("source_refs", []), list) else []
            source_ref = str(source_refs[0]) if source_refs else ""
            title = str(raw_data.get("title", "")).strip().lower()

            if kind == "agent":
                self._relate_agent(entity, entities_by_id, title)
            elif kind == "skill":
                self._relate_skill(entity, entities_by_id, source_ref)
            elif kind == "policy":
                self._relate_policy(entity, entities_by_id, source_ref)
            elif kind == "spec":
                self._relate_spec(entity, entities_by_id, source_ref)
            elif kind == "report":
                self._relate_report(entity, entities_by_id, source_ref)
            elif kind == "project":
                self._relate_project(entity, entities_by_id, title)

    def _relate_agent(self, entity: Dict[str, Any], entities_by_id: Dict[str, Dict[str, Any]], title: str) -> None:
        skill_map = {
            "backend": ".github/skills/backend-coding/SKILL.md",
            "frontend-agent": ".github/skills/frontend-coding/SKILL.md",
            "dba": ".github/skills/database-analysis/SKILL.md",
            "iot": ".github/skills/iot-architecture/SKILL.md",
            "legacy": ".github/skills/legacy-migration/SKILL.md",
            "rag-local": ".github/skills/rag-knowledge/SKILL.md",
            "rag-azure": ".github/skills/azure-rag-enterprise/SKILL.md",
            "community-manager": ".github/skills/community-content/SKILL.md",
            "ux-ui": ".github/skills/ux-ui-governance/SKILL.md",
            "wiki": ".github/skills/wiki-tools.json",
        }
        for needle, target_id in skill_map.items():
            if needle in title and target_id in entities_by_id:
                self._add_relation(entity, target_id, "uses_skill")

        shared_targets = [
            ".github/skills/token-saver/SKILL.md",
            ".github/skills/caveman-mode/SKILL.md",
            "AGENTS.md",
            "ARCHITECTURE.md",
        ]
        for target_id in shared_targets:
            if target_id in entities_by_id:
                relation_type = "follows" if target_id.endswith(".md") else "uses_skill"
                self._add_relation(entity, target_id, relation_type)

    def _relate_skill(self, entity: Dict[str, Any], entities_by_id: Dict[str, Dict[str, Any]], source_ref: str) -> None:
        if source_ref == ".github/skills/token-saver/SKILL.md":
            for target_id in ["specs/optimization.spec.md", "observability/metrics.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "supports")
        if source_ref == ".github/skills/caveman-mode/SKILL.md":
            for target_id in ["specs/optimization.spec.md", "observability/metrics.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "supports")
        if source_ref == ".github/skills/wiki-tools.json":
            for target_id in ["README_WIKI.md", "autodocs/README.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "documents")

    def _relate_policy(self, entity: Dict[str, Any], entities_by_id: Dict[str, Dict[str, Any]], source_ref: str) -> None:
        policy_to_spec = {
            "policies/security-policy.md": "specs/security.spec.md",
            "policies/context-policy.md": "specs/routing.spec.md",
            "policies/repo-intake-policy.md": "specs/repo-intake.spec.md",
            "policies/cost-policy.md": "specs/optimization.spec.md",
        }
        target_id = policy_to_spec.get(source_ref)
        if target_id and target_id in entities_by_id:
            self._add_relation(entity, target_id, "governs")

    def _relate_spec(self, entity: Dict[str, Any], entities_by_id: Dict[str, Dict[str, Any]], source_ref: str) -> None:
        if source_ref == "specs/routing.spec.md":
            for target_id in ["AGENTS.md", "orchestrator/router.md", "orchestrator/corporate-routing.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "defines")
        if source_ref == "specs/observability.spec.md":
            for target_id in ["observability/metrics.md", "observability/routing-evaluator.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "defines")

    def _relate_report(self, entity: Dict[str, Any], entities_by_id: Dict[str, Dict[str, Any]], source_ref: str) -> None:
        if source_ref == "ARCHITECTURE.md":
            for target_id in ["AGENTS.md", "orchestrator/router.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "explains")
        if source_ref == "README.md":
            for target_id in ["AGENTS.md", "ARCHITECTURE.md", "FINAL_USAGE_GUIDE.md", "package.json"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "documents")
        if source_ref == "FINAL_USAGE_GUIDE.md":
            for target_id in ["README.md", "scripts/README.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "extends")
        if source_ref == "autodocs/README.md":
            for target_id in ["README_WIKI.md", "scripts/wiki/wiki_compiler.py"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "documents")
        if source_ref == "autodocs/analysis_mcpee/OPENWIKI_INTERNAL_BLUEPRINT.md":
            for target_id in ["autodocs/README.md", "README_WIKI.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "drives")
        if source_ref == "observability/metrics.md":
            target_id = "specs/observability.spec.md"
            if target_id in entities_by_id:
                self._add_relation(entity, target_id, "implements")

    def _relate_project(self, entity: Dict[str, Any], entities_by_id: Dict[str, Dict[str, Any]], title: str) -> None:
        if title == "techriders":
            for target_id in ["specs/architecture.spec.md", "specs/observability.spec.md"]:
                if target_id in entities_by_id:
                    self._add_relation(entity, target_id, "consumes")

    def _add_relation(self, entity: Dict[str, Any], target_id: str, relation_type: str) -> None:
        relations = entity.get("relations", [])
        if not isinstance(relations, list):
            relations = []
            entity["relations"] = relations

        for relation in relations:
            if not isinstance(relation, dict):
                continue
            if str(relation.get("target", "")) == target_id and str(relation.get("type", "")) == relation_type:
                return

        relations.append({"target": target_id, "type": relation_type})

    def _extract_title(self, content: str) -> str:
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                return stripped.lstrip("#").strip()
        return ""

    def _extract_summary(self, content: str) -> str:
        lines = [line.strip() for line in content.splitlines()]
        in_fence = False
        for index, line in enumerate(lines):
            if line.startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            if not line or line.startswith("#"):
                continue
            if line.startswith("<!--"):
                continue
            if line.startswith("-") or line.startswith("1."):
                continue
            if line.startswith("|") or line.endswith(":"):
                continue
            next_line = lines[index + 1] if index + 1 < len(lines) else ""
            if next_line.startswith("```") or next_line.startswith("|") or next_line.startswith("<!--"):
                next_line = ""
            if next_line and not next_line.startswith("#"):
                return f"{line} {next_line}".strip()
            return line
        return ""

    def _normalize_summary(self, summary: str, fallback: str) -> str:
        normalized = summary.strip()
        if len(normalized) < 24:
            return fallback
        return normalized

    def _slug_for(self, kind: str, path: Path) -> str:
        relative = self._relative(path)
        stem = path.name
        if path.name.lower() == "skill.md" and path.parent.name:
            stem = path.parent.name
        elif path.stem.lower() == "readme" and path.parent != self.repo_root:
            stem = f"{path.parent.name}-{path.name}"
        tokens = [kind, stem]
        if kind == "report" and "analysis_mcpee" in relative:
            tokens.insert(1, "autodocs")
        return self._slugify("-".join(tokens))

    def _slugify(self, value: str) -> str:
        normalized = []
        for char in value.lower():
            if char.isalnum():
                normalized.append(char)
            else:
                normalized.append("-")
        slug = "".join(normalized)
        while "--" in slug:
            slug = slug.replace("--", "-")
        return slug.strip("-") or "untitled"

    def _relative(self, path: Path) -> str:
        return path.relative_to(self.repo_root).as_posix()

    def _is_tracked(self, path: Path) -> bool:
        rel = self._relative(path)
        if not rel:
            return False
        try:
            result = subprocess.run(
                ["git", "ls-files", "--error-unmatch", rel],
                cwd=self.repo_root,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            return result.returncode == 0
        except OSError:
            return False

    def _owner_for(self, path: Path) -> str:
        relative = self._relative(path)
        parts = [segment for segment in relative.split("/") if segment]
        if len(parts) <= 1:
            return "repo"
        return parts[-2]