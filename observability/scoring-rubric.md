# Scoring Rubric

## Componentes y pesos

- Routing score: 40%
- Grounding score: 25%
- Efficiency score: 20%
- Caveman score: 15%

## Definicion de cada score

### Routing score

- Coincidencia de `agent` esperado.
- Coincidencia de `engine` esperado.
- Aplicacion correcta de `prompt.selected`.

### Grounding score

- `grounded=true` cuando el caso exige fuentes.
- `sources` no vacio en consultas documentales.

### Efficiency score

- Perfil Token Saver correcto.
- Sin tool misuse ni switching innecesario.

### Caveman score

- Respuesta directa y sin relleno.
- Conserva evidencia cuando la tarea la exige.

## Umbrales finales

- `>= 90`: Excelente
- `80-89`: Aceptable
- `70-79`: Mejorable
- `< 70`: No apto
