# Terraform engineering

**Scope:** Terraform modules, provider configuration, plans and state boundaries.
**Version boundary:** inspect required_version, provider constraints, dependency
lockfile, backend and workspace; preserve supported provider/module contracts.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Keep modules cohesive with typed/validated inputs and documented outputs.
  Avoid hidden environment dependencies and broad unrelated resource changes.
- Treat state and saved plans as sensitive artifacts. Respect remote locking;
  never edit state, force-unlock or import/remove resources without exact approval.
- Use stable resource identities, explicit moves when appropriate and reviewed
  replacement behavior. Do not use targeting to disguise an incomplete plan.
- Preserve provider pins and backend separation; secret variables marked
  sensitive may still exist in state, so access controls remain necessary.

## Module and lifecycle design
- Choose stable for_each keys for resources with independent identities; changes
  to count indexes or keys can cause unintended replacements. Review dependency
  edges from references before adding broad depends_on.
- Validate inputs and meaningful outputs. Avoid fragile cross-module coupling,
  provisioners and local-exec as substitutes for provider-managed resources;
  any external side effects need their own explicit controls.
- Review lifecycle settings: ignore_changes can conceal drift and
  create_before_destroy can require extra capacity or violate naming constraints.
  Neither proves safe recovery.
- Separate environments/accounts through reviewed state and access boundaries;
  workspace naming alone is not isolation. Keep locking and state backups
  appropriate to the selected backend.
- Treat refresh, data sources, imports and plans as real provider interactions,
  not offline syntax checks. Re-plan when inputs/state change and apply only the
  reviewed artifact to its intended environment.

## Verification and performance
Use existing fmt/validate/lint checks. Plan can contact provider APIs and read
sensitive state; obtain the required scope and authorization first.
Review the full saved plan, drift, destroys/replacements, permissions and cost
before a separately approved apply. Check health and recovery after deployment;
a successful plan is neither deployment nor operational validation.

Official references:
- https://developer.hashicorp.com/terraform/language
- https://developer.hashicorp.com/terraform/cli/commands/plan
- https://developer.hashicorp.com/terraform/language/state/sensitive-data
