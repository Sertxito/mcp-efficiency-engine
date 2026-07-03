---
name: intake
description: "Skill for the Intake area of MCP Efficiency Engine. 39 symbols across 5 files."
---

# Intake

39 symbols | 5 files | Cohesion: 100%

## When to Use

- Working with code in `scripts/`
- Understanding how utc_now, parse_simple_yml, load_registry work
- Modifying intake-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/intake/resolve-routing.py` | utc_now, parse_simple_yml, load_registry, load_capability_index, load_manifest_index (+11) |
| `scripts/intake/repo-intake.py` | parse_simple_yml, load_registry, slug, utc_now, resolve_repo_path (+4) |
| `scripts/intake/validate-repo-registry.py` | utc_now, parse_simple_yml, load_registry, validate, visit (+2) |
| `scripts/intake/run-routing-evals.py` | utc_now, load_cases, run_case, main |
| `scripts/intake/agent-pipeline-preflight.py` | load_registry, write_agent_template, main |

## Entry Points

Start here when exploring this area:

- **`utc_now`** (Function) — `scripts/intake/resolve-routing.py:15`
- **`parse_simple_yml`** (Function) — `scripts/intake/resolve-routing.py:19`
- **`load_registry`** (Function) — `scripts/intake/resolve-routing.py:39`
- **`load_capability_index`** (Function) — `scripts/intake/resolve-routing.py:50`
- **`load_manifest_index`** (Function) — `scripts/intake/resolve-routing.py:60`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `utc_now` | Function | `scripts/intake/resolve-routing.py` | 15 |
| `parse_simple_yml` | Function | `scripts/intake/resolve-routing.py` | 19 |
| `load_registry` | Function | `scripts/intake/resolve-routing.py` | 39 |
| `load_capability_index` | Function | `scripts/intake/resolve-routing.py` | 50 |
| `load_manifest_index` | Function | `scripts/intake/resolve-routing.py` | 60 |
| `domain_defaults` | Function | `scripts/intake/resolve-routing.py` | 73 |
| `is_repo_approved` | Function | `scripts/intake/resolve-routing.py` | 85 |
| `pick_route` | Function | `scripts/intake/resolve-routing.py` | 92 |
| `profile_for_source` | Function | `scripts/intake/resolve-routing.py` | 165 |
| `memory_selection_for_source` | Function | `scripts/intake/resolve-routing.py` | 175 |
| `runtime_requirements_for_route` | Function | `scripts/intake/resolve-routing.py` | 185 |
| `hitl_policy_for_event` | Function | `scripts/intake/resolve-routing.py` | 215 |
| `select_prompt_for_route` | Function | `scripts/intake/resolve-routing.py` | 265 |
| `select_skill_for_route` | Function | `scripts/intake/resolve-routing.py` | 296 |
| `append_jsonl` | Function | `scripts/intake/resolve-routing.py` | 309 |
| `main` | Function | `scripts/intake/resolve-routing.py` | 315 |
| `parse_simple_yml` | Function | `scripts/intake/repo-intake.py` | 12 |
| `load_registry` | Function | `scripts/intake/repo-intake.py` | 32 |
| `slug` | Function | `scripts/intake/repo-intake.py` | 42 |
| `utc_now` | Function | `scripts/intake/repo-intake.py` | 46 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → Parse_simple_yml` | intra_community | 3 |
| `Main → Is_repo_approved` | intra_community | 3 |
| `Main → Domain_defaults` | intra_community | 3 |
| `Main → Parse_simple_yml` | intra_community | 3 |
| `Main → Parse_simple_yml` | intra_community | 3 |
| `Main → Visit` | intra_community | 3 |
| `Main → Utc_now` | intra_community | 3 |

## How to Explore

1. `context({name: "utc_now"})` — see callers and callees
2. `query({search_query: "intake"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
