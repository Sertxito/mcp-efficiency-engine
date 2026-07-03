---
name: discovery
description: "Skill for the Discovery area of MCP Efficiency Engine. 15 symbols across 2 files."
---

# Discovery

15 symbols | 2 files | Cohesion: 84%

## When to Use

- Working with code in `scripts/`
- Understanding how utc_now, load_registry, slug_name work
- Modifying discovery-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/discovery/refresh-project-notes.py` | utc_now, get_number, build_glossary_lines, build_risks_lines, load_json (+3) |
| `scripts/discovery/discover-boost-repos.py` | utc_now, load_registry, slug_name, infer_domain, default_engines (+2) |

## Entry Points

Start here when exploring this area:

- **`utc_now`** (Function) — `scripts/discovery/discover-boost-repos.py:10`
- **`load_registry`** (Function) — `scripts/discovery/discover-boost-repos.py:14`
- **`slug_name`** (Function) — `scripts/discovery/discover-boost-repos.py:21`
- **`infer_domain`** (Function) — `scripts/discovery/discover-boost-repos.py:30`
- **`default_engines`** (Function) — `scripts/discovery/discover-boost-repos.py:43`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `utc_now` | Function | `scripts/discovery/discover-boost-repos.py` | 10 |
| `load_registry` | Function | `scripts/discovery/discover-boost-repos.py` | 14 |
| `slug_name` | Function | `scripts/discovery/discover-boost-repos.py` | 21 |
| `infer_domain` | Function | `scripts/discovery/discover-boost-repos.py` | 30 |
| `default_engines` | Function | `scripts/discovery/discover-boost-repos.py` | 43 |
| `build_candidate` | Function | `scripts/discovery/discover-boost-repos.py` | 55 |
| `main` | Function | `scripts/discovery/discover-boost-repos.py` | 76 |
| `utc_now` | Function | `scripts/discovery/refresh-project-notes.py` | 12 |
| `get_number` | Function | `scripts/discovery/refresh-project-notes.py` | 26 |
| `build_glossary_lines` | Function | `scripts/discovery/refresh-project-notes.py` | 79 |
| `build_risks_lines` | Function | `scripts/discovery/refresh-project-notes.py` | 101 |
| `load_json` | Function | `scripts/discovery/refresh-project-notes.py` | 16 |
| `upsert_auto_section` | Function | `scripts/discovery/refresh-project-notes.py` | 32 |
| `build_decisions_lines` | Function | `scripts/discovery/refresh-project-notes.py` | 56 |
| `main` | Function | `scripts/discovery/refresh-project-notes.py` | 151 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → Utc_now` | cross_community | 3 |
| `Main → Get_number` | cross_community | 3 |
| `Main → Slug_name` | intra_community | 3 |
| `Main → Infer_domain` | intra_community | 3 |
| `Main → Default_engines` | intra_community | 3 |

## How to Explore

1. `context({name: "utc_now"})` — see callers and callees
2. `query({search_query: "discovery"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
