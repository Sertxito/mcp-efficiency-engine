from __future__ import annotations

import argparse
import json
import uuid
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
    for path in generated_root.glob("*/capabilities/capability.json"):
        try:
            items.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            continue
    return items


def load_manifest_index(generated_root: Path) -> dict[str, dict[str, Any]]:
    manifests: dict[str, dict[str, Any]] = {}
    for path in generated_root.glob("*/context-manifests/manifest.json"):
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
        "azure-rag": {"agent": "rag-azure-agent", "engine": "Azure RAG Builder", "capability": "azure-rag-enterprise"},
        "rag": {"agent": "rag-local-agent", "engine": "Graphify", "capability": "rag-knowledge"},
        "backend": {"agent": "dev-agent", "engine": "CodeGraph", "capability": "backend-coding"},
        "frontend": {"agent": "frontend-agent", "engine": "CodeGraph", "capability": "frontend-coding"},
        "ux-ui": {"agent": "ux-ui-agent", "engine": "Graphify", "capability": "ux-ui-governance"},
        "community-content": {"agent": "community-manager-agent", "engine": "Graphify", "capability": "community-content"},
        "legacy": {"agent": "legacy-agent", "engine": "GitNexus", "capability": "legacy-migration"},
    }
    return defaults.get(domain, defaults["backend"])


def normalize_frontend_vs_ux_ui(*, domain: str, intent: str, source_type: str) -> tuple[str, str | None]:
    if domain not in {"frontend", "ux-ui"}:
        return domain, None

    intent_l = intent.lower()
    source_l = source_type.lower()

    ux_ui_keywords = {
        "review",
        "design",
        "design-system",
        "accesibilidad",
        "accessibility",
        "usabilidad",
        "usability",
        "consistency",
        "consistencia",
        "governance",
        "heuristic",
        "heuristica",
    }
    frontend_keywords = {
        "bug",
        "bug-fix",
        "fix",
        "feature",
        "implement",
        "implementation",
        "refactor",
        "ui",
        "component",
        "frontend",
    }

    if source_l == "technical-docs" or any(k in intent_l for k in ux_ui_keywords):
        normalized = "ux-ui"
    elif source_l == "code" and any(k in intent_l for k in frontend_keywords):
        normalized = "frontend"
    else:
        normalized = domain

    if normalized != domain:
        return normalized, f"domain_normalized={domain}->{normalized}"
    return normalized, None


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
            "capability": str(candidate.get("capability", "backend-coding")),
            "repo": str(candidate.get("repo", "")),
        }
        return route, notes

    approved_repos_for_domain = [
        r
        for r in repos
        if isinstance(r, dict)
        and str(r.get("domain", "")).strip() == domain
        and is_repo_approved(r)
    ]

    fallback = domain_defaults(domain)
    if approved_repos_for_domain:
        notes.append("selected_by=domain_default")
    else:
        # Some logical domains can be valid without a dedicated onboarded repo.
        notes.append("selected_by=domain_default_expected")
    return {
        "agent": fallback["agent"],
        "engine": fallback["engine"],
        "capability": fallback["capability"],
        "repo": "",
    }, notes


def resolve_sources_and_grounding(*, route: dict[str, Any], source_type: str, repo_root: Path) -> tuple[list[str], bool]:
    sources: list[str] = []

    repo_name = str(route.get("repo", "")).strip()
    if repo_name:
        sources.append(f"repo:{repo_name}")

    engine = str(route.get("engine", "")).lower()
    if source_type == "technical-docs":
        graphify_index = repo_root / "context/graphify-out/graph.json"
        if graphify_index.exists():
            sources.append("graphify:index")

    if "gitnexus" in engine:
        gitnexus_index = repo_root / ".gitnexus/lbug"
        if gitnexus_index.exists():
            sources.append("gitnexus:index")

    return sources, bool(sources)


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


def runtime_requirements_for_route(source_type: str, engine: str) -> list[str]:
    base = ["token-saver-mcp", "codebase-memory-mcp"]
    requirements: list[str] = list(base)

    engine_l = engine.lower()
    if "codegraph" in engine_l:
        requirements.extend(["codegraph-command", "codegraph-index"])
    if "gitnexus" in engine_l:
        requirements.append("gitnexus-command")
    if "graphify" in engine_l:
        requirements.append("graphify-index")
    if "azure rag" in engine_l:
        requirements.append("azure-rag-connector")
    if "repomix" in engine_l:
        requirements.append("repomix-command")

    # Keep source-specific connector requirement explicit for evidence routes.
    if source_type == "corporate-docs" and "azure-rag-connector" not in requirements:
        requirements.append("azure-rag-connector")

    seen: set[str] = set()
    deduped: list[str] = []
    for req in requirements:
        if req in seen:
            continue
        seen.add(req)
        deduped.append(req)
    return deduped


def hitl_policy_for_event(*, intent: str, domain: str, source_type: str, fallback: bool, notes: list[str]) -> dict[str, Any]:
    text = f"{intent} {domain} {source_type} {' '.join(notes)}".lower()

    high_impact_keywords = [
        "deploy",
        "production",
        "migrate",
        "migration",
        "delete",
        "drop",
        "remove",
        "destroy",
        "governance",
        "policy",
        "rbac",
        "security",
        "role",
    ]
    destructive_keywords = ["delete", "drop", "destroy", "remove"]

    triggered = [k for k in high_impact_keywords if k in text]
    destructive = any(k in text for k in destructive_keywords)
    unresolved_deps = any(n.startswith("unresolved_dependencies=") for n in notes)

    required = bool(triggered) or fallback or unresolved_deps
    if required:
        reasons: list[str] = []
        if triggered:
            reasons.append("high_impact:" + ",".join(sorted(set(triggered))))
        if fallback:
            reasons.append("routing_fallback")
        if unresolved_deps:
            reasons.append("unresolved_dependencies")

        action = "block_until_human_approval" if destructive else "request_human_confirmation"
        return {
            "mode": "always_on_auto",
            "required": True,
            "action": action,
            "reason": ";".join(reasons),
        }

    return {
        "mode": "always_on_auto",
        "required": False,
        "action": "none",
        "reason": "low_risk_route",
    }


def select_prompt_for_route(
    *,
    intent: str,
    domain: str,
    source_type: str,
    agent: str,
    prompt_root: Path,
) -> tuple[str, bool]:
    """Return prompt path relative to repo root and whether it exists."""
    # Highest-priority route: corporate evidence questions.
    if source_type == "corporate-docs" or domain == "azure-rag" or agent == "rag-azure-agent":
        candidate = ".github/prompts/azure-rag.query.prompt.md"
    # Code-centric workflows.
    elif domain == "frontend":
        candidate = ".github/prompts/frontend.code.prompt.md"
    elif domain == "backend" and ("bug" in intent or intent == "bug-fix"):
        candidate = ".github/prompts/backend.fix-bug.prompt.md"
    elif domain == "community-content" or agent == "community-manager-agent":
        candidate = ".github/prompts/community.post.prompt.md"
    elif domain == "ux-ui" or agent == "ux-ui-agent":
        candidate = ".github/prompts/ux-ui.review.prompt.md"
    elif domain == "legacy":
        candidate = ".github/prompts/legacy.impact-analysis.prompt.md"
    # Data/document technical flows.
    elif domain == "dba":
        candidate = ".github/prompts/dba.query-review.prompt.md"
    elif agent == "rag-local-agent" or source_type == "technical-docs":
        candidate = ".github/prompts/rag.knowledge-answer.prompt.md"
    elif domain == "snapshot" or source_type == "snapshot":
        candidate = ".github/prompts/cavecrew.prompt.md"
    else:
        candidate = ".github/prompts/auto-route.prompt.md"

    exists = (prompt_root / candidate).exists()
    return candidate, exists


def select_skill_for_route(*, capability: str, skill_root: Path) -> tuple[str, bool]:
    """Return skill file path relative to repo root and whether it exists."""
    normalized = capability.strip()
    candidate = f".github/skills/{normalized}/SKILL.md" if normalized else ".github/skills/token-saver/SKILL.md"
    exists = (skill_root / candidate).exists()
    if exists:
        return candidate, True

    # Safe fallback: always-on optimization skill.
    fallback = ".github/skills/token-saver/SKILL.md"
    return fallback, (skill_root / fallback).exists()


def append_jsonl(path: Path, event: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")


def build_tool_mode(local_tools: int, remote_tools: int) -> str:
    if local_tools > 0 and remote_tools == 0:
        return "local-only"
    if local_tools == 0 and remote_tools > 0:
        return "remote-only"
    if local_tools > 0 and remote_tools > 0:
        return "hybrid"
    return "model-only"


def build_iteration_metric(
    *,
    event_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    estimated_cost_usd: float,
    local_tools: int,
    remote_tools: int,
    notes: str,
) -> dict[str, Any]:
    total_tokens = input_tokens + output_tokens
    return {
        "timestamp": utc_now(),
        "event_id": event_id,
        "model": model,
        "cost": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "estimated_cost_usd": round(float(estimated_cost_usd), 6),
        },
        "execution": {
            "local_tools": local_tools,
            "remote_tools": remote_tools,
            "tool_mode": build_tool_mode(local_tools, remote_tools),
        },
        "notes": notes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve routing with capability-aware local-first policy.")
    parser.add_argument("--input", required=True, help="Original user input for routing event")
    parser.add_argument("--intent", required=True, help="Detected intent")
    parser.add_argument("--domain", required=True, help="Detected domain")
    parser.add_argument("--source-type", required=True, help="code|technical-docs|corporate-docs|snapshot")
    parser.add_argument("--capability", default="", help="Optional requested capability")
    parser.add_argument("--registry", default="repo-registry/repos.yml")
    parser.add_argument("--generated-root", default="repo-intake/generated")
    parser.add_argument("--output", default="observability/logs/routing-decisions.jsonl")
    parser.add_argument("--input-tokens", type=int, default=-1, help="Real input tokens for this call. Provide with --output-tokens.")
    parser.add_argument("--output-tokens", type=int, default=-1, help="Real output tokens for this call. Provide with --input-tokens.")
    parser.add_argument("--estimated-cost-usd", type=float, default=0.0, help="Estimated cost in USD for this call.")
    parser.add_argument("--model", default="unknown", help="Model used by this call, e.g. GPT-5.3-Codex")
    parser.add_argument("--local-tools", type=int, default=0, help="Count of local tools used by this call")
    parser.add_argument("--remote-tools", type=int, default=0, help="Count of remote tools used by this call")
    parser.add_argument("--metrics-output", default="observability/logs/iteration-metrics.jsonl", help="JSONL output for per-call token metrics")
    args = parser.parse_args()

    has_input_tokens = args.input_tokens >= 0
    has_output_tokens = args.output_tokens >= 0
    if has_input_tokens != has_output_tokens:
        print("Both --input-tokens and --output-tokens must be provided together (or omitted together).")
        return 1
    if args.input_tokens < -1 or args.output_tokens < -1:
        print("Token values must be >= 0 when provided.")
        return 1
    if args.estimated_cost_usd < 0:
        print("--estimated-cost-usd must be >= 0")
        return 1
    if args.local_tools < 0 or args.remote_tools < 0:
        print("--local-tools and --remote-tools must be >= 0")
        return 1

    repo_root = Path(__file__).resolve().parents[2]
    registry = load_registry((repo_root / args.registry).resolve())
    capabilities = load_capability_index((repo_root / args.generated_root).resolve())
    manifests = load_manifest_index((repo_root / args.generated_root).resolve())

    normalized_domain, normalized_note = normalize_frontend_vs_ux_ui(
        domain=args.domain,
        intent=args.intent,
        source_type=args.source_type,
    )

    route, notes = pick_route(
        registry=registry,
        capabilities=capabilities,
        manifests=manifests,
        domain=normalized_domain,
        capability=args.capability.strip() or None,
    )
    if normalized_note:
        notes.append(normalized_note)

    token_saver_profile, caveman_profile, context_strategy = profile_for_source(args.source_type)
    fallback = any(n == "selected_by=domain_default" for n in notes)
    sources, grounded = resolve_sources_and_grounding(route=route, source_type=args.source_type, repo_root=repo_root)

    selected_memories, memory_reason = memory_selection_for_source(args.source_type)
    selected_prompt, prompt_exists = select_prompt_for_route(
        intent=args.intent,
        domain=normalized_domain,
        source_type=args.source_type,
        agent=route["agent"],
        prompt_root=repo_root,
    )
    if not prompt_exists:
        notes.append(f"prompt_not_found={selected_prompt}")
    selected_skill, skill_exists = select_skill_for_route(
        capability=route["capability"],
        skill_root=repo_root,
    )
    if not skill_exists:
        notes.append(f"skill_not_found={selected_skill}")
    event_id = str(uuid.uuid4())
    hitl = hitl_policy_for_event(
        intent=args.intent,
        domain=normalized_domain,
        source_type=args.source_type,
        fallback=fallback,
        notes=notes,
    )
    event = {
        "event_id": event_id,
        "timestamp": utc_now(),
        "input": args.input,
        "intent": args.intent,
        "domain": normalized_domain,
        "source_type": args.source_type,
        "agent": route["agent"],
        "engine": route["engine"],
        "optimization_profile": f"{token_saver_profile}+{caveman_profile}",
        "fallback": fallback,
        "grounded": grounded,
        "sources": sources,
        "notes": ";".join(notes) if notes else "",
        "prompt": {
            "selected": selected_prompt,
            "exists": prompt_exists,
            "selection_mode": "auto",
        },
        "skill": {
            "selected": selected_skill,
            "exists": skill_exists,
            "selection_mode": "auto",
        },
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
        "requirements": runtime_requirements_for_route(args.source_type, route["engine"]),
        "learning": {
            "used_pattern": f"{normalized_domain}+{args.intent}",
            # Real success must be written post-execution by the feedback updater.
            "success": None,
            "outcome_status": "pending",
            "fallback": fallback,
            "confidence": 0.9 if not fallback else 0.7,
        },
        "hitl": hitl,
    }

    if has_input_tokens and has_output_tokens:
        total_tokens = args.input_tokens + args.output_tokens
        event["usage"] = {
            "input_tokens": args.input_tokens,
            "output_tokens": args.output_tokens,
            "total_tokens": total_tokens,
            "estimated_cost_usd": round(float(args.estimated_cost_usd), 6),
        }

    metrics_recorded = False
    metrics_output_path = ""
    if has_input_tokens and has_output_tokens:
        metric = build_iteration_metric(
            event_id=event_id,
            model=str(args.model),
            input_tokens=args.input_tokens,
            output_tokens=args.output_tokens,
            estimated_cost_usd=float(args.estimated_cost_usd),
            local_tools=args.local_tools,
            remote_tools=args.remote_tools,
            notes="auto-recorded by resolve-routing",
        )
        metrics_path = (repo_root / args.metrics_output).resolve()
        append_jsonl(metrics_path, metric)
        metrics_recorded = True
        metrics_output_path = args.metrics_output.replace("\\", "/")

    event["telemetry"] = {
        "iteration_metrics_recorded": metrics_recorded,
        "metrics_output": metrics_output_path,
    }

    output_path = (repo_root / args.output).resolve()
    append_jsonl(output_path, event)

    print(json.dumps(event, indent=2, ensure_ascii=False))
    print(f"Event appended to: {output_path}")
    if metrics_recorded:
        print(f"Metrics appended to: {metrics_output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
