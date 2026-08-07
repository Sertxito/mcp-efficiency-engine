# Repo Intake

Este modulo transforma paquetes npm registrados en
capacidades consumibles por el routing.

Soporta un modo de origen:

- `type: npm`: consume un paquete instalado en `node_modules` y su contrato `mcpee.json`.

## Estructura

- `templates/`: plantillas base (`agent`, `skill`, `context-manifest`).
- `generated/reports/`: reportes JSON operativos.
- `generated/<slug>/`: salida canonica JSON-first por repo (sin versionado).

## Nota sobre carpetas vacias

Si ves carpetas antiguas de layouts deprecados, se pueden eliminar.
La salida activa vive en `generated/<slug>/...` y `generated/reports/*.json`.

## Flujo recomendado

1. Validar registry.
  Comando:
  `pwsh -NoProfile -ExecutionPolicy Bypass -File`
  `.\scripts\intake\validate-repo-registry.ps1 -Strict`
2. Ejecutar intake: `.\scripts\intake\run-repo-intake.cmd`
3. Revisar reportes: `repo-intake/generated/reports/`

Registry modes:

- `repo-registry/repos.yml`: modo `enterprise`, con repos reales y validacion estricta.
- `repo-registry/repos.template.json`: modo `template`, portable,
  permite `repos: []` mientras se configura el ecosistema.

Bootstrap recomendado para modo portable en Windows:

```powershell
.\scripts\intake\init-template-registry.cmd
.\scripts\intake\run-repo-intake.cmd
```

Si el registry plantilla sigue vacio, el intake no falla.
Genera reportes con `0` repos y deja el sistema listo
para completar `repo-registry/repos.yml` mas tarde.

Al inicializar la plantilla, el script pide interactivamente:

- `owner` del registry
- prefijo de nombres de repo
- si quieres crear una primera entrada de repo
- y, si la creas, nombre, dominio y paquete npm
1. Consumir contratos planos: `repo-intake/generated/<slug>/`

## Registry npm (uso real)

Entrada minima para un paquete npm en `repo-registry/repos.yml`:

```json
{
  "name": "boost_backend_remote",
  "domain": "backend",
  "type": "npm",
  "package_name": "@mcpee/backend",
  "package_path": "node_modules/@mcpee/backend",
  "approval": {
    "status": "approved",
    "approved_by": "platform-team",
    "approved_date": "2026-07-03",
    "review_ticket": "PLATFORM-GH-001"
  },
  "dependencies": [],
  "engines": {
    "knowledge": "codegraph",
    "execution": "none",
    "snapshot": "repomix"
  }
}
```

Comportamiento operativo:

- `validate-repo-registry.py --strict` exige `package_name`
  y que el paquete exista en `node_modules`.
- `repo-intake.py` lee `mcpee.json` del paquete
  y genera un catalogo completo de capacidades.
- El routing consume
  `repo-intake/generated/<slug>/capabilities/capability-catalog.json`
  y puede resolver cualquier `capability.id` del contrato.
