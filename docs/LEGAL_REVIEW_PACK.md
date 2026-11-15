# Paquete para revisión legal (2026-11-15)

> **BORRADOR PARA REVISIÓN — NO PUBLICAR.** Nada de este archivo está aprobado por el dueño ni por un abogado. Los textos aprobados se publican solo pegándolos en `src/content/legal/index.ts` (ver `docs/LEGAL_PENDING.md`). Las marcas **[DECIDIR]** son políticas que el código no define y no deben completarse por suposición.

## 1. Dónde se muestran (o se mostrarán) los documentos

| Documento | id | Dónde aparece al publicarlo | Hoy |
|---|---|---|---|
| Términos y condiciones | `terminos` | Pie de la landing, aviso «Al crear tu cuenta aceptás…» en `/registro`, `sitemap.xml` | Pie: «pendiente» |
| Política de privacidad | `privacidad` | Ídem | Pie: «pendiente» |
| Condiciones de la membresía | `condiciones-membresia` | Pie de la landing y aviso «Al activar aceptás…» junto al botón de `/sin-acceso` (agregado en este sprint, solo visible con texto aprobado) | Pie: «pendiente» |
| Botón de baja | `baja` | Enlace visible desde el primer acceso (Disposición 954/2025) | No se muestra (D045) |
| Botón de arrepentimiento | `arrepentimiento` | Enlace visible desde el primer acceso | No se muestra (D045) |
| Condiciones de la promoción Pioneros | — (no existe id) | Hoy solo el texto del checkout (abajo, §3) | **[DECIDIR]** si va como sección de `condiciones-membresia` o como documento propio (requiere agregar el id al registro) |
| Reembolsos | — | — | No existe circuito de reembolso en la app |

## 2. Hechos del producto que los documentos deben reflejar (verificados en código)

- **Titular / contacto:** **[DECIDIR]** razón social, CUIT, domicilio y correo de contacto (no figuran en el código).
- **Cuentas:** registro con nombre, correo y contraseña (Supabase Auth). Confirmación por correo. Sin código de invitación ni de referido en el alta pública.
- **Planes:** Free (Calculadora y perfil) y Premium (Academia, Stampy IA, Mi Taller, Librería STL y demás herramientas habilitadas). Estar registrado no da acceso Premium.
- **Precio:** lo define `membership_settings` en la base; se muestra antes de pagar y Mercado Pago lo muestra de nuevo en su pantalla.
- **Pago:** suscripción mensual de Mercado Pago (preapproval) con renovación automática. La app no guarda datos de tarjeta.
- **Activación:** el acceso Premium se activa solo con un cobro aprobado; si una renovación se rechaza, el acceso termina al vencer el período pago (no hay acceso perpetuo).
- **Cancelación:** desde Configuración → Membresía o Perfil. Cancela la suscripción en Mercado Pago (no hay más cobros) y **conserva el acceso hasta el fin del período ya pagado**.
- **Reembolsos / contracargos:** no hay circuito en la app y hoy no revocan el acceso automáticamente. **[DECIDIR]** política y canal.
- **Arrepentimiento (10 días) y baja:** sin implementar como botón dedicado. **[DECIDIR] D045** con asesoría (Ley 24.240 art. 10 ter / 34, Disposición 954/2025).
- **Proveedores que tratan datos:** Supabase (base de datos, autenticación, archivos), Vercel (hosting), Mercado Pago (pagos), OpenAI (Stampy IA), Bunny (video de cursos), **Resend** (correos transaccionales: confirmaciones, recuperación y avisos de precio; nuevo respecto de `LEGAL_PENDING.md`). **[DECIDIR]** transferencia internacional y base legal (Ley 25.326).
- **Comunicaciones:** solo correos transaccionales (cuenta, membresía, aviso previo de cambio de precio). No hay newsletter ni marketing automatizado.
- **Programas no lanzados:** referidos y sorteos **no** están habilitados comercialmente; no mencionarlos como vigentes. Los sorteos requerirán bases y condiciones propias.

## 3. Textos que ya funcionan como compromiso frente al cliente

Están en el código y el cliente los ve hoy (con el código PIONEROS activo). Revisarlos junto con los legales:

1. **Checkout `/sin-acceso`** (`src/app/sin-acceso/sin-acceso-client.tsx`): «Pagás $X por mes durante tus primeros N períodos mensuales de facturación. Desde el período N+1 pagás $Y por mes. Mercado Pago aplica el cambio automáticamente y te avisamos por correo y dentro de la plataforma antes de que ocurra. Podés cancelar cuando quieras.» + casilla «Acepto pagar…». La aceptación queda registrada con su versión.
   - **Riesgo a revisar:** la frase «Mercado Pago aplica el cambio automáticamente» depende de `PRICE_STEP_UP_ENABLED`, que sigue apagado porque el cambio de importe por API no está validado. Si la validación fallara o exigiera reautorización, el texto prometería algo que no ocurre (alternativas en `DEPLOY_PRICE_SCHEDULES.md`).
2. **Texto en Mercado Pago** (`promoCheckoutReason`): «Membresía Academia Stampa - $9.900/mes por 6 meses, luego $19.900/mes». Usa la marca anterior («Academia Stampa»); cambiarlo es un cambio de texto de cobro, se dejó para decisión.
3. **Aviso previo por correo** (`buildPriceChangeNotice`): fecha exacta del cambio, nuevo importe, que no hay que hacer nada para seguir y que se puede cancelar antes conservando el acceso hasta el fin del período pago. Se envía con al menos 20 días (configurable 7–60) solo cuando el cambio real está habilitado.

## 4. Borrador base: condiciones de la promoción Pioneros

Solo con datos acordados (`PIONEROS`, 20 cupos, $9.900 × 6 períodos, luego $19.900, aviso de 20 días). Lo demás queda marcado.

> **Promoción Pioneros — Universo Stampa** *(borrador)*
>
> 1. **Beneficio.** Quien contrate la membresía Premium aplicando el código PIONEROS paga $9.900 (pesos argentinos) por mes durante sus primeros seis (6) períodos mensuales de facturación, contados desde el primer débito de su suscripción.
> 2. **Precio posterior.** Desde el séptimo período el precio es de $19.900 por mes, importe que la persona acepta expresamente al contratar. **[DECIDIR]** si ese importe queda fijo o puede actualizarse luego y con qué aviso.
> 3. **Cupos.** La promoción tiene veinte (20) cupos. Un cupo queda **reservado** mientras el pago está en curso y se **consume** solo con el primer pago aprobado; un pago rechazado, pendiente o un checkout abandonado no consumen cupo (D054). **[DECIDIR]** qué se comunica si alguien queda sin cupo mientras otros completan su pago.
> 4. **Vigencia para nuevas contrataciones.** **[DECIDIR]** fecha límite para usar el código (además del límite de cupos).
> 5. **Aviso previo.** Antes del cambio de precio se envía un aviso por correo y se muestra dentro de la plataforma con al menos 20 días de anticipación.
> 6. **Cancelación.** Se puede cancelar en cualquier momento desde Configuración → Membresía; no hay nuevos cobros y el acceso se conserva hasta el fin del período pagado. Cancelar durante la promoción **[DECIDIR]** si implica perder el precio promocional al volver a suscribirse (hoy un código usado no puede volver a usarse por la misma cuenta).
> 7. **Medio de pago.** Débito automático mensual a través de Mercado Pago.
> 8. **Arrepentimiento y reembolsos.** **[DECIDIR] D045.**

## 5. Decisiones que necesito del dueño / asesoría

1. Datos del titular y contacto (todos los documentos).
2. D045: experiencia de baja y arrepentimiento, y si hay reembolsos (y por qué canal).
3. Si el texto del checkout se mantiene mientras el cambio automático de importe no esté validado (§3.1).
4. Marca en el texto de Mercado Pago («Academia Stampa» → «Universo Stampa») (§3.2).
5. Puntos **[DECIDIR]** del borrador Pioneros (§4).
6. Privacidad: agregar Resend a la lista de proveedores y definir la base legal de la transferencia internacional.
