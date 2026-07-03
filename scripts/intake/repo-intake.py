import argparse
from pathlib import Path
import json
import re
import shutil
import hashlib
import subprocess
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
            if k in ['domain', 'location', 'type', 'version', 'repo_url', 'branch', 'cache_location']:
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


def resolve_repo_path(repo_root: Path, location: str) -> Path:
    path = Path(location)
    if path.is_absolute():
        return path.resolve()
    return (repo_root / path).resolve()


def github_cache_path(repo_root: Path, repo_name: str, explicit_cache_location: str = '') -> Path:
    if explicit_cache_location:
        return resolve_repo_path(repo_root, explicit_cache_location)
    return (repo_root / '.cache' / 'github-repos' / slug(repo_name)).resolve()


def materialize_repo(repo_root: Path, repo: dict) -> tuple[Path, dict]:
    repo_type = str(repo.get('type', 'local')).strip().lower() or 'local'
    location = str(repo.get('location', '')).strip()
    if repo_type == 'local':
        repo_path = resolve_repo_path(repo_root, location)
        return repo_path, {
            'mode': 'local',
            'source': location,
            'resolved_path': str(repo_path).replace('\\', '/'),
            'status': 'ok' if repo_path.exists() else 'missing',
        }

    repo_name = str(repo.get('name', '')).strip()
    repo_url = str(repo.get('repo_url', '')).strip()
    branch = str(repo.get('branch', '')).strip() or 'main'
    cache_location = str(repo.get('cache_location', '')).strip()
    cache_path = github_cache_path(repo_root, repo_name, cache_location)
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    sync_meta = {
        'mode': 'github',
        'repo_url': repo_url,
        'branch': branch,
        'resolved_path': str(cache_path).replace('\\', '/'),
        'status': 'pending',
    }

    if not repo_url:
        sync_meta['status'] = 'missing_repo_url'
        return cache_path, sync_meta

    try:
        if (cache_path / '.git').exists():
            subprocess.run(['git', '-C', str(cache_path), 'fetch', '--depth', '1', 'origin', branch], check=True, capture_output=True, text=True)
            subprocess.run(['git', '-C', str(cache_path), 'checkout', '--force', 'FETCH_HEAD'], check=True, capture_output=True, text=True)
            sync_meta['status'] = 'updated'
        else:
            subprocess.run(['git', 'clone', '--depth', '1', '--branch', branch, repo_url, str(cache_path)], check=True, capture_output=True, text=True)
            sync_meta['status'] = 'cloned'
    except subprocess.CalledProcessError as exc:
        sync_meta['status'] = 'sync_failed'
        sync_meta['error'] = (exc.stderr or exc.stdout or str(exc)).strip()

    return cache_path, sync_meta


def file_fingerprint(path: Path) -> dict:
    stat = path.stat()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    return {
        'size_bytes': stat.st_size,
        'mtime_utc': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        'sha256_16': digest,
    }


def build_structure_manifest(repo_root: Path, repo_name: str, slug_name: str, version: str, domain: str, location: str, repo_path: Path | None = None, sync: dict | None = None) -> dict:
    repo_path = repo_path or resolve_repo_path(repo_root, location)
    structure = {
        'schema_version': '1.0',
        'repo': repo_name,
        'slug': slug_name,
        'version': version,
        'domain': domain,
        'location': location,
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
        'AGENTS.md',
        'README.md',
        'ARCHITECTURE.md',
        '.github/skills',
        '.github/prompts',
        'scripts',
        'specs',
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

def main():
    parser = argparse.ArgumentParser(description='Generate intake artifacts from repo-registry, including github-backed cached repos.')
    parser.add_argument('--registry', default='repo-registry/repos.yml', help='Registry file path')
    parser.add_argument('--generated-root', default='repo-intake/generated', help='Output directory for generated artifacts')
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]

    registry_path = (repo_root / args.registry).resolve()
    legacy_out = (repo_root / args.generated_root).resolve()
    ensure_dirs(legacy_out)

    defaults = {
        'dba': ('dba-agent', 'database-analysis', 'Graphify'),
        'iot': ('iot-agent', 'iot-architecture', 'GitNexus/CodeGraph + Graphify'),
        'azure-rag': ('rag-azure-agent', 'azure-rag-enterprise', 'Azure RAG Builder'),
        'backend': ('dev-agent', 'backend-coding', 'CodeGraph'),
        'frontend': ('frontend-agent', 'frontend-coding', 'CodeGraph'),
        'ux-ui': ('ux-ui-agent', 'ux-ui-governance', 'Graphify'),
        'community-content': ('community-manager-agent', 'community-content', 'Graphify'),
        'legacy': ('legacy-agent', 'legacy-migration', 'GitNexus')
    }

    registry = load_registry(registry_path)
    schema_version = str(registry.get('schema_version', '1.0'))
    repos = registry.get('repos', [])

    summary_json = {
        'timestamp': utc_now(),
        'schema_version': schema_version,
        'repos_count': len(repos),
        'repos': []
    }

    for r in repos:
        dom = r.get('domain', 'backend')
        ag, sk, en = defaults.get(dom, defaults['backend'])
        name = r['name']
        s = slug(name)
        repo_path, sync_meta = materialize_repo(repo_root, r)

        # Flat JSON-first output (no v2/version folders)
        flat_base = legacy_out / s
        (flat_base / 'context-manifests').mkdir(parents=True, exist_ok=True)
        (flat_base / 'capabilities').mkdir(parents=True, exist_ok=True)
        (flat_base / 'audit').mkdir(parents=True, exist_ok=True)

        approval = r.get('approval', {}) if isinstance(r.get('approval', {}), dict) else {}
        dependencies = r.get('dependencies', []) if isinstance(r.get('dependencies', []), list) else []
        engines = r.get('engines', {}) if isinstance(r.get('engines', {}), dict) else {}

        manifest = {
            'repo': name,
            'slug': s,
            'schema_version': schema_version,
            'domain': dom,
            'location': r.get('location', ''),
            'type': r.get('type', 'local'),
            'repo_url': r.get('repo_url', ''),
            'branch': r.get('branch', ''),
            'cache_location': r.get('cache_location', ''),
            'resolved_path': str(repo_path).replace('\\', '/'),
            'sync': sync_meta,
            'agent': ag,
            'skill': sk,
            'engine': en,
            'engines': engines,
            'dependencies': dependencies,
            'approval': approval,
            'generated_at': utc_now()
        }

        structure_manifest = build_structure_manifest(
            repo_root=repo_root,
            repo_name=name,
            slug_name=s,
            version='0',
            domain=dom,
            location=str(r.get('location', '')),
            repo_path=repo_path,
            sync=sync_meta,
        )

        capability = {
            'capability': sk,
            'repo': name,
            'domain': dom,
            'agent': ag,
            'engine': en,
            'dependencies': dependencies,
            'generated_at': utc_now()
        }

        audit_event = {
            'timestamp': utc_now(),
            'action': 'repo_intake_generate',
            'repo': name,
            'slug': s,
            'status': 'success' if sync_meta.get('status') not in {'missing_repo_url', 'sync_failed'} else 'warning',
            'schema_version': schema_version,
            'sync': sync_meta,
            'artifacts': ['manifest.json', 'capability.json', 'structure-min.json', 'audit-log.jsonl']
        }

        (flat_base / 'context-manifests' / 'manifest.json').write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
        )
        (flat_base / 'capabilities' / 'capability.json').write_text(
            json.dumps(capability, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
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
            'domain': dom,
            'agent': ag,
            'engine': en
        })

    # Remove stale flat repo folders that are no longer present in registry.
    generated_root = legacy_out
    active_slugs = {slug(r['name']) for r in repos if isinstance(r, dict) and 'name' in r}
    reserved_dirs = {'reports'}
    if generated_root.exists():
        for child in generated_root.iterdir():
            if child.is_dir() and child.name not in active_slugs and child.name not in reserved_dirs:
                shutil.rmtree(child, ignore_errors=True)

    # Remove legacy versioned tree if present.
    legacy_v2 = legacy_out / 'v2'
    if legacy_v2.exists() and legacy_v2.is_dir():
        shutil.rmtree(legacy_v2, ignore_errors=True)

    (legacy_out / 'reports' / 'SUMMARY.json').write_text(
        json.dumps(summary_json, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )

    print(f"Generated intake artifacts for {summary_json['repos_count']} repositories")


if __name__ == '__main__':
    main()
