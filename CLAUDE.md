# CLAUDE.md

Claude Code actúa como agente de implementación/revisión del repositorio.

## Canon

Antes de trabajar leer:

- `AGENTS.md`
- `AI_WORKFLOW.md`
- documentación relevante en `/docs`

`AGENTS.md` es la política canónica para agentes de repositorio. Este archivo agrega pautas específicas para Claude Code.

## Forma de trabajo

1. Inspeccionar el repositorio antes de proponer cambios.
2. Mantener el contexto de la tarea pequeño: leer solo los dominios/archivos necesarios.
3. No reconstruir decisiones desde conversaciones antiguas.
4. No asumir que un reporte de Codex describe el código actual: comprobar el diff/repo.
5. Si continuás una feature iniciada por otro agente, partir del estado actualizado del branch/worktree.
6. Si una solución exige cambiar arquitectura, permisos, schema global o una regla de producto, detenerse y explicitar la decisión.

## Revisión

Cuando se te use como segundo agente, priorizar:

- correctness;
- seguridad/RLS;
- consistencia con reglas de producto;
- condiciones de carrera;
- idempotencia;
- schema drift;
- regresiones Free/Paid;
- duplicación de source of truth;
- tests faltantes.

No reescribir una implementación funcional únicamente por preferencia estilística.

## Implementación

Seguir las mismas restricciones de `AGENTS.md`:

- no SQL remoto sin permiso;
- no migrations aplicadas editadas;
- no commit/push/reset salvo autorización;
- no RLS más débil como atajo;
- no inventar stock;
- no hard-delete de ventas cuando corresponde anulación;
- no duplicar pricing;
- no herramientas genéricas de DB para Stampy.

## Handoff

Al terminar, dejar un reporte corto y factual con:

- qué se verificó;
- qué se cambió;
- qué no se pudo verificar;
- tests/build ejecutados;
- migration/manual steps;
- cualquier cambio que deba reflejarse en `/docs`.
