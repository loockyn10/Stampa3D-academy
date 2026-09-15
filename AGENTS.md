# AGENTS.md

Instrucciones permanentes para Codex y agentes de implementación que trabajen en este repositorio.

## 1. Antes de trabajar

Leer, como mínimo:

1. `/docs/PROJECT_CONTEXT.md`
2. `/docs/PRODUCT.md`
3. `/docs/ARCHITECTURE.md`
4. `/docs/CURRENT_STATE.md`
5. `/docs/DECISIONS.md`
6. `/docs/TASKS.md`
7. `/AI_WORKFLOW.md`

Después inspeccionar el código real relacionado con la tarea.

No asumir que la documentación describe exactamente el estado del repo si contiene `REQUIERE VERIFICACIÓN EN REPO`.

## 2. Fuente de verdad

Prioridad:

1. repositorio actual: código, migrations, tests, configuración;
2. documentación vigente;
3. especificación de la tarea.

Si código y documentación contradicen entre sí:

- no elegir silenciosamente;
- informar la contradicción;
- determinar si es drift de documentación, bug de código o decisión no aplicada.

## 3. Alcance

Implementar únicamente la tarea pedida y los cambios estrictamente necesarios.

No cambiar silenciosamente:

- arquitectura;
- reglas de negocio;
- modelo de permisos;
- contratos globales;
- source of truth;
- schema compartido;
- comportamiento Free/Paid.

Si la solución requiere una decisión estructural no documentada, detenerse y reportarla.

## 4. Seguridad

Reglas críticas:

- `authenticated != paid`;
- no debilitar RLS para resolver UI;
- no confiar en `user_id` del frontend;
- no confiar en cantidades/splits de stock del frontend;
- no abrir tablas premium a Free;
- no crear APIs genéricas de mutación;
- Stampy context ≠ autorización;
- operations críticas deben validar auth, ownership y estado actual.

## 5. Dominio

Preservar invariantes de `/docs/PRODUCT.md`.

Especialmente:

- no duplicar stock fabricado;
- fabricado ≠ reventa;
- Catálogo comercial no duplica receta productiva;
- venta con locations usa Showroom + Depósito;
- anulación de venta no es hard-delete;
- Free no crea bobinas/stock físico;
- Calculadora reutiliza un único motor;
- XP es server-authoritative.

## 6. Migraciones y base de datos

Por defecto:

- no modificar migrations ya aplicadas;
- crear una nueva migration;
- no ejecutar SQL remoto salvo autorización explícita;
- no hacer cambios destructivos de datos sin plan explícito;
- comprobar nombres de columnas/tipos contra migrations e INSERTs reales;
- considerar idempotencia, locks, constraints y RLS.

Si no se conoce qué migrations están aplicadas remotamente, marcarlo.

## 7. Git y multiagente

Antes de cambiar:

- revisar `git status`;
- revisar branch/worktree;
- preservar cambios ajenos.

Por defecto, no hacer commit, push, merge o reset destructivo salvo que la tarea lo autorice.

Si otro agente trabaja simultáneamente:

- usar tareas independientes; o
- usar branch/worktree separado.

Si continuás el trabajo de otro agente, partir del código actualizado, no de su descripción textual.

## 8. Implementación

Preferencias:

- reutilizar componentes/helpers existentes;
- evitar duplicar motores de negocio;
- endpoints públicos con DTO mínimo;
- evitar `select("*")` cuando expone datos de más;
- custom dialogs/selects en lugar de browser UI inconsistente;
- mobile y accesibilidad como requisitos;
- no usar hacks temporales para ocultar causas estructurales.

## 9. Validación

Determinar comandos desde `package.json`.

Cuando corresponda, ejecutar:

- tests focalizados;
- tests de regresión relevantes;
- `git diff --check`;
- TypeScript/typecheck;
- build de producción.

No afirmar “todo verde” si una validación no fue ejecutada.

## 10. Reporte

Reportar en este orden:

1. causa/problema encontrado;
2. solución aplicada;
3. decisiones o supuestos;
4. archivos relevantes;
5. migrations/SQL requeridos;
6. validaciones ejecutadas;
7. pruebas manuales;
8. riesgos o puntos pendientes.

Distinguir:

- implementado;
- no implementado;
- no verificable;
- bloqueado por decisión.

## 11. Documentación

Actualizar `/docs` cuando una tarea cambie:

- arquitectura;
- reglas de producto;
- permisos;
- source of truth;
- estado relevante;
- roadmap/tareas.

No registrar cada detalle histórico. Mantener solo estado y decisiones vigentes.
