from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except Exception:
    yaml = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_simple_yml(path: Path) -> dict[str, Any]:
    repos: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        st = line.strip()
        if st.startswith("- name:"):
            if cur:
                repos.append(cur)
            cur = {"name": st.split(":", 1)[1].strip()}
        elif cur and ":" in st and not st.startswith("#"):
            k, v = st.split(":", 1)
            k = k.strip()
            v = v.strip().strip('"')
            if k in {"domain", "location", "type", "version"}:
                cur[k] = v
    if cur:
        repos.append(cur)
    return {"schema_version": "1.0", "repos": repos}


def load_registry(path: Path) -> dict[str, Any]:
    content = path.read_text(encoding="utf-8")
    if content.lstrip().startswith("{"):
        return json.loads(content)
    if yaml is not None:
        data = yaml.safe_load(content) or {}
        if isinstance(data, dict):
            return data
    return parse_simple_yml(path)


def load_capability_index(generated_root: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in generated_root.glob("*/*/capabilities/capability.json"):
        try:
            items.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            continue
    return items


def load_manifest_index(generated_root: Path) -> dict[str, dict[str, Any]]:
    manifests: dict[str, dict[str, Any]] = {}
    for path in generated_root.glob("*/*/context-manifests/manifest.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        name = str(data.get("repo", "")).strip()
        if name:
            manifests[name] = data
    return manifests


def domain_defaults(domain: str) -> dict[str, str]:
    defaults = {
        "dba": {"agent": "dba-agent", "engine": "Graphify", "capability": "database-analysis"},
        "iot": {"agent": "iot-agent", "engine": "GitNexus/CodeGraph + Graphify", "capability": "iot-architecture"},
        "azure-rag": {"agent": "azure-rag-agent", "engine": "Azure RAG Builder", "capability": "azure-rag-enterprise"},
        "dev": {"agent": "dev-agent", "engine": "CodeGraph", "capability": "dev-coding"},
        "legacy": {"agent": "legacy-agent", "engine": "GitNexus", "capability": "legacy-migration"},
    }
    return defaults.get(domain, defaults["dev"])


def is_repo_approved(repo: dict[str, Any]) -> bool:
    approval = repo.get("approval")
    if not isinstance(approval, dict):
        return False
    return approval.get("status") == "approved"


def pick_route(
    *,
    registry: dict[str, Any],
    capabilities: list[dict[str, Any]],
    manifests: dict[str, dict[str, Any]],
    domain: str,
    capability: str | None,
) -> tuple[dict[str, Any], list[str]]:
    notes: list[str] = []
    repos = registry.get("repos", []) if isinstance(registry.get("repos", []), list) else []
    repo_by_name = {str(r.get("name", "")): r for r in repos if isinstance(r, dict)}

    candidates: list[tuple[dict[str, Any], str]] = []
    if capability:
        for c in capabilities:
            if str(c.get("capability", "")).strip() == capability:
                candidates.append((c, "selected_by=capability"))
    for c in capabilities:
        if str(c.get("domain", "")).strip() == domain:
            candidates.append((c, "selected_by=domain_capability_index"))

    candidate: dict[str, Any] | None = None
    for item, reason in candidates:
        repo_name = str(item.get("repo", "")).strip()
        registry_repo = repo_by_name.get(repo_name)
        if not registry_repo:
            notes.append(f"repo_not_found_in_registry={repo_name}")
            continue
        if not is_repo_approved(registry_repo):
            notes.append(f"repo_not_approved={repo_name}")
            continue

        manifest = manifests.get(repo_name, {})
        deps = manifest.get("dependencies", []) if isinstance(manifest, dict) else []
        unresolved: list[str] = []
        for dep in deps:
            if not isinstance(dep, dict):
                continue
            dep_ref = str(dep.get("ref", "")).strip()
            if not dep_ref:
                continue
            dep_repo = repo_by_name.get(dep_ref)
            dep_manifest_exists = dep_ref in manifests
            dep_ok = dep_repo is not None and is_repo_approved(dep_repo) and dep_manifest_exists
            if not dep_ok:
                unresolved.append(dep_ref)
        if unresolved:
            notes.append("unresolved_dependencies=" + ",".join(unresolved))
            continue

        candidate = item
        notes.append(reason)
        break

    if candidate is not None:
        route = {
            "agent": str(candidate.get("agent", "dev-agent")),
            "engine": str(candidate.get("engine", "CodeGraph")),
            "capability": str(candidate.get("capability", "dev-coding")),
            "repo": str(candidate.get("repo", "")),
        }
        return route, notes

    fallback = domain_defaults(domain)
    notes.append("selected_by=domain_default")
    return {
        "agent": fallback["agent"],
        "engine": fallback["engine"],
        "capability": fallback["capability"],
        "repo": "",
    }, notes


def profile_for_source(source_type: str) -> tuple[str, str, str]:
    if source_type == "corporate-docs":
        return "evidence-first", "evidence-first", "chunk"
    if source_type == "code":
        return "strict", "full", "symbol"
    if source_type == "snapshot":
        return "strict", "lite", "snapshot-scope"
    return "balanced", "lite", "manifest"


def memory_selection_for_source(source_type: str) -> tuple[list[str], str]:
    if source_type == "code":
        return ["repo-memory", "routing-memory", "code-memory"], "code route uses structural retrieval"
    if source_type == "corporate-docs":
        return ["repo-memory", "routing-memory", "enterprise-memory"], "corporate evidence route"
    if source_type == "technical-docs":
        return ["repo-memory", "routing-memory", "knowledge-memory"], "technical docs route"
    return ["repo-memory", "routing-memory"], "capability-aware routing"


def runtime_requirements_for_source(source_type: str) -> list[str]:
    base = ["token-saver-mcp", "codebase-memory-mcp"]
    if source_type == "code":
        return base + ["codegraph-command", "codegraph-index"]
    if source_type == "technical-docs":
        return base + ["graphify-index"]
    if source_type == "corporate-docs":
        return base + ["azure-rag-connector"]
    return base


def append_jsonl(path: Path, event: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve routing with capability-aware local-first policy.")
    parser.add_argument("--input", required=True, help="Original user input for routing event")
    parser.add_argument("--intent", required=True, help="Detected intent")
    parser.add_argument("--domain", required=True, help="Detected domain")
    parser.add_argument("--source-type", required=True, help="code|technical-docs|corporate-docs|snapshot")
    parser.add_argument("--capability", default="", help="Optional requested capability")
    parser.add_argument("--registry", default="repo-registry/repos.yml")
    parser.add_argument("--generated-root", default="repo-intake/generated/v2")
    parser.add_argument("--output", default="observability/logs/routing-decisions.jsonl")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    registry = load_registry((repo_root / args.registry).resolve())
    capabilities = load_capability_index((repo_root / args.generated_root).resolve())
    manifests = load_manifest_index((repo_root / args.generated_root).resolve())

    route, notes = pick_route(
        registry=registry,
        capabilities=capabilities,
        manifests=manifests,
        domain=args.domain,
        capability=args.capability.strip() or None,
    )

    token_saver_profile, caveman_profile, context_strategy = profile_for_source(args.source_type)
    fallback = any(n.startswith("selected_by=domain_default") for n in notes)
    grounded = route["repo"] != "" or args.source_type in {"code", "corporate-docs", "technical-docs", "snapshot"}

    selected_memories, memory_reason = memory_selection_for_source(args.source_type)
    event = {
        "timestamp": utc_now(),
        "input": args.input,
        "intent": args.intent,
        "source_type": args.source_type,
        "agent": route["agent"],
        "engine": route["engine"],
        "optimization_profile": f"{token_saver_profile}+{caveman_profile}",
        "fallback": fallback,
        "grounded": grounded,
        "sources": [f"repo:{route['repo']}"] if route["repo"] else [],
        "notes": ";".join(notes) if notes else "",
        "optimization": {
            "token_saver": "always_on",
            "token_saver_profile": token_saver_profile,
            "caveman": "always_on",
            "caveman_profile": caveman_profile,
            "sources_preserved": True,
            "context_reduction_strategy": context_strategy,
        },
        "memory": {
            "selected": selected_memories,
            "reason": memory_reason,
        },
        "requirements": runtime_requirements_for_source(args.source_type),
        "learning": {
            "used_pattern": f"{args.domain}+{args.intent}",
            "success": True,
            "fallback": fallback,
            "confidence": 0.9 if not fallback else 0.7,
        },
    }

    output_path = (repo_root / args.output).resolve()
    append_jsonl(output_path, event)
    print(json.dumps(event, indent=2, ensure_ascii=False))
    print(f"Event appended to: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
