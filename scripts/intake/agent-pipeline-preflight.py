from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


REQUIRED_AGENT_ALIASES: dict[str, list[str]] = {
    "backend": ["backend", "dev-agent"],
    "frontend": ["frontend-agent"],
    "legacy": ["legacy", "legacy-agent"],
    "dba": ["dba", "dba-agent"],
    "rag-local": ["rag-local", "rag-local-agent"],
    "rag-azure": ["rag-azure", "rag-azure-agent"],
    "iot": ["iot", "iot-agent"],
    "ux-ui": ["ux-ui", "ux-ui-agent"],
    "community-manager": ["community-manager", "community-manager-agent"],
    "snapshot": ["snapshot", "snapshot-agent"],
}

AGENT_TEMPLATE: dict[str, str] = {
    "backend": "Modern development tasks on a single repository.",
    "frontend-agent": "Frontend development tasks on a single repository.",
    "legacy": "Legacy/migration and multi-repo impact analysis.",
    "dba": "SQL/schema/procedure and DBA analysis.",
    "rag-local": "Local technical docs and knowledge retrieval.",
    "rag-azure": "Corporate docs with mandatory evidence.",
    "iot": "IoT/edge/telemetry mixed code+docs workflow.",
    "ux-ui": "UX/UI governance and design-intent control workflow.",
    "community-manager": "Education/posts/storytelling from grounded knowledge.",
    "snapshot": "Portable scope-safe context export.",
}


def load_registry(path: Path) -> dict[str, Any]:
    content = path.read_text(encoding="utf-8")
    if content.lstrip().startswith("{"):
        return json.loads(content)
    raise ValueError("repo-registry/repos.yml must be JSON-first in this repository")


def write_agent_template(agent_name: str, path: Path) -> None:
    desc = AGENT_TEMPLATE.get(agent_name, "Specialized agent definition.")
    body = (
        f"# {agent_name}\n\n"
        "## Purpose\n\n"
        f"{desc}\n\n"
        "## Pipeline\n\n"
        "1. Memory-first selection.\n"
        "1. Route by intent/domain/source.\n"
        "1. Apply always-on optimization.\n"
        "1. Register feedback into AutoLearning.\n"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate agent -> skills -> boost pipeline prerequisites.")
    parser.add_argument("--registry", default="repo-registry/repos.yml")
    parser.add_argument("--agents-dir", default=".github/agents")
    parser.add_argument("--generated-root", default="repo-intake/generated")
    parser.add_argument("--create-missing-templates", action="store_true")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    registry_path = (repo_root / args.registry).resolve()
    agents_dir = (repo_root / args.agents_dir).resolve()
    generated_root = (repo_root / args.generated_root).resolve()

    registry = load_registry(registry_path)
    repos = registry.get("repos", []) if isinstance(registry.get("repos", []), list) else []

    missing_agents: list[str] = []
    for logical_name, aliases in REQUIRED_AGENT_ALIASES.items():
        candidates = [agents_dir / f"{alias}.agent.md" for alias in aliases]
        if not any(path.exists() for path in candidates):
            missing_agents.append(logical_name)

    if missing_agents and args.create_missing_templates:
        for logical_name in missing_agents:
            preferred_name = REQUIRED_AGENT_ALIASES[logical_name][0]
            write_agent_template(preferred_name, agents_dir / f"{preferred_name}.agent.md")

    missing_boost_paths: list[str] = []
    missing_manifests: list[str] = []
    missing_capabilities: list[str] = []

    for repo in repos:
        if not isinstance(repo, dict):
            continue
        name = str(repo.get("name", "")).strip()
        location = str(repo.get("location", "")).strip()
        if not name or not location:
            continue

        abs_path = (repo_root / location).resolve()
        if not abs_path.exists():
            missing_boost_paths.append(f"{name} -> {abs_path}")

        slug = name.lower().replace(" ", "-")
        manifest = generated_root / slug / "context-manifests" / "manifest.json"
        capability = generated_root / slug / "capabilities" / "capability.json"

        if not manifest.exists():
            missing_manifests.append(str(manifest))
        if not capability.exists():
            missing_capabilities.append(str(capability))

    print("Agent Pipeline Preflight")
    print(f"- agents_dir: {agents_dir}")
    print(f"- required_agents: {len(REQUIRED_AGENT_ALIASES)}")
    print(f"- missing_agents: {len(missing_agents)}")
    print(f"- missing_boost_paths: {len(missing_boost_paths)}")
    print(f"- missing_manifests: {len(missing_manifests)}")
    print(f"- missing_capabilities: {len(missing_capabilities)}")

    if missing_agents:
        print("\nMissing agent definitions:")
        for m in missing_agents:
            accepted = ", ".join([f"{alias}.agent.md" for alias in REQUIRED_AGENT_ALIASES[m]])
            print(f"  - {m} (accepted: {accepted})")
        if not args.create_missing_templates:
            print("Hint: run with --create-missing-templates to scaffold placeholders.")

    if missing_boost_paths:
        print("\nMissing boost repository paths:")
        for m in missing_boost_paths:
            print(f"  - {m}")

    if missing_manifests:
        print("\nMissing generated manifests:")
        for m in missing_manifests[:20]:
            print(f"  - {m}")

    if missing_capabilities:
        print("\nMissing generated capabilities:")
        for m in missing_capabilities[:20]:
            print(f"  - {m}")

    if missing_agents or missing_boost_paths or missing_manifests or missing_capabilities:
        return 1

    print("Preflight OK. Agent pipeline can route to skills and boost platforms.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
