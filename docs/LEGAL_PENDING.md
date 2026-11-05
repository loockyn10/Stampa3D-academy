# Textos legales pendientes de aprobación

Estado 2026-11-05: **ningún texto legal está publicado.** La estructura técnica existe y no contiene texto inventado.

## Cómo se publica un documento

1. Pegar el texto **aprobado** (Markdown) en `src/content/legal/index.ts` (`LEGAL_TEXTS`) y su fecha en `LEGAL_APPROVALS`.
2. Al desplegar, el documento aparece en `/legal/<id>`, se enlaza en el pie de la landing y entra al `sitemap.xml`. Si es «terminos» o «privacidad», el registro muestra «Al crear tu cuenta aceptás…».
3. Sin texto, la ruta responde 404 y el pie lo muestra como «pendiente».

## Documentos

| id | Dónde se integra | Qué falta decidir/aprobar |
|---|---|---|
| `terminos` | Pie de la landing, aviso del registro | Texto completo (dueño + asesoría legal). |
| `privacidad` | Pie de la landing, aviso del registro | Texto conforme a la Ley 25.326: datos tratados, finalidades, proveedores (Supabase, Vercel, Mercado Pago, OpenAI, Bunny), derechos y contacto. |
| `condiciones-membresia` | Pie de la landing (y, cuando se decida, junto al botón de checkout) | Precio, renovación automática, medios de pago, baja, qué incluye; coherente con D044/D045. |
| `baja` | Enlace «Botón de baja» visible desde el primer acceso (Disposición 954/2025) | Decisión comercial D045: experiencia de baja, código de baja en 24 h. Hoy no se muestra en el pie. |
| `arrepentimiento` | Enlace «Botón de arrepentimiento» visible desde el primer acceso | D045 + circuito de reembolso (hoy no existe). Hoy no se muestra en el pie. |

No se modificó la cancelación de membresías del Sprint 1 (sigue pendiente de D045).
