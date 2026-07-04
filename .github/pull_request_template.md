<!-- 
  MCP Efficiency Engine — Pull Request Template
  Llena todas las secciones antes de enviar el PR.
-->

## Descripción

<!-- Explica qué cambios hace este PR y por qué. -->

## Tipo de cambio

- [ ] 🐛 Bugfix (corrección sin breaking changes)
- [ ] ✨ Feature (nueva funcionalidad)
- [ ] 📚 Docs (documentación)
- [ ] ♻️ Refactor (mejora sin cambios funcionales)
- [ ] ⚙️ Chore (actualizaciones tooling/config)

## Checklist de cambios

### Código y specs

- [ ] Los cambios cumplen con `specs/*.spec.md` aplicables
- [ ] Todos los tests pasan: `py -3 .\scripts\intake\run-routing-evals.py`
- [ ] Se ejecutó `validate-context.ps1` sin errores
- [ ] Se ejecutó `compileall` en scripts sin errores
- [ ] Cambios sin breaking changes o están documentados

### Seguridad y políticas

- [ ] Sin secretos, tokens ni credenciales reales
- [ ] Alineado con `policies/security-policy.md` si aplica
- [ ] Sin cambios en RBAC o permisos sin justificación

### Documentación

- [ ] README o docs actualizados si hay cambios públicos
- [ ] Cambios en `specs/` incluyen sección `## Validación mínima`
- [ ] Scripts nuevos incluyen docstring y ayuda

### Validaciones de specs

Si aplica a tu cambio, ejecuta:

```bash
# Routing y arquitectura
py -3 .\scripts\intake\run-routing-evals.py

# Seguridad
py -3 .\scripts\intake\validate-security.py

# Database (si aplica)
py -3 .\scripts\intake\validate-database-routing.py

# RAG local (si aplica)
py -3 .\scripts\intake\validate-rag-routing.py

# Contexto general
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1
```

## Enlaces y referencias

<!-- Links a issues, specs, arquitectura o decisiones relevantes. -->

## Cambios destacados

<!-- Puntos clave que deben revisar: comportamiento, breaking changes, rendimiento, etc. -->

---

**Nota:** Este PR se cierra automáticamente si no pasa los evals. Asegúrate de ejecutar todas las validaciones localmente antes de enviar.
