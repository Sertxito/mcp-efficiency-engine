import re
from typing import Any, Dict, List


_SECTION_CATALOG = [
    {
        "id": "capabilities",
        "title": "Capabilities",
        "description": "Capacidades operativas e integraciones disponibles en el motor.",
    },
    {
        "id": "agents",
        "title": "Agents",
        "description": "Agentes y sus responsabilidades dentro del sistema.",
    },
    {
        "id": "skills",
        "title": "Skills",
        "description": "Skills, comandos y utilidades operativas consumibles por agentes.",
    },
    {
        "id": "routing",
        "title": "Routing",
        "description": "Reglas de orquestacion y decisiones de enrutado.",
    },
    {
        "id": "projects",
        "title": "Projects",
        "description": "Proyectos o dominios servidos por MCP Efficiency Engine.",
    },
    {
        "id": "policies",
        "title": "Policies",
        "description": "Politicas y contratos operativos del repositorio.",
    },
    {
        "id": "specs",
        "title": "Specs",
        "description": "Especificaciones tecnicas y contratos declarativos.",
    },
    {
        "id": "observability",
        "title": "Observability",
        "description": "Telemetria, metricas y reportes del sistema.",
    },
    {
        "id": "reports",
        "title": "Reports",
        "description": "Reportes generados y artefactos de analisis.",
    },
    {
        "id": "misc",
        "title": "Misc",
        "description": "Contenido no clasificado o pendiente de taxonomy.",
    },
]


def section_catalog() -> List[Dict[str, str]]:
    return list(_SECTION_CATALOG)


def normalize_node(node_key: str, raw_node: Dict[str, Any]) -> Dict[str, Any]:
    metadata = raw_node.get("metadata", {}) if isinstance(raw_node.get("metadata", {}), dict) else {}
    capability = metadata.get("capability", {}) if isinstance(metadata.get("capability", {}), dict) else {}
    manifest = metadata.get("manifest", {}) if isinstance(metadata.get("manifest", {}), dict) else {}
    explicit_title = str(metadata.get("title") or "").strip()
    explicit_slug = str(metadata.get("slug") or "").strip()
    explicit_kind = str(metadata.get("kind") or "").strip()
    explicit_section = str(metadata.get("section") or "").strip()
    explicit_summary = str(metadata.get("summary") or "").strip()
    explicit_domain = str(metadata.get("domain") or "").strip()
    explicit_owner = str(metadata.get("owner") or "").strip()
    explicit_tags = metadata.get("tags", []) if isinstance(metadata.get("tags", []), list) else []
    explicit_sources = metadata.get("source_refs", []) if isinstance(metadata.get("source_refs", []), list) else []

    repo = str(capability.get("repo") or manifest.get("repo") or metadata.get("boost") or node_key)
    provider = str(raw_node.get("provider", "unknown"))
    kind = explicit_kind or _normalize_kind(raw_node, capability, manifest)
    domain = explicit_domain or str(capability.get("domain") or manifest.get("domain") or provider or "unknown")
    agent = str(capability.get("agent") or manifest.get("agent") or "")
    engine = str(capability.get("engine") or manifest.get("engine") or provider)
    title = explicit_title or repo
    section = explicit_section or _section_for_kind(kind)
    slug = explicit_slug or _slugify(f"{provider}-{repo}")
    boost = str(metadata.get("boost") or repo)
    source_refs = explicit_sources or _source_refs(boost)
    tags = explicit_tags or _tags(provider=provider, domain=domain, kind=kind, engine=engine, agent=agent)

    summary = explicit_summary or _summary_for_node(
        title=title,
        kind=kind,
        domain=domain,
        provider=provider,
        capability=capability,
        manifest=manifest,
        agent=agent,
        engine=engine,
    )

    wiki_node = {
        "node_id": node_key,
        "provider": provider,
        "type": str(raw_node.get("type", "unknown")),
        "checksum": str(raw_node.get("checksum", "")),
        "title": title,
        "slug": slug,
        "kind": kind,
        "domain": domain,
        "owner": explicit_owner or agent,
        "summary": summary,
        "source_refs": source_refs,
        "relations": raw_node.get("relations", []),
        "tags": tags,
        "path": f"{section}/{slug}.md",
        "navigation": {
            "section": section,
            "weight": 100,
            "parent": section,
            "tags": tags,
        },
        "quality": {
            "has_summary": bool(summary.strip()),
            "has_relations": bool(raw_node.get("relations", [])),
            "has_sources": bool(source_refs),
        },
        "metadata": metadata,
    }
    return wiki_node


def _normalize_kind(raw_node: Dict[str, Any], capability: Dict[str, Any], manifest: Dict[str, Any]) -> str:
    raw_type = str(raw_node.get("type", "unknown")).strip().lower()
    if raw_type == "boost_capability":
        return "capability"

    source_type = str(manifest.get("type", "")).strip().lower()
    if source_type == "project":
        return "project"

    if capability:
        return "capability"

    return "report"


def _section_for_kind(kind: str) -> str:
    mapping = {
        "agent": "agents",
        "skill": "skills",
        "prompt": "routing",
        "policy": "policies",
        "project": "projects",
        "spec": "specs",
        "report": "reports",
        "capability": "capabilities",
    }
    return mapping.get(kind, "misc")


def _source_refs(boost: str) -> List[str]:
    return [
        f"repo-intake/generated/{boost}/capabilities/capability.json",
        f"repo-intake/generated/{boost}/context-manifests/manifest.json",
    ]


def _tags(provider: str, domain: str, kind: str, engine: str, agent: str) -> List[str]:
    values = [provider, domain, kind, engine, agent]
    tags = []
    for value in values:
        normalized = str(value).strip().lower()
        if normalized and normalized not in tags:
            tags.append(normalized)
    return tags


def _summary_for_node(
    title: str,
    kind: str,
    domain: str,
    provider: str,
    capability: Dict[str, Any],
    manifest: Dict[str, Any],
    agent: str,
    engine: str,
) -> str:
    capability_name = str(capability.get("capability") or "").strip()
    if kind == "capability":
        base = f"{title} expone una capacidad del dominio {domain}"
        if capability_name:
            base += f" llamada {capability_name}"
        if agent:
            base += f", servida por el agente {agent}"
        if engine:
            base += f" sobre {engine}"
        return base + "."

    manifest_repo = str(manifest.get("repo") or title)
    return f"{manifest_repo} se proyecta en AutoDocs como contenido de tipo {kind} del dominio {domain} a traves del proveedor {provider}."


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    normalized = normalized.strip("-")
    return normalized or "untitled"