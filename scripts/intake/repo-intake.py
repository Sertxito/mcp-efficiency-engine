import argparse
from pathlib import Path
import json
import re
import shutil
import hashlib
from datetime import datetime, timezone

try:
    import yaml  # type: ignore
except Exception:
    yaml = None

def parse_simple_yml(path):
    repos = []
    cur = None
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        st = line.strip()
        if st.startswith('- name:'):
            if cur:
                repos.append(cur)
            cur = {'name': st.split(':', 1)[1].strip()}
        elif cur and ':' in st and not st.startswith('#'):
            k, v = st.split(':', 1)
            k = k.strip()
            v = v.strip().strip('"')
            if k in ['domain', 'type', 'version', 'package_name', 'package_path']:
                cur[k] = v
    if cur:
        repos.append(cur)
    return {'schema_version': '1.0', 'repos': repos}


def load_registry(path):
    content = Path(path).read_text(encoding='utf-8')
    if content.lstrip().startswith('{'):
        return json.loads(content)
    if yaml is not None:
        data = yaml.safe_load(content) or {}
        if isinstance(data, dict) and data.get('repos'):
            return data
    return parse_simple_yml(path)

def slug(s):
    return re.sub(r'[^A-Za-z0-9_-]+', '-', s).strip('-').lower()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def resolve_package_path(repo_root: Path, package_name: str, package_path: str = '') -> Path:
    if package_path.strip():
        path = Path(package_path.strip())
        if path.is_absolute():
            return path.resolve()
        return (repo_root / path).resolve()
    return (repo_root / 'node_modules' / package_name).resolve()


def materialize_repo(repo_root: Path, repo: dict) -> tuple[Path, dict]:
    package_name = str(repo.get('package_name', '')).strip()
    package_path = str(repo.get('package_path', '')).strip()
    resolved_path = resolve_package_path(repo_root, package_name, package_path)
    contract_path = resolved_path / 'mcpee.json'

    status = 'installed'
    if not resolved_path.exists():
        status = 'missing_package'
    elif not contract_path.exists():
        status = 'missing_contract'

    return resolved_path, {
        'mode': 'npm',
        'package_name': package_name,
        'package_path': package_path or f"node_modules/{package_name}",
        'resolved_path': str(resolved_path).replace('\\', '/'),
        'status': status,
    }


def load_mcpee_contract(package_root: Path) -> dict:
    contract_path = package_root / 'mcpee.json'
    if not contract_path.exists():
        return {}
    try:
        data = json.loads(contract_path.read_text(encoding='utf-8'))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def file_fingerprint(path: Path) -> dict:
    stat = path.stat()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    return {
        'size_bytes': stat.st_size,
        'mtime_utc': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        'sha256_16': digest,
    }


def _normalize_path_entries(value) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [entry.strip() for entry in value if isinstance(entry, str) and entry.strip()]
    return []


def _safe_resolve_under(package_root: Path, relative_path: str) -> Path | None:
    package_root_resolved = package_root.resolve()
    path = (package_root / relative_path).resolve()
    try:
        path.relative_to(package_root_resolved)
    except Exception:
        return None
    return path


def _matches_extensions(path: Path, extensions: set[str] | None) -> bool:
    if extensions is None:
        return True
    return path.suffix.lower() in extensions


def _append_candidate(
    *,
    candidates: list[dict],
    seen: set[str],
    source: Path,
    package_root: Path,
    category: str,
    repo_name: str,
    package_name: str,
    capability: str,
    source_mode: str,
) -> None:
    resolved = source.resolve()
    key = str(resolved).replace('\\', '/').lower() + '|' + capability
    if key in seen:
        return
    seen.add(key)

    try:
        relative = resolved.relative_to(package_root.resolve()).as_posix()
    except Exception:
        relative = resolved.name

    candidates.append(
        {
            'category': category,
            'repo': repo_name,
            'package_name': package_name,
            'source_path': resolved,
            'relative_source_path': relative,
            'capability': capability,
            'source_mode': source_mode,
        }
    )


def _collect_artifact_candidates(
    *,
    package_root: Path,
    contract: dict,
    category: str,
    repo_name: str,
    package_name: str,
    contract_keys: list[str],
    capability_keys: list[str],
    fallback_globs: list[str],
    extensions: set[str] | None,
) -> list[dict]:
    candidates: list[dict] = []
    seen: set[str] = set()

    for key in contract_keys:
        for rel in _normalize_path_entries(contract.get(key, [])):
            path = _safe_resolve_under(package_root, rel)
            if path is None or (not path.is_file()) or (not _matches_extensions(path, extensions)):
                continue
            _append_candidate(
                candidates=candidates,
                seen=seen,
                source=path,
                package_root=package_root,
                category=category,
                repo_name=repo_name,
                package_name=package_name,
                capability='default',
                source_mode='contract',
            )

    capabilities = contract.get('capabilities', []) if isinstance(contract.get('capabilities', []), list) else []
    for cap in capabilities:
        if not isinstance(cap, dict):
            continue
        capability_id = str(cap.get('id', '')).strip() or 'default'
        for key in capability_keys:
            for rel in _normalize_path_entries(cap.get(key, [])):
                path = _safe_resolve_under(package_root, rel)
                if path is None or (not path.is_file()) or (not _matches_extensions(path, extensions)):
                    continue
                _append_candidate(
                    candidates=candidates,
                    seen=seen,
                    source=path,
                    package_root=package_root,
                    category=category,
                    repo_name=repo_name,
                    package_name=package_name,
                    capability=capability_id,
                    source_mode='capability',
                )

    for pattern in fallback_globs:
        for path in sorted(package_root.glob(pattern)):
            if (not path.is_file()) or (not _matches_extensions(path, extensions)):
                continue
            _append_candidate(
                candidates=candidates,
                seen=seen,
                source=path,
                package_root=package_root,
                category=category,
                repo_name=repo_name,
                package_name=package_name,
                capability='default',
                source_mode='discovered',
            )

    return candidates


def _artifact_target_path(*, repo_root: Path, candidate: dict, managed_prefix: str) -> Path:
    category = str(candidate.get('category', '')).strip()
    package_name = str(candidate.get('package_name', '')).strip()
    relative_source = str(candidate.get('relative_source_path', '')).strip() or Path(str(candidate.get('source_path'))).name
    source_path = Path(str(candidate.get('source_path')))

    if category == 'instructions':
        rel_hash = hashlib.sha1(relative_source.encode('utf-8')).hexdigest()[:8]
        file_name = f"{managed_prefix}{slug(package_name)}--{slug(relative_source)}-{rel_hash}.instructions.md"
        return repo_root / '.github' / 'instructions' / file_name

    managed_dir = f"{managed_prefix}{slug(package_name)}"
    relative_name = Path(relative_source).as_posix()
    category_roots = {
        'agents': repo_root / '.github' / 'agents',
        'skills': repo_root / '.github' / 'skills',
        'prompts': repo_root / '.github' / 'prompts',
        'specs': repo_root / 'specs',
        'evals': repo_root / 'observability' / 'evals' / 'boosts',
    }
    target_root = category_roots.get(category)
    if target_root is None:
        raise ValueError(f'Unsupported category: {category}')

    preferred = target_root / managed_dir / relative_name
    if preferred.suffix:
        return preferred
    return preferred / source_path.name


def sync_installed_boost_artifacts(repo_root: Path, installed_repos: list[dict]) -> dict:
    managed_prefix = 'mcpee-boost-'
    category_config = {
        'instructions': {
            'contract_keys': ['instructions'],
            'capability_keys': ['instructions', 'instructionFiles'],
            'fallback_globs': [
                '.github/instructions/*.instructions.md',
                '.github/instructions/**/*.instructions.md',
                'instructions/*.instructions.md',
                'instructions/**/*.instructions.md',
            ],
            'extensions': {'.md'},
        },
        'agents': {
            'contract_keys': ['agents', 'defaultAgent'],
            'capability_keys': ['agent', 'agents'],
            'fallback_globs': ['agents/**/*.md', '.github/agents/**/*.md'],
            'extensions': {'.md'},
        },
        'skills': {
            'contract_keys': ['skills', 'defaultSkill'],
            'capability_keys': ['skills'],
            'fallback_globs': ['skills/**/*.md', 'skills/**/*.json', '.github/skills/**/*.md'],
            'extensions': {'.md', '.json'},
        },
        'prompts': {
            'contract_keys': ['prompts'],
            'capability_keys': ['prompts'],
            'fallback_globs': ['prompts/**/*.md', '.github/prompts/**/*.md'],
            'extensions': {'.md'},
        },
        'specs': {
            'contract_keys': ['specs'],
            'capability_keys': ['specs'],
            'fallback_globs': ['specs/**/*.md'],
            'extensions': {'.md'},
        },
        'evals': {
            'contract_keys': ['evals'],
            'capability_keys': ['evals'],
            'fallback_globs': ['evals/**/*.json', 'evals/**/*.md', 'evals/**/*.yaml', 'evals/**/*.yml'],
            'extensions': {'.json', '.md', '.yaml', '.yml'},
        },
    }

    cleanup_roots = [
        repo_root / '.github' / 'instructions',
        repo_root / '.github' / 'agents',
        repo_root / '.github' / 'skills',
        repo_root / '.github' / 'prompts',
        repo_root / 'specs',
        repo_root / 'observability' / 'evals' / 'boosts',
    ]

    removed_previous: list[str] = []
    for root in cleanup_roots:
        if not root.exists():
            continue
        if root.name == 'instructions':
            for existing in root.glob(f'{managed_prefix}*.instructions.md'):
                try:
                    existing.unlink()
                    removed_previous.append(str(existing).replace('\\', '/'))
                except Exception:
                    continue
            continue
        for existing in root.glob(f'{managed_prefix}*'):
            try:
                if existing.is_dir():
                    shutil.rmtree(existing, ignore_errors=True)
                else:
                    existing.unlink()
                removed_previous.append(str(existing).replace('\\', '/'))
            except Exception:
                continue

    synced: list[dict] = []
    skipped: list[dict] = []
    runtime_index: dict[str, dict] = {}

    for repo in installed_repos:
        if repo.get('sync_status') != 'installed':
            continue

        package_root = repo.get('package_root')
        if not isinstance(package_root, Path) or not package_root.exists():
            continue

        repo_name = str(repo.get('name', '')).strip()
        package_name = str(repo.get('package_name', '')).strip() or package_root.name
        contract = repo.get('contract') if isinstance(repo.get('contract'), dict) else {}

        runtime_index.setdefault(repo_name, {'defaults': {}, 'capabilities': {}})

        for category, cfg in category_config.items():
            candidates = _collect_artifact_candidates(
                package_root=package_root,
                contract=contract,
                category=category,
                repo_name=repo_name,
                package_name=package_name,
                contract_keys=cfg['contract_keys'],
                capability_keys=cfg['capability_keys'],
                fallback_globs=cfg['fallback_globs'],
                extensions=cfg['extensions'],
            )

            for candidate in candidates:
                source = Path(str(candidate.get('source_path')))
                target = _artifact_target_path(repo_root=repo_root, candidate=candidate, managed_prefix=managed_prefix)
                target.parent.mkdir(parents=True, exist_ok=True)

                try:
                    shutil.copy2(source, target)
                    target_rel = str(target.relative_to(repo_root)).replace('\\', '/')
                    item = {
                        'repo': repo_name,
                        'package_name': package_name,
                        'category': category,
                        'capability': str(candidate.get('capability', 'default')),
                        'source': str(source).replace('\\', '/'),
                        'target': str(target).replace('\\', '/'),
                        'target_relative': target_rel,
                        'source_mode': str(candidate.get('source_mode', '')),
                    }
                    synced.append(item)

                    cap = str(candidate.get('capability', 'default'))
                    if cap == 'default':
                        runtime_index[repo_name]['defaults'].setdefault(category, []).append(target_rel)
                    else:
                        runtime_index[repo_name]['capabilities'].setdefault(cap, {})
                        runtime_index[repo_name]['capabilities'][cap].setdefault(category, []).append(target_rel)
                except Exception as exc:
                    skipped.append(
                        {
                            'repo': repo_name,
                            'package_name': package_name,
                            'category': category,
                            'capability': str(candidate.get('capability', 'default')),
                            'source': str(source).replace('\\', '/'),
                            'reason': str(exc),
                        }
                    )

    return {
        'timestamp': utc_now(),
        'managed_prefix': managed_prefix,
        'removed_previous': removed_previous,
        'removed_previous_count': len(removed_previous),
        'synced_count': len(synced),
        'skipped_count': len(skipped),
        'synced': synced,
        'skipped': skipped,
        'runtime_index': runtime_index,
    }

    managed_prefix = 'mcpee-boost-'
    removed = 0
    for existing in instructions_dir.glob(f'{managed_prefix}*.instructions.md'):
        try:
            existing.unlink()
            removed += 1
        except Exception:
            continue

    synced: list[dict] = []
    skipped: list[dict] = []
    for repo in installed_repos:
        if repo.get('sync_status') != 'installed':
            continue

        package_root = repo.get('package_root')
        if not isinstance(package_root, Path) or not package_root.exists():
            continue

        package_name = str(repo.get('package_name', '')).strip() or package_root.name
        contract = repo.get('contract') if isinstance(repo.get('contract'), dict) else {}
        sources = resolve_instruction_candidates(package_root, contract)

        for source in sources:
            try:
                rel = source.relative_to(package_root).as_posix()
            except Exception:
                rel = source.name

            rel_hash = hashlib.sha1(rel.encode('utf-8')).hexdigest()[:8]
            target_name = f"{managed_prefix}{slug(package_name)}--{slug(rel)}-{rel_hash}.instructions.md"
            target_path = instructions_dir / target_name

            try:
                shutil.copy2(source, target_path)
                synced.append(
                    {
                        'repo': str(repo.get('name', '')).strip(),
                        'package_name': package_name,
                        'source': str(source).replace('\\', '/'),
                        'target': str(target_path).replace('\\', '/'),
                    }
                )
            except Exception as exc:
                skipped.append(
                    {
                        'repo': str(repo.get('name', '')).strip(),
                        'package_name': package_name,
                        'source': str(source).replace('\\', '/'),
                        'reason': str(exc),
                    }
                )

    return {
        'timestamp': utc_now(),
        'managed_prefix': managed_prefix,
        'instructions_dir': str(instructions_dir).replace('\\', '/'),
        'removed_previous': removed,
        'synced_count': len(synced),
        'skipped_count': len(skipped),
        'synced': synced,
        'skipped': skipped,
    }


def build_structure_manifest(repo_root: Path, repo_name: str, slug_name: str, version: str, domain: str, package_name: str, repo_path: Path | None = None, sync: dict | None = None) -> dict:
    repo_path = repo_path or resolve_package_path(repo_root, package_name)
    structure = {
        'schema_version': '1.0',
        'repo': repo_name,
        'slug': slug_name,
        'version': version,
        'domain': domain,
        'package_name': package_name,
        'resolved_path': str(repo_path).replace('\\', '/'),
        'generated_at': utc_now(),
        'exists': repo_path.exists(),
    }
    if sync is not None:
        structure['sync'] = sync

    if not repo_path.exists():
        structure['top_level'] = {'dirs': [], 'files': [], 'counts': {'dirs': 0, 'files': 0}}
        structure['key_artifacts'] = []
        structure['cache_fingerprint'] = hashlib.sha256(
            json.dumps({'repo': repo_name, 'version': version, 'exists': False}, sort_keys=True).encode('utf-8')
        ).hexdigest()[:16]
        return structure

    top_level_entries = sorted(repo_path.iterdir(), key=lambda item: item.name.lower())
    top_level_dirs = [entry.name for entry in top_level_entries if entry.is_dir()]
    top_level_files = [entry.name for entry in top_level_entries if entry.is_file()]

    key_candidates = [
        'mcpee.json',
        'README.md',
        'agents',
        'skills',
        'prompts',
        'specs',
        'evals',
    ]

    key_artifacts = []
    for rel in key_candidates:
        item_path = repo_path / rel
        artifact = {
            'path': rel,
            'exists': item_path.exists(),
            'kind': 'missing',
        }
        if item_path.exists() and item_path.is_dir():
            artifact['kind'] = 'dir'
            children = sorted([child.name for child in item_path.iterdir()], key=str.lower)
            artifact['sample_children'] = children[:25]
            artifact['sample_truncated'] = len(children) > 25
        elif item_path.exists() and item_path.is_file():
            artifact['kind'] = 'file'
            artifact['fingerprint'] = file_fingerprint(item_path)
        key_artifacts.append(artifact)

    structure['top_level'] = {
        'dirs': top_level_dirs,
        'files': top_level_files,
        'counts': {
            'dirs': len(top_level_dirs),
            'files': len(top_level_files),
        },
    }
    structure['key_artifacts'] = key_artifacts
    structure['cache_fingerprint'] = hashlib.sha256(
        json.dumps(
            {
                'top_level_dirs': top_level_dirs,
                'top_level_files': top_level_files,
                'key_artifacts': key_artifacts,
            },
            sort_keys=True,
            ensure_ascii=False,
        ).encode('utf-8')
    ).hexdigest()[:16]

    return structure


def ensure_dirs(base):
    for d in ['reports']:
        (base / d).mkdir(parents=True, exist_ok=True)


def discover_installed_boost_repos(repo_root: Path, repo_name_prefix: str) -> list[dict]:
    discovered: list[dict] = []
    node_modules = repo_root / 'node_modules'
    if not node_modules.exists():
        return discovered

    contracts: list[Path] = []
    # Scoped packages: node_modules/@scope/pkg/mcpee.json
    for scope_dir in sorted(node_modules.glob('@*')):
        if not scope_dir.is_dir():
            continue
        contracts.extend(sorted(scope_dir.glob('*/mcpee.json')))

    # Unscoped packages: node_modules/pkg/mcpee.json
    contracts.extend(sorted(node_modules.glob('*/mcpee.json')))

    seen_packages: set[str] = set()
    for contract_path in contracts:
        try:
            contract = json.loads(contract_path.read_text(encoding='utf-8'))
        except Exception:
            continue
        if not isinstance(contract, dict):
            continue

        package_name = str(contract.get('name', '')).strip()
        if not package_name:
            try:
                rel = contract_path.parent.relative_to(node_modules)
                package_name = str(rel).replace('\\', '/')
            except Exception:
                package_name = contract_path.parent.name

        if package_name in seen_packages:
            continue
        seen_packages.add(package_name)

        domain = str(contract.get('domain', '')).strip() or 'general'

        repo_name = f"{repo_name_prefix}{contract_path.parent.name}" if repo_name_prefix else contract_path.parent.name
        discovered.append(
            {
                'name': repo_name,
                'domain': domain,
                'type': 'npm',
                'package_name': package_name,
                'package_path': str(contract_path.parent.relative_to(repo_root)).replace('\\', '/'),
                'optional': False,
                'dependencies': [],
                'approval': {
                    'status': 'approved',
                    'approved_by': 'auto-discovery',
                    'approved_date': utc_now()[:10],
                    'review_ticket': 'AUTO-DISCOVERY',
                },
                'engines': {},
            }
        )
    return discovered

def main():
    parser = argparse.ArgumentParser(description='Generate intake artifacts from repo-registry using installed npm packages and mcpee.json catalogs.')
    parser.add_argument('--registry', default='repo-registry/repos.yml', help='Registry file path')
    parser.add_argument('--generated-root', default='repo-intake/generated', help='Output directory for generated artifacts')
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]

    registry_path = (repo_root / args.registry).resolve()
    generated_out = (repo_root / args.generated_root).resolve()
    ensure_dirs(generated_out)

    default_agent = 'generalist'
    default_skill = 'general-capability'
    default_engine = 'codegraph'

    registry = load_registry(registry_path)
    schema_version = str(registry.get('schema_version', '1.0'))
    registry_mode = str(registry.get('registry_mode', 'enterprise')).strip().lower() or 'enterprise'
    governance = registry.get('governance', {}) if isinstance(registry.get('governance', {}), dict) else {}
    repo_name_prefix = str(governance.get('repo_name_prefix', 'mcpee-')).strip()
    repos = registry.get('repos', [])
    if not isinstance(repos, list):
        repos = []

    auto_discovered = False
    if not repos and registry_mode == 'template':
        repos = discover_installed_boost_repos(repo_root, repo_name_prefix)
        auto_discovered = True

    summary_json = {
        'timestamp': utc_now(),
        'registry_mode': registry_mode,
        'schema_version': schema_version,
        'auto_discovered_from_node_modules': auto_discovered,
        'repos_count': len(repos),
        'repos': []
    }

    installed_repos: list[dict] = []

    for r in repos:
        dom = str(r.get('domain', '')).strip() or 'general'
        name = r['name']
        s = slug(name)
        repo_path, sync_meta = materialize_repo(repo_root, r)
        contract = load_mcpee_contract(repo_path)
        contract_domain = str(contract.get('domain', '')).strip()
        domain = contract_domain or dom
        approval = r.get('approval', {}) if isinstance(r.get('approval', {}), dict) else {}
        dependencies = r.get('dependencies', []) if isinstance(r.get('dependencies', []), list) else []
        engines = r.get('engines', {}) if isinstance(r.get('engines', {}), dict) else {}
        ag = str(contract.get('defaultAgent', '')).strip() or default_agent
        sk = str(contract.get('defaultSkill', '')).strip() or default_skill
        en = str(contract.get('defaultEngine', '')).strip() or str(engines.get('knowledge', '')).strip() or default_engine

        # Flat JSON-first output (no v2/version folders)
        flat_base = generated_out / s
        (flat_base / 'context-manifests').mkdir(parents=True, exist_ok=True)
        (flat_base / 'capabilities').mkdir(parents=True, exist_ok=True)
        (flat_base / 'audit').mkdir(parents=True, exist_ok=True)

        manifest = {
            'repo': name,
            'slug': s,
            'schema_version': schema_version,
            'domain': domain,
            'type': r.get('type', 'npm'),
            'package_name': r.get('package_name', ''),
            'package_path': r.get('package_path', ''),
            'resolved_path': str(repo_path).replace('\\', '/'),
            'sync': sync_meta,
            'agent': ag,
            'skill': sk,
            'engine': en,
            'engines': engines,
            'dependencies': dependencies,
            'approval': approval,
            'contract': {
                'name': str(contract.get('name', '')).strip(),
                'version': str(contract.get('version', '')).strip(),
                'schemaVersion': str(contract.get('schemaVersion', '')).strip(),
                'type': str(contract.get('type', '')).strip(),
                'description': str(contract.get('description', '')).strip(),
            },
            'generated_at': utc_now()
        }

        structure_manifest = build_structure_manifest(
            repo_root=repo_root,
            repo_name=name,
            slug_name=s,
            version='0',
            domain=domain,
            package_name=str(r.get('package_name', '')),
            repo_path=repo_path,
            sync=sync_meta,
        )

        contract_capabilities = contract.get('capabilities', []) if isinstance(contract.get('capabilities', []), list) else []
        capability_catalog: list[dict] = []
        for raw_capability in contract_capabilities:
            if not isinstance(raw_capability, dict):
                continue
            capability_id = str(raw_capability.get('id', '')).strip()
            if not capability_id:
                continue
            capability_catalog.append(
                {
                    'capability': capability_id,
                    'title': str(raw_capability.get('title', capability_id)).strip(),
                    'repo': name,
                    'domain': domain,
                    'agent': str(raw_capability.get('agent', ag)).strip() or ag,
                    'engine': en,
                    'dependencies': dependencies,
                    'instructions': {
                        'agent': str(raw_capability.get('agent', ag)).strip() or ag,
                        'skills': raw_capability.get('skills', []) if isinstance(raw_capability.get('skills', []), list) else [],
                        'specs': raw_capability.get('specs', []) if isinstance(raw_capability.get('specs', []), list) else [],
                        'prompts': raw_capability.get('prompts', []) if isinstance(raw_capability.get('prompts', []), list) else [],
                        'evals': raw_capability.get('evals', []) if isinstance(raw_capability.get('evals', []), list) else [],
                    },
                    'provider_needs': raw_capability.get('providerNeeds', []) if isinstance(raw_capability.get('providerNeeds', []), list) else [],
                    'generated_at': utc_now(),
                }
            )

        capability: dict
        if capability_catalog:
            capability = capability_catalog[0]
        else:
            capability = {
                'repo': name,
                'domain': domain,
                'agent': ag,
                'engine': en,
                'generated_at': utc_now(),
            }

        audit_event = {
            'timestamp': utc_now(),
            'action': 'repo_intake_generate',
            'repo': name,
            'slug': s,
            'status': 'success' if sync_meta.get('status') == 'installed' else 'warning',
            'schema_version': schema_version,
            'sync': sync_meta,
            'artifacts': ['manifest.json', 'capability.json', 'capability-catalog.json', 'structure-min.json', 'audit-log.jsonl']
        }

        (flat_base / 'context-manifests' / 'manifest.json').write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
        )
        (flat_base / 'capabilities' / 'capability.json').write_text(
            json.dumps(capability, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
        )
        (flat_base / 'capabilities' / 'capability-catalog.json').write_text(
            json.dumps({'capabilities': capability_catalog}, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
        )
        (flat_base / 'context-manifests' / 'structure-min.json').write_text(
            json.dumps(structure_manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
        )
        (flat_base / 'audit' / 'audit-log.jsonl').write_text(
            json.dumps(audit_event, ensure_ascii=False) + '\n', encoding='utf-8'
        )

        summary_json['repos'].append({
            'name': name,
            'slug': s,
            'domain': domain,
            'agent': ag,
            'engine': en
        })

        installed_repos.append(
            {
                'name': name,
                'package_name': str(r.get('package_name', '')).strip(),
                'package_root': repo_path,
                'sync_status': sync_meta.get('status', ''),
                'contract': contract,
            }
        )

    boost_runtime_sync = sync_installed_boost_artifacts(repo_root, installed_repos)
    (generated_out / 'reports' / 'boost-runtime-sync.json').write_text(
        json.dumps(boost_runtime_sync, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )

    instructions_synced = [
        item for item in boost_runtime_sync.get('synced', [])
        if isinstance(item, dict) and item.get('category') == 'instructions'
    ]
    instructions_skipped = [
        item for item in boost_runtime_sync.get('skipped', [])
        if isinstance(item, dict) and item.get('category') == 'instructions'
    ]
    instructions_sync = {
        'timestamp': boost_runtime_sync.get('timestamp', utc_now()),
        'managed_prefix': boost_runtime_sync.get('managed_prefix', 'mcpee-boost-'),
        'removed_previous_count': boost_runtime_sync.get('removed_previous_count', 0),
        'synced_count': len(instructions_synced),
        'skipped_count': len(instructions_skipped),
        'synced': instructions_synced,
        'skipped': instructions_skipped,
    }
    (generated_out / 'reports' / 'instructions-sync.json').write_text(
        json.dumps(instructions_sync, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )

    summary_json['boost_runtime_sync'] = {
        'synced_count': boost_runtime_sync.get('synced_count', 0),
        'skipped_count': boost_runtime_sync.get('skipped_count', 0),
        'removed_previous_count': boost_runtime_sync.get('removed_previous_count', 0),
        'report': 'repo-intake/generated/reports/boost-runtime-sync.json',
    }
    summary_json['instructions_sync'] = {
        'synced_count': instructions_sync.get('synced_count', 0),
        'skipped_count': instructions_sync.get('skipped_count', 0),
        'removed_previous_count': instructions_sync.get('removed_previous_count', 0),
        'report': 'repo-intake/generated/reports/instructions-sync.json',
    }

    # Remove stale flat repo folders that are no longer present in registry.
    generated_root = generated_out
    active_slugs = {slug(r['name']) for r in repos if isinstance(r, dict) and 'name' in r}
    reserved_dirs = {'reports'}
    if generated_root.exists():
        for child in generated_root.iterdir():
            if child.is_dir() and child.name not in active_slugs and child.name not in reserved_dirs:
                shutil.rmtree(child, ignore_errors=True)

    # Remove deprecated versioned tree if present.
    deprecated_v2 = generated_out / 'v2'
    if deprecated_v2.exists() and deprecated_v2.is_dir():
        shutil.rmtree(deprecated_v2, ignore_errors=True)

    (generated_out / 'reports' / 'SUMMARY.json').write_text(
        json.dumps(summary_json, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )

    print(f"Generated intake artifacts for {summary_json['repos_count']} repositories")


if __name__ == '__main__':
    main()

