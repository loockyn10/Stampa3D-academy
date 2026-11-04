# Despliegue: guarda de columnas privilegiadas de `profiles` (P0-1)

**Nada de esto se ejecutó en Supabase.** No hubo SQL remoto, migration aplicada, commit ni deploy. No requiere cambios de código de la app ni variables de entorno.

## 1. Problema (vulnerabilidad confirmada el 2026-11-04)

El diagnóstico de solo lectura `supabase/diagnostics/20261104_profiles_security_audit.sql`, corrido en producción, mostró:

- la policy `Users can update own profile` (UPDATE, `authenticated`) exige solo `auth.uid() = id`, sin restringir columnas;
- `authenticated` tiene UPDATE sobre **todas** las columnas de `profiles`, incluidas `role`, `membership_status` y `membership_expires_at`;
- `profiles` no tiene ningún trigger.

Cualquier usuario con sesión podía hacer `PATCH /rest/v1/profiles?id=eq.<su id>` con su JWT y ponerse `role = 'admin'`, o `membership_status = 'active'`. Con `membership_expires_at` en `NULL`, `has_platform_access` lo toma como acceso **sin vencimiento**. Como admin, además, pasa todas las policies `is_admin` y las rutas admin con service role (por ejemplo `update-price`, que modifica las suscripciones vivas en Mercado Pago).

Configuración que el mismo diagnóstico confirmó como segura:

- **`profiles`:** sin INSERT ni DELETE para `authenticated`; SELECT solo de la propia fila o para admins.
- **`handle_new_user`:** fija `member` / `inactive` y no lee el rol desde la metadata.
- **`subscriptions` y `payments`:** el usuario solo puede leer las suyas.
- **Tablas con escritura solo para admins:** `user_access_grants`, códigos, referidos, fundadores, precio y eventos de MP.

## 2. Qué cambia

| Pieza | Efecto |
|---|---|
| `supabase/migrations/20261104120000_profiles_privileged_columns_guard.sql` | Agrega la función `public.guard_profile_privileged_columns()` (`SECURITY INVOKER`) y el trigger `profiles_guard_privileged_columns` (`BEFORE INSERT OR UPDATE`). No toca policies, GRANTs ni filas. |
| Para `anon` / `authenticated` **no admin** | Cambiar `id`, `role`, `membership_status`, `membership_started_at`, `membership_expires_at`, `member_level`, `active_months`, `referred_by_user_id`, `email` o `created_at` falla con `42501`. `referral_code` solo puede pasar de `NULL` a un valor. Reenviar los mismos valores no falla. |
| Sin cambios | Onboarding, Configuración, Mi negocio, generación del código de referido, panel `/admin/usuarios` (admins), webhook y `sync-subscription` de Mercado Pago (`service_role`), `auth/callback` (`service_role`), alta de usuarios (`handle_new_user`), SQL Editor (`postgres`). |

## 3. Orden

1. Revisar el bloque OPCIONAL de `20261104_profiles_security_audit.sql`, que tiene emails y no se comparte. Confirmar que los 3 admins y las 2 membresías activas sin suscripción autorizada son legítimos. Si alguno no lo es, documentarlo **antes** de corregirlo.
2. Tener una cuenta **Free de prueba** (no admin, no un cliente real) y anotar su id (`auth.users.id`).
3. Opcional (línea base): correr `supabase/diagnostics/20261104_profiles_guard_verify.sql` con esa cuenta **antes** de aplicar. Debe informar `trigger=AUSENTE` y los 8 intentos como `PERMITIDO (MAL)`. No deja cambios: termina siempre con un error que revierte la transacción.
4. Aplicar `supabase/migrations/20261104120000_profiles_privileged_columns_guard.sql` en el SQL Editor (proyecto de producción), en un horario tranquilo. Aborta sin cambiar nada si falta `profiles`, `is_admin(uuid)`, `auth.uid()` o alguna de las columnas protegidas.
5. Correr `20261104_profiles_guard_verify.sql` con `v_free` (cuenta Free de prueba) y `v_admin` (tu admin). Esperado: `trigger=PRESENTE`, los 8 intentos `BLOQUEADO (OK)`, y `free edita su perfil`, `free reenvía valores iguales`, `admin edita membresía ajena` y `service_role activa membresía` en `OK`. Ningún `MAL`.
6. Pruebas manuales (§4).
7. Durante 24 h, revisar los logs de Vercel y los de Postgres en Supabase buscando `42501` / `No autorizado`. Un caso legítimo bloqueado indicaría un flujo no contemplado: aplicar el rollback y avisar.

## 4. Pruebas manuales

1. Cuenta Free: completar onboarding, editar Configuración → Cuenta y Mi negocio → guardan sin error.
2. Cuenta Free: abrir `/perfil` (genera el `referral_code` si no tenía) → se ve el código.
3. Cuenta Free: el ataque desde la consola del navegador o con un `PATCH` REST a `profiles` con `{"role":"admin"}` o `{"membership_status":"active"}` → 403 / `42501`. El acceso no cambia al recargar.
4. Admin: en `/admin/usuarios`, cambiar membresía, nivel y meses de la cuenta de prueba → se guarda. Revertir después.
5. Membresía: un checkout o `sync-subscription` (idealmente con usuarios de prueba de MP, P0-3) activa la membresía como antes.
6. Registro de una cuenta nueva → perfil `member` / `inactive`.

## 5. Marcha atrás

Es inmediata, no toca datos y deja la base exactamente como estaba antes:

```sql
drop trigger if exists profiles_guard_privileged_columns on public.profiles;
drop function if exists public.guard_profile_privileged_columns();
```

Hacer rollback **reabre la vulnerabilidad**: usarlo solo si un flujo legítimo queda bloqueado, y corregir la guarda en una migration nueva.

## 6. Pruebas automatizadas

- `tests/profiles-guard.test.mjs` corre con `npm test`. Valida el contrato de la migration y el rollback documentado, y falla si algún código que no sea admin ni service role empieza a escribir columnas privilegiadas de `profiles`.
- `tests/profiles-guard-db.test.mjs` es opt-in y usa Postgres embebido, nunca Supabase. Reproduce la configuración real de producción, demuestra la vulnerabilidad sin el fix y verifica los 17 escenarios con el fix: flujos legítimos, ataques, admin, service role, alta, script de verificación y rollback.

## 7. Pendiente después de aplicar (no bloquea)

- **Funciones `SECURITY DEFINER` no versionadas que `anon` puede ejecutar** (`adjust_*_stock`, `assemble_product_from_components`, `consume_filaments_for_products`, `ensure_default_calculator_product_types`, `rls_auto_enable`): revisar su cuerpo con `supabase/diagnostics/20261104_definer_rpc_bodies.sql` para confirmar que validan ownership.
- **Higiene:** revocar `TRUNCATE` / `REFERENCES` / `TRIGGER` a `anon` / `authenticated`. No se pueden usar desde la API, pero sobran.
- **Más adelante:** mover las ediciones de `/admin/usuarios` a una server action con auditoría y entonces reemplazar el UPDATE de tabla de `authenticated` por GRANTs por columna.
- **Decisión de producto:** las altas manuales desde `/admin/usuarios` dejan `membership_expires_at` en `NULL`, es decir, acceso perpetuo.
