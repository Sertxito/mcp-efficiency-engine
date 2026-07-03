# Repo Intake

Este modulo transforma repos registrados en capacidades consumibles por el routing.

Soporta dos modos de origen:

- `type: local`: usa un repo ya presente en disco.
- `type: github`: materializa una copia cacheada local desde GitHub y genera los mismos artefactos de intake que el modo local.

## Estructura

- `templates/`: plantillas base (`agent`, `skill`, `context-manifest`).
- `generated/reports/`: reportes JSON operativos.
- `generated/<slug>/`: salida canonica JSON-first por repo (sin versionado).

## Nota sobre carpetas vacias

Si ves carpetas antiguas de layouts legacy, se pueden eliminar.
La salida activa vive en `generated/<slug>/...` y `generated/reports/*.json`.

## Flujo recomendado

1. Validar registry: `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict`
2. Ejecutar intake: `.\scripts\intake\run-repo-intake.cmd`
3. Revisar reportes: `repo-intake/generated/reports/`

Registry modes:

- `repo-registry/repos.yml`: modo `enterprise`, con repos reales y validacion estricta.
- `repo-registry/repos.template.json`: modo `template`, portable, permite `repos: []` mientras se configura el ecosistema.

Bootstrap recomendado para modo portable en Windows:

```powershell
.\scripts\intake\init-template-registry.cmd
.\scripts\intake\run-repo-intake.cmd
```

Si el registry plantilla sigue vacio, el intake no falla: genera reportes con `0` repos y deja el sistema listo para completar `repo-registry/repos.yml` mas tarde.

Al inicializar la plantilla, el script pide interactivamente:

- `owner` del registry
- prefijo de nombres de repo
- si quieres crear una primera entrada de repo
- y, si la creas, nombre, dominio y localizacion
4. Consumir contratos planos: `repo-intake/generated/<slug>/`

## Registry GitHub (uso real)

Entrada minima para un repo GitHub en `repo-registry/repos.yml`:

```json
{
	"name": "boost_backend_remote",
	"domain": "backend",
	"type": "github",
	"repo_url": "https://github.com/your-org/your-repo.git",
	"branch": "main",
	"cache_location": ".cache/github-repos/boost_backend_remote",
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

- `validate-repo-registry.py --strict` exige `repo_url` valido y `git` disponible.
- `repo-intake.py` clona o refresca el repo en `cache_location`.
- El routing y los motores consumen los artefactos generados igual que con repos locales.
- La cache local vive en `.cache/github-repos/` por defecto y no se debe commitear.
