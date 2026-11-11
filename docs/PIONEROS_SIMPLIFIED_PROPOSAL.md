# Edición Pioneros — propuesta simplificada con códigos de descuento (investigación)

**Estado:** INVESTIGACIÓN + PROPUESTA (2026-11-11). Nada se implementó ni se aplicó: sin migrations, sin cambios de precio, sin llamadas a Mercado Pago ni a Supabase, sin push ni deploy. Sustituye como camino recomendado a `PIONEERS_EDITION_DESIGN.md` (y su migration M1, que queda **en pausa**, sin aplicar, hasta decidir).

> **[C]** confirmado leyendo el repo · **[D]** documentación oficial de Mercado Pago · **[?]** NO verificado (requiere diagnóstico en la base real, prueba con cuentas de prueba o consulta a MP).

## 1. Qué hay hoy [C]

- **Código en `main` y en `origin/main`** (commits `f45e5ac` y `3d516fa`, D033/D034): `create-subscription` acepta un `discount_code` opcional; la base decide el precio (`discount_code_final_amount`), reserva un uso al crear el checkout, lo consume cuando Mercado Pago autoriza la suscripción y lo libera si el checkout se cancela. **Apagado por defecto** tras `DISCOUNT_CODES_ENABLED` (`.env.example` = `false`).
- **Migrations `20261029120000_discount_code_checkout.sql` y `20261030120000_discount_checkout_consistency.sql`: SÍ están aplicadas en remoto [C, 2026-11-11].** `docs/CURRENT_STATE.md` y `DEPLOY_DISCOUNT_CODES.md` decían lo contrario (desactualizado). Lo confirmó el diagnóstico de solo lectura `supabase/diagnostics/20261029_discount_codes_state.sql` ejecutado por el usuario: ambas «applied»; 8 funciones con `EXECUTE` solo para `service_role` (anon/authenticated sin acceso); RLS activa y sin SELECT público en `discount_code_reservations` y `discount_code_failed_attempts`; `invite_codes.id` es `uuid`; 0 reservas, 0 canjes, 0 sobrecupo, 0 asientos retenidos, 0 códigos «una vez» no soportados.
- **Códigos existentes hoy [C]:** 3 activos, uno por tipo (`discount_percent`, `discount_fixed_amount`, `fixed_price`), todos `forever`, **sin `max_uses` y sin vencimiento**, `used_count` = 0. Parecen de prueba [?: el diagnóstico no imprime sus nombres ni valores]. Con el interruptor encendido, cualquiera que conozca uno los puede usar sin límite.
- **Interruptor `DISCOUNT_CODES_ENABLED` en producción: NO verificado [?]** (es una variable del hosting; el repo solo dice «apagado por defecto»).
- **3 checkouts completados con su suscripción aún pendiente** (informativo: se reemplazan cuando la persona aplica un código; no retienen cupo, `seats_held_by_open_checkouts` = 0).
- **Pruebas:** 29 + 20 tests contra Postgres real (carrera de 12 compradores, notificaciones duplicadas, pago tardío) y los de orquestación. **Nunca se probó con Mercado Pago real ni con cuentas de prueba** (solo fakes).

## 2. Respuestas a las 7 preguntas

**1. ¿20 códigos individuales de un solo uso?** Sí. `/admin/codigos` crea un código por vez (botón generar → prefijo `PRECIO-XXXXXX`, «Límite de usos» = 1, vencimiento y notas opcionales). Con `max_uses = 1` el límite lo impone la base de forma atómica (capacidad = `max(used_count, canjes reales)` + reservas vivas de **otras** personas, bajo lock), probado con 12 compradores simultáneos. No hay alta masiva: son 20 altas manuales (~1 min c/u) o, con autorización, un `INSERT` único de 20 filas. Un código **no se ata a una persona** (quien lo tenga lo usa): el control es a quién se lo das. Variante más simple si la promo es pública: **un solo código con `max_uses = 20`** (el tope de 20 sigue siendo atómico; deja de ser «por invitación»).

**2. ¿Descuento fijo de $10.000?** Sí, el tipo «Descuento Monto Fijo ($)» (`discount_fixed_amount`, valor 10000): precio final = base − 10.000 = **$9.900** mientras el precio de lista sea $19.900. **Recomendado: «Precio Especial Fijo ($)» (`fixed_price`, valor 9900)**: da $9.900 aunque el precio de lista cambie (con el fijo de 10.000, si la lista pasara a $24.900 saldría $14.900). Ambos se validan en la base: el resultado debe ser > 0 y menor que la lista.

**3. ¿El precio con descuento rige en las renovaciones o solo en el primer pago?** **En todas.** El checkout crea la preapproval con el monto ya descontado como su único `auto_recurring.transaction_amount` y Mercado Pago cobra ese importe en cada ciclo [C: `preapproval-client.ts`; D]. «Primer mes solamente» **no existe** (`once` se rechaza como no soportado). Verificado con fakes; no con Mercado Pago real [?].

**4. ¿Cómo mantener $9.900 durante 6 mensualidades?** No hay nada que mantener: la preapproval cobra $9.900 cada mes por sí sola. Lo que hay que controlar es **cuándo termina**. Mercado Pago no permite programar el cambio ni limitar a 6 cobros una suscripción sin plan (`end_date` aparece en ejemplos de la referencia, pero su efecto no está documentado y el checkout actual no lo envía [?]).

**5. ¿Cómo se pasa al regular después del sexto mes?** Este es el único punto que sigue abierto y **no lo resuelven los códigos ni M1**: hay que cambiar el importe de la preapproval a $19.900 después del 6.º cobro aprobado y antes del 7.º. Caminos, de más a menos simple:
   - **A. Panel de Mercado Pago, «Modificar monto»:** documentado **solo** en «Planes de suscripción → Suscriptores»; MP avisa por e-mail al pagador [D]. Nuestras suscripciones se crean **sin plan** (sin `preapproval_plan_id` en `src/`) [C], así que probablemente **no aparezcan ahí** [?]. Se confirma mirando ese panel sin tocar nada (ver `PIONEROS_DISCOUNT_SYSTEM_DIAGNOSIS.md` §6). Cero código; 20 operaciones manuales si aplicara.
   - **B. `PUT /preapproval/{id}` con el nuevo monto:** documentado el endpoint, **no** cuándo rige, si pide reautorización ni qué recibe el pagador [?]. Es exactamente lo que valida el spike (`docs/MP_PRICE_CHANGE_SPIKE.md`), que sigue pendiente.
   - **C. Contingencia:** si MP exigiera reautorización, cancelar la preapproval promocional e invitar a suscribirse al regular con consentimiento explícito (hay fricción y bajas posibles).
   Además hay que comunicarlo: no existe e-mail transaccional propio; con 20 personas, un aviso manual (WhatsApp/mail) ~30 días antes alcanza. Los textos de la oferta (precio posterior, cuándo, cómo cancelar) los define el asesor legal; no los inventé.

**6. ¿Son necesarias las migrations de descuentos?** **Sí, y ya están aplicadas [C, 2026-11-11]**: no hay nada que aplicar. Sin `20261029` el checkout con código respondería 503; sin `20261030` una reserva con checkout abierto vencería a los 30 min y un pago tardío podría superar el límite. El diagnóstico real confirma ambas, permisos solo `service_role` y RLS activa (ver §1).
   **Advertencia:** encender `DISCOUNT_CODES_ENABLED` habilita **todos** los códigos de descuento activos que ya existan en `invite_codes`: hoy son 3 sin límite de usos ni vencimiento. Antes de encenderlo, identificarlos (sin imprimir más de lo necesario) y desactivarlos desde `/admin/codigos` si son de prueba.

**7. ¿Qué se controla manualmente desde el administrador?**

| Necesidad | Dónde | Estado |
|---|---|---|
| Crear, editar, activar/desactivar códigos; ver `usos / máximo`, vencimiento, notas | `/admin/codigos` | Existe |
| Insignia «Pionero» (permanente, independiente de la membresía) | `/admin/insignias`: crear la insignia y asignarla por usuario; el Perfil ya muestra `user_badges` | Existe (el número #001–#020 va en el nombre de 20 insignias o en una nota; **revisar que `user_badges` solo lo pueda escribir un admin [?]**) |
| Precio de lista y su historial | `/admin/membresia` | Existe; el cambio masivo ya **no** toca promociones (commit `0c987c2`) |
| Quién canjeó cada código, estado/monto/fecha de cada suscripción, fecha del 6.º y 7.º cobro | **No hay pantalla.** Tablas `invite_code_redemptions`, `discount_code_reservations`, `subscriptions`, `payments` (consulta de solo lectura en Supabase) y el panel de Mercado Pago | Un diagnóstico SQL de solo lectura «control de Pioneros» lo resuelve con 20 filas (propuesto, **no escrito**) |
| Acceso anticipado | No existe un mecanismo por persona: las feature flags son globales y solo los admin las saltan | Ver §4 |

## 3. ¿Hace falta M1 (`pioneer_members` / `pioneer_edition`)?

**Recomendación: prescindir de M1 para lanzar.** Con 20 personas, los códigos ya dan lo esencial y M1 obligaría a construir además checkout, hook de webhook, job de vencimientos, panel y paso al regular (todo sin probar con Mercado Pago).

| Necesidad | Con códigos + insignia | Con M1 |
|---|---|---|
| Tope de 20 sin sobreventa | 20 códigos de 1 uso, o 1 código con `max_uses = 20` (atómico, ya probado) | Lock + índices (probado) |
| Fundadores/pruebas de $250 fuera | Control manual: no se les da código; quien tiene suscripción viva no puede canjear | Automático |
| Numeración y insignia permanentes | Manual en `/admin/insignias` | Automática |
| Cupo solo con primer cobro aprobado | **Se consume al autorizar la suscripción**, no al primer cobro aprobado. Si el primer cobro falla, el uso queda consumido: se revisa en MP y se emite otro código | Automático |
| Seguimiento de ciclos y aviso del 7.º cobro | Calendario manual (20 fechas) | Automático |
| Paso al regular | **Igual de pendiente** (spike) | Igual de pendiente |
| Contador/oferta en la landing | Sin contador; «por invitación» o código público con tope; apagar a mano | Automático |

Lo que **se pierde** con la vía simple: automatismos y auditoría; el costo es disciplina operativa sobre 20 filas. Lo que **se gana**: reutilizar un sistema ya construido y probado, sin tablas nuevas ni código de checkout nuevo. M1 queda commiteada en local (sin aplicar) por si el volumen creciera; **no recomiendo aplicarla**.

## 4. Acceso anticipado (diferible)

No hace falta construirlo hasta que exista una herramienta para adelantar. Cuando exista, la forma mínima es una opción `earlyAccess` en `resolveFeatureAccess` alimentada por «tiene la insignia Pionero y membresía vigente» (una consulta, sin migration ni tabla nueva, y sin tocar `has_platform_access`: un grant `user_access_grants` daría acceso completo a RLS, ya descartado). Se decide al tener la primera herramienta candidata.

## 4b. Verificación del 9.900 × 1 uso (2026-11-11)

Con las dos migrations aplicadas, el escenario del lanzamiento (20 códigos `fixed_price` 9900, `max_uses` 1, lista 19900) está cubierto por `tests/pioneros-codes-db.test.mjs` contra Postgres real (10 tests, pasan). Detalle, cómo crearlos en `/admin/codigos` y salvedades: `docs/PIONEROS_DISCOUNT_SYSTEM_DIAGNOSIS.md` §5.

## 5. Plan mínimo propuesto (cada paso con autorización explícita)

1. ~~Diagnóstico de solo lectura de descuentos~~ **Hecho 2026-11-11:** migrations aplicadas; 3 códigos de prueba activos. Queda confirmar el estado del interruptor `DISCOUNT_CODES_ENABLED` en el hosting.
2. **Spike de Mercado Pago** (cuentas de prueba): validar el cambio de monto $9.900 → $19.900 (camino B) y, si es posible, el A. **Es la puerta del lanzamiento**: sin saber cómo se pasa al regular no se promete «6 meses y luego regular».
3. **QA del checkout con descuento.** Decisión 2026-11-11: sin cuentas de prueba del spike; se prueba en producción con **un cobro real de $9.900** (cuenta propia, luego cancelada y reembolsada), con el interruptor encendido solo durante la prueba. Runbook con puertas de autorización y verificaciones de que no se afecta a otras suscripciones: `docs/PIONEROS_CHECKOUT_TEST_RUNBOOK.md`. No prueba la renovación ni el paso a $19.900.
4. (Migrations ya aplicadas.) Auditar/desactivar los 3 códigos existentes y activar `DISCOUNT_CODES_ENABLED` solo después, y solo tras el QA del paso 3.
5. Crear los códigos (`fixed_price` 9900, `max_uses` 1 × 20, o 1 × 20 usos), la insignia y la planilla de control; texto de la oferta aprobado por el asesor legal; copy de la landing sin contadores.
6. Operación: avisar a cada Pionero ~30 días antes del 7.º cobro y aplicar el paso al regular según lo validado.

## 6. Riesgos pendientes

| # | Riesgo | Mitigación |
|---|---|---|
| S1 | El cambio de importe no se acepta o exige reautorización (R1 del informe previo) | Spike antes de lanzar; contingencia C |
| S2 | Las migrations están aplicadas, pero el flujo nunca se probó con Mercado Pago real | QA con cuentas de prueba antes de encender el interruptor |
| S3 | `DISCOUNT_CODES_ENABLED` activaría 3 códigos existentes sin límite de usos ni vencimiento | Identificarlos y desactivarlos antes; confirmar hoy que el interruptor está apagado |
| S4 | Un checkout abandonado retiene el uso de su código (DEPLOY §5.1) | Código individual: solo afecta a esa persona; liberar a mano cancelando la preapproval pendiente |
| S5 | Un uso consumido no se devuelve si la suscripción se cae (§5.3) | Emitir un código nuevo a mano |
| S6 | El pagador solo ve «Membresía Academia Stampa» en Mercado Pago (no menciona la promoción) | Texto en la app/legal; opcional: ajustar el `reason` del checkout |
| S7 | Código = portador: quien lo conozca lo usa | Enviarlos por canal privado; `max_uses` = 1; vencimiento corto |
| S8 | Sin e-mail transaccional propio para avisar el cambio de precio | Aviso manual a 20 personas |
