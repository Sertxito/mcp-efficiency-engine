# Caveman Mode

## Definición

Caveman Mode es la política de interacción para reducir ruido y acelerar loops.

```txt
Caveman = UX / interaction layer
```

## Objetivo

Reducir:

- explicaciones largas,
- introducciones innecesarias,
- repeticiones,
- salida decorativa,
- tokens de respuesta.

## Modo estándar

```txt
Problema -> causa -> acción -> validación
```

## Ejemplo

Normal:

```txt
He revisado el sistema y parece que podría haber un problema relacionado con...
```

Caveman:

```txt
Causa: token expirado no refresca redirect.
Fix: revisar AuthService.refreshToken().
Validar: test expiry + redirect.
```

## Niveles

### Lite

Bullets cortos, frases completas.

### Full

Muy directo, sin introducciones.

### Ultra

Solo datos críticos. Útil para CLI/debug.

## No usar Caveman Ultra cuando

- la respuesta es para formación,
- el usuario pide explicación didáctica,
- hay que convencer a stakeholders,
- hay que documentar decisiones.
