# DECISIONS

Solo se registran decisiones vigentes o necesarias para evitar reabrir problemas ya resueltos.

## D001 — El repositorio y `/docs` son la memoria permanente

**Estado:** Accepted

El historial de chats no debe ser requisito para continuar el proyecto. Código y repo tienen prioridad factual; `/docs` conserva producto, arquitectura y decisiones.

Si código y docs difieren, señalar la contradicción antes de asumir cuál es correcto.

## D002 — Separación de dominios

**Estado:** Accepted

- Academia = aprender.
- Mi Taller = fabricar.
- Mi Negocio = vender.

Esta separación debe mantenerse aunque cambie la navegación visual.

## D003 — Producto productivo y producto comercial no son la misma entidad conceptual

**Estado:** Accepted

Mi Taller describe cómo fabricar. Mi Negocio describe qué vender.

Un artículo fabricado comercialmente referencia su producto productivo; no duplica receta, costo productivo o stock terminado.

## D004 — Fabricado y reventa son tipos comerciales distintos

**Estado:** Accepted

Fabricado deriva de Mi Taller. Reventa tiene stock/costo comercial propio y no requiere receta productiva.

## D005 — El stock terminado no se duplica

**Estado:** Accepted

Las mismas unidades fabricadas no pueden tener dos fuentes de verdad.

Registrar producción consume materiales y aumenta unidades terminadas. Ajustar inventario corrige unidades sin consumir materiales.

## D006 — Showroom y Depósito son ubicaciones del mismo stock comercial

**Estado:** Accepted

Si están habilitados:

`stock total = showroom + depósito`

Venta disponible = total. El backend consume Showroom primero y Depósito por el faltante.

No crear transferencias ficticias para vender.

## D007 — “Eliminar venta” significa anular, no hard-delete

**Estado:** Accepted

La anulación preserva auditoría, crea movimientos compensatorios, deja de contar en métricas y debe ser idempotente.

No iniciar refunds financieros implícitos para pagos online.

## D008 — La Calculadora pública reutiliza el mismo motor

**Estado:** Accepted

No mantener una fórmula Demo y otra para usuarios pagos.

Las diferencias de acceso se resuelven por configuración y datos disponibles, no duplicando el motor.

## D009 — Anonymous prueba antes de registrarse

**Estado:** Accepted

La Calculadora Demo debe entregar valor sin login. Registrarse desbloquea personalización, no toda la plataforma.

## D010 — Free no crea inventario físico

**Estado:** Accepted

Seleccionar una impresora o filamento para calcular no equivale a poseer una máquina/bobina física.

Arquitectura objetivo:

- Anonymous → template Demo.
- Free → referencias a templates para Calculadora.
- Paid → entidades físicas cuando corresponda.

## D011 — `authenticated` no equivale a `paid`

**Estado:** Accepted

El acceso premium debe validarse explícitamente. No cambiar `has_platform_access()` para tratar Free como Paid.

Rutas, RLS, RPCs y actions deben respetar esta separación.

## D012 — No debilitar RLS para resolver UX

**Estado:** Accepted

Cuando Free necesite una capacidad limitada, crear una frontera server-side o modelo específico acotado. No abrir tablas premium completas.

## D013 — Stampy: contexto no es autorización

**Estado:** Accepted

Stampy puede entender el estado de una pantalla sin obtener permisos adicionales.

Las tools de escritura deben ser explícitas, estrechas, server-authoritative y autorizadas.

## D014 — XP es server-authoritative

**Estado:** Accepted

No premiar clicks vacíos. Los límites diarios afectan XP, no el uso. Los eventos deben ser idempotentes. Referrals y XP permanecen separados.

## D015 — E-commerce desacopla vendedor, orden, venta y pago

**Estado:** Accepted

El vendedor conecta su proveedor de pagos. Orders y sales no se colapsan en una sola entidad. Webhooks son idempotentes y el aislamiento por vendedor es obligatorio.

## D016 — UI consistente y mobile-first

**Estado:** Accepted

Preferir componentes propios para dialogs/selects/popovers. Evitar controles nativos que rompan la experiencia y hacks visuales que oculten bugs estructurales.

## D017 — Metodología multiagente sin doble paso obligatorio

**Estado:** Accepted

Codex y Claude Code son agentes alternativos/complementarios.

No toda tarea debe pasar por ambos. La elección depende de:

- tipo de trabajo;
- riesgo;
- disponibilidad;
- especialización;
- créditos/tokens.

Un segundo agente se usa cuando aporta valor real.

## D018 — Los agentes no cambian arquitectura silenciosamente

**Estado:** Accepted

Si una tarea requiere modificar reglas globales, permisos, schema compartido o una decisión de producto, el agente debe detenerse o reportar la decisión antes de asumirla.

## D020 — Cuenta corriente de clientes es un ledger auditable, no un campo mutable

**Estado:** Accepted (2026-09-18)

`Clientes` pasa a ser un destino propio de Mi Negocio (antes se consideraba redundante si estaba integrado en Presupuestos). La deuda de un cliente se audita mediante `customer_account_movements` (`sale_debt`/`payment`/`sale_reversal`/`adjustment`), nunca como un número mutable en `clients`. `saldo = sum(delta)`.

Reglas fijadas:

- los pagos inmediatos de una venta (`cash`/`transfer`) se guardan como allocations (`business_sale_payment_allocations`); la deuda nunca es una allocation, se deriva como `total - sum(allocations)`;
- cliente obligatorio si la venta deja saldo pendiente, opcional si no;
- no se permite sobrepago ni en la venta ni en un cobro posterior — rechazo explícito, nunca ajuste silencioso;
- anular una venta con deuda genera un `sale_reversal` compensatorio, nunca borra el `sale_debt` original, y no puede duplicarse (índice único parcial por venta);
- se reutiliza `public.clients` (ya usada por Presupuestos); no se crea una segunda tabla de clientes.

## D019 — Trabajo simultáneo requiere aislamiento

**Estado:** Accepted

Si Codex y Claude trabajan al mismo tiempo, deben hacerlo sobre tareas independientes o en branches/worktrees separados.

Si trabajan sucesivamente sobre la misma feature, el segundo parte del código actualizado.
