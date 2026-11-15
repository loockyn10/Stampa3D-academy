# Supabase Pro — auditoría breve y pasos (2026-11-15)

Auditoría hecha leyendo el repo (no hay acceso al panel ni a métricas reales). Lo marcado *verificar en panel* no se puede confirmar desde el código. Los valores de planes cambian: confirmarlos en la página de precios de Supabase al contratar.

## Cómo usa Supabase la app (verificado en código)

- **Conexiones:** la app no abre conexiones directas a PostgreSQL (no hay `pg`, `postgres()` ni `DATABASE_URL` en `src/`). Todo pasa por la API (PostgREST/RPC, Auth, Storage) con `@supabase/ssr` y `@supabase/supabase-js`. El límite de conexiones directas de la base no es un cuello de botella para Vercel; sí cuentan el cómputo y las peticiones a la API.
- **Service role:** solo en servidor (rutas de Mercado Pago, cron, acciones de admin, callback de auth). Nunca `NEXT_PUBLIC_`.
- **RLS:** las tablas premium y de facturación tienen RLS y las funciones sensibles `EXECUTE` solo para `service_role` (diagnósticos 2026-11-04 y 2026-11-11, ver `CURRENT_STATE.md`). Pendientes ya conocidos: schema base y `stl_*` sin versionar, RPC `SECURITY DEFINER` no versionadas (TASKS «Cierre Sprint 4.1»). Contratar Pro no cambia nada de esto.
- **Storage:** buckets `stl-files`, `stl-thumbnails`, `stl-previews`, `product-images`, `product-print-files`, `maker-projects`, `printer-catalog-images`, `business-storefront-assets`, `company-logos`, `lesson-resources`, `stampy-knowledge-documents`. El mayor volumen esperable son los STL/3MF y las vistas 360° (WebM). Los videos de cursos están en Bunny, no en Supabase.
- **Correo de Auth:** confirmación y recuperación salen del SMTP de Supabase. **Pro no quita el límite del SMTP incorporado**: hace falta SMTP propio (Resend, ver `docs/RESEND_EMAIL_SETUP.md`).
- **Procesos programados:** un único Vercel Cron diario (`/api/mercadopago/reconcile`, 09:15 UTC, `CRON_SECRET`) que concilia membresías y corre la agenda de precios. No hay `pg_cron` usado por la app.
- **Consultas:** 39 archivos usan `select("*")`; no se encontró una consulta costosa reproducible ligada al lanzamiento, así que no se tocó ninguna (fuera de alcance «optimización general»).

## 1. Qué hacer para contratar Pro

1. Panel de Supabase → **Organization → Billing** → cambiar la organización a **Pro** y cargar el medio de pago (lo hace el dueño).
2. Confirmar que el proyecto de producción pertenece a esa organización (el plan es por organización).
3. Revisar **Spend cap**: dejarlo activado al principio evita cobros por excedentes; desactivarlo solo si un corte por cuota es peor que pagar el excedente.
4. No hace falta cambiar código ni variables de Vercel: las URLs y claves del proyecto no cambian al cambiar de plan.

## 2. Qué comprobar después (capacidad)

- **Compute:** *Project Settings → Compute and Disk*: el tamaño de instancia incluido en Pro y el uso de CPU/RAM en *Reports* durante una semana normal.
- **Disco de la base y Storage:** *Reports → Database / Storage*: tamaño actual vs. cuota del plan; activar alertas de uso.
- **Backups:** *Database → Backups*: que aparezcan los backups diarios. Evaluar el complemento PITR solo si perder hasta 24 h de ventas/movimientos no es aceptable.
- **Auth → Rate Limits:** subir el límite de envío de correos una vez configurado el SMTP propio.
- **Connection pooling:** *Database → Connection pooling*: solo relevante si en el futuro se agregan conexiones directas; hoy no las hay.
- **Logs:** retención de logs (útil para auditar webhooks de Mercado Pago y el cron).

## 3. Diferencias relevantes respecto de Free (verificar en la página de precios)

| Tema | Free | Pro |
|---|---|---|
| Pausa por inactividad | El proyecto se pausa tras días sin uso | No se pausa |
| Backups | Sin backups diarios descargables | Backups diarios con retención limitada; PITR como complemento |
| Cómputo | Instancia compartida mínima | Instancia mayor incluida con crédito de cómputo |
| Cuotas (DB, Storage, transferencia, MAU) | Bajas, con corte al superarlas | Mayores; excedentes facturables si se desactiva el spend cap |
| Soporte | Comunidad | Soporte por correo |
| Correo de Auth incorporado | Muy limitado | **Igual de limitado**: usar SMTP propio |

Pro **no** acelera por sí solo consultas lentas ni resuelve el correo: lo primero depende de índices/consultas y lo segundo del SMTP.

## 4. Pruebas funcionales después del cambio

1. Registro de una cuenta nueva propia → llega la confirmación (con SMTP propio) → entra.
2. Login, recuperación de contraseña y cierre de sesión.
3. Calculadora como visitante y como Free.
4. Cuenta Premium propia: Academia (reproducir una clase), Stampy (una pregunta), Mi Taller (abrir listas), Librería STL (vista previa y descarga).
5. Subida de un archivo pequeño a un bucket desde admin (p. ej. imagen de producto) y su descarga.
6. `/admin/promociones` y `/admin/codigos` cargan sin errores.
7. Al día siguiente: en los logs de Vercel, el cron `/api/mercadopago/reconcile` respondió 200.
