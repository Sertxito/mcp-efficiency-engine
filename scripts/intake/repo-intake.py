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
            if k in ['domain', 'location', 'type', 'version']:
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


def file_fingerprint(path: Path) -> dict:
    stat = path.stat()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    return {
        'size_bytes': stat.st_size,
        'mtime_utc': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        'sha256_16': digest,
    }


def build_structure_manifest(repo_root: Path, repo_name: str, slug_name: str, version: str, domain: str, location: str) -> dict:
    repo_path = resolve_repo_path(repo_root, location)
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
    repo_root = Path(__file__).resolve().parents[2]

    legacy_out = Path('repo-intake/generated')
    ensure_dirs(legacy_out)

    defaults = {
        'dba': ('dba-agent', 'database-analysis', 'Graphify'),
        'iot': ('iot-agent', 'iot-architecture', 'GitNexus/CodeGraph + Graphify'),
        'azure-rag': ('rag-azure-agent', 'azure-rag-enterprise', 'Azure RAG Builder'),
        'dev': ('dev-agent', 'dev-coding', 'CodeGraph'),
        'legacy': ('legacy-agent', 'legacy-migration', 'GitNexus')
    }

    registry = load_registry('repo-registry/repos.yml')
    schema_version = str(registry.get('schema_version', '1.0'))
    repos = registry.get('repos', [])

    summary_json = {
        'timestamp': utc_now(),
        'schema_version': schema_version,
        'repos_count': len(repos),
        'repos': []
    }

    for r in repos:
        dom = r.get('domain', 'dev')
        ag, sk, en = defaults.get(dom, defaults['dev'])
        name = r['name']
        s = slug(name)

        # Flat JSON-first output (no v2/version folders)
        flat_base = Path('repo-intake/generated') / s
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
            'status': 'success',
            'schema_version': schema_version,
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
    generated_root = Path('repo-intake/generated')
    active_slugs = {slug(r['name']) for r in repos if isinstance(r, dict) and 'name' in r}
    reserved_dirs = {'reports'}
    if generated_root.exists():
        for child in generated_root.iterdir():
            if child.is_dir() and child.name not in active_slugs and child.name not in reserved_dirs:
                shutil.rmtree(child, ignore_errors=True)

    # Remove legacy versioned tree if present.
    legacy_v2 = Path('repo-intake/generated/v2')
    if legacy_v2.exists() and legacy_v2.is_dir():
        shutil.rmtree(legacy_v2, ignore_errors=True)

    (legacy_out / 'reports' / 'SUMMARY.json').write_text(
        json.dumps(summary_json, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )

    print(f"Generated intake artifacts for {summary_json['repos_count']} repositories")


if __name__ == '__main__':
    main()
