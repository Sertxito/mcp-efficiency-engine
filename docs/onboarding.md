# Onboarding

## 1) Prerequisitos

- Windows + PowerShell
- Node.js + npm (para `token-saver-mcp`, `codegraph`, `gitnexus`)
- Python 3
- `uv` (para `graphify`)

## 2) Setup inicial (una sola vez)

```powershell
.\scripts\setup-prerequisites.ps1
```

Opciones útiles si quieres saltar algún componente:

```powershell
.\scripts\setup-prerequisites.ps1 -SkipGraphify
.\scripts\setup-prerequisites.ps1 -SkipCodebaseMemory
```

## 3) Validación mínima

```powershell
.\scripts\validate-context.ps1
.\scripts\run-repo-intake.cmd
python .\scripts\run-routing-evals.py
```

## 4) Lectura recomendada

- `README.md`
- `FINAL_USAGE_GUIDE.md`
- `ARCHITECTURE.md`
- `optimization/ALWAYS_ON_OPTIMIZATION.md`
