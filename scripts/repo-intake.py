from pathlib import Path
import json
import re
import shutil
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


def ensure_dirs(base):
    for d in ['agents', 'skills', 'context-manifests', 'reports', 'capabilities', 'audit']:
        (base / d).mkdir(parents=True, exist_ok=True)

def main():
    legacy_out = Path('repo-intake/generated')
    ensure_dirs(legacy_out)

    defaults = {
        'dba': ('dba-agent', 'database-analysis', 'Graphify'),
        'iot': ('iot-agent', 'iot-architecture', 'GitNexus/CodeGraph + Graphify'),
        'azure-rag': ('azure-rag-agent', 'azure-rag-enterprise', 'Azure RAG Builder'),
        'dev': ('dev-agent', 'dev-coding', 'CodeGraph'),
        'legacy': ('legacy-agent', 'legacy-migration', 'GitNexus')
    }

    registry = load_registry('repo-registry/repos.yml')
    schema_version = str(registry.get('schema_version', '1.0'))
    repos = registry.get('repos', [])

    summary_md = []
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
        version = str(r.get('version', '1.0.0'))

        # Legacy markdown output (kept for backward compatibility)
        (legacy_out / 'agents' / f'{s}.agent.md').write_text(
            f'# {ag}\n\nRepo: {name}\nDominio: {dom}\nMotor: {en}\n', encoding='utf-8'
        )
        (legacy_out / 'skills' / f'{s}.skill.md').write_text(
            f'# {sk}\n\nRepo: {name}\nDominio: {dom}\n', encoding='utf-8'
        )
        (legacy_out / 'context-manifests' / f'{s}.context.md').write_text(
            f'# Context Manifest — {name}\n\nDominio: {dom}\nLocation: {r.get("location", "")}\nMotor: {en}\n',
            encoding='utf-8'
        )
        (legacy_out / 'reports' / f'{s}.report.md').write_text(
            f'# Intake Report — {name}\n\n{dom} -> {ag} -> {en}\n', encoding='utf-8'
        )

        # V2 JSON-first output
        v2_base = Path('repo-intake/generated/v2') / s / version
        ensure_dirs(v2_base)

        approval = r.get('approval', {}) if isinstance(r.get('approval', {}), dict) else {}
        dependencies = r.get('dependencies', []) if isinstance(r.get('dependencies', []), list) else []
        engines = r.get('engines', {}) if isinstance(r.get('engines', {}), dict) else {}

        manifest = {
            'repo': name,
            'slug': s,
            'version': version,
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

        capability = {
            'capability': sk,
            'repo': name,
            'version': version,
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
            'version': version,
            'status': 'success',
            'schema_version': schema_version,
            'artifacts': ['manifest.json', 'capability.json', 'legacy-markdown']
        }

        (v2_base / 'context-manifests' / 'manifest.json').write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
        )
        (v2_base / 'capabilities' / 'capability.json').write_text(
            json.dumps(capability, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
        )
        (v2_base / 'audit' / 'audit-log.jsonl').write_text(
            json.dumps(audit_event, ensure_ascii=False) + '\n', encoding='utf-8'
        )

        summary_md.append(f'- {name}: {dom} -> {ag} -> {en} (v{version})')
        summary_json['repos'].append({
            'name': name,
            'slug': s,
            'domain': dom,
            'agent': ag,
            'engine': en,
            'version': version
        })

    # Remove stale v2 repo folders that are no longer present in registry.
    v2_root = Path('repo-intake/generated/v2')
    active_slugs = {slug(r['name']) for r in repos if isinstance(r, dict) and 'name' in r}
    if v2_root.exists():
        for child in v2_root.iterdir():
            if child.is_dir() and child.name not in active_slugs:
                shutil.rmtree(child, ignore_errors=True)

    (legacy_out / 'reports' / 'SUMMARY.md').write_text(
        '# Summary\n\n' + '\n'.join(summary_md) + '\n', encoding='utf-8'
    )
    (legacy_out / 'reports' / 'SUMMARY.json').write_text(
        json.dumps(summary_json, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )

    print(f'Generated intake artifacts for {len(summary_md)} repositories')


if __name__ == '__main__':
    main()
