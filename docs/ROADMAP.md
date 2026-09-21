# ROADMAP

El roadmap debe mantenerse corto. No agregar ideas hipotéticas sin prioridad de producto.

## P0 — Consolidación y seguridad

1. Completar auditoría de migración documental contra el repositorio.
2. Verificar matriz real de acceso Anonymous / Free / Paid / Admin.
3. Verificar RLS y endpoints para impedir que Free acceda a capacidades premium.
4. Reconciliar migrations reportadas vs migrations realmente aplicadas.
5. Validar Venta rápida con Showroom + Depósito.
6. Validar anulación de ventas y restauración idempotente de stock.
7. Reconciliar el estado del sistema XP y cualquier migration incompleta.
8. Reconciliar el estado del e-commerce/pagos y migrations históricas.

## P1 — Producto actual

1. Estabilizar el funnel Calculadora Demo → registro Free → personalización.
2. Confirmar que Paid conserva comportamiento de Calculadora/Taller sin regresiones.
3. Consolidar Mi Negocio:
   - Catálogo;
   - Venta rápida;
   - Ventas;
   - Reposición;
   - métricas operativas.
4. Confirmar consistencia de pricing, recetas, multifilamento y componentes.
5. Mantener documentación alineada con cambios estructurales.

## P1b — Explorar Modelos

1. Conseguir credenciales (MyMiniFactory) y permiso de uso (MyMiniFactory y Thingiverse) antes de activar los providers en producción.
2. Segunda fuente solo si tiene API oficial y términos compatibles (Cults3D pendiente de leer términos).
3. Después: filtros por licencia refinados, guardar como producto (acción explícita) y tool `models.search` de Stampy.

## P2 — Operación y crecimiento

1. Completar o validar ingreso de stock por scanner si sigue pendiente.
2. Mejorar onboarding/ayuda contextual sin tours invasivos.
3. Continuar maduración de Mi Tienda/e-commerce según estado real.
4. Ampliar Stampy únicamente con tools acotadas y autorizadas.

## Later

- misiones/retención sobre XP;
- integración opcional de niveles con sorteos después de revisión legal;
- materialización asistida de preferencias Free al convertirse en Paid;
- soporte de ubicaciones adicionales si existe necesidad real.

No mover elementos a `TASKS.md` hasta que sean trabajo próximo y concreto.
