/**
 * Layout HTML único de los correos de Universo Stampa (autenticación de Supabase y avisos enviados por el backend).
 *
 * Reglas de compatibilidad (Gmail, Outlook de escritorio, Apple Mail, clientes móviles):
 * - tablas + estilos en línea; el bloque <style> solo agrega el ajuste móvil (si un cliente lo descarta, el correo
 *   sigue siendo legible porque el ancho es fluido: `width:100%; max-width:600px`);
 * - SIN comentarios HTML ni comentarios condicionales: el motor de plantillas de Supabase puede eliminarlos y ningún
 *   elemento esencial depende de ellos (el botón es una celda con `bgcolor`, no VML);
 * - fondos oscuros siempre con `bgcolor` además de CSS, para que los modos oscuros automáticos no «des-oscurezcan» el logo
 *   (que tiene letras blancas);
 * - imágenes solo por URL pública absoluta (logo oficial de `public/brand`, el mismo PNG que usa la app).
 *
 * Este módulo no importa nada a propósito: lo cargan tanto el backend como el script que genera los archivos de
 * `email-templates/`.
 *
 * Seguridad: `bodyHtml`, `afterCtaHtml` y `cta.href` se insertan SIN escapar. Quien llama pasa HTML ya seguro: texto
 * fijo, variables de Supabase (`{{ .ConfirmationURL }}`) o valores del backend pasados por `escapeHtml`.
 */

export const EMAIL_BRAND = {
  name: "Universo Stampa",
  siteUrl: "https://universo-stampa.com",
  /** Logotipo oficial (PNG con transparencia, letras blancas): servido por la app, sin autenticación. */
  logoUrl: "https://universo-stampa.com/brand/universo-logotipo.png",
  /** Proporción real del PNG: 1200 × 403. Se muestra a 200 px de ancho (retina: el archivo es 6× más grande). */
  logoWidth: 200,
  logoHeight: 67,
} as const;

export const EMAIL_COLORS = {
  page: "#0e0e10",
  card: "#171717",
  cardSoft: "#212126",
  border: "#2e2e35",
  text: "#f4f4f5",
  body: "#d4d4d8",
  muted: "#a1a1aa",
  orange: "#ff780a",
  orangeSoft: "#ff9a3d",
  yellow: "#ffc800",
  onOrange: "#171717",
} as const;

const FONT = "'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";
const C = EMAIL_COLORS;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Párrafo de cuerpo. `html` ya es seguro. */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:26px;color:${C.body};">${html}</p>`;
}

/** Recuadro de aviso (borde naranja a la izquierda). `html` ya es seguro. */
export function noteBox(html: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px 0;">` +
    `<tr><td bgcolor="${C.cardSoft}" style="background-color:${C.cardSoft};border-left:3px solid ${C.orange};border-radius:8px;padding:14px 16px;` +
    `font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${html}</td></tr></table>`
  );
}

/** Texto pequeño y apagado (despedidas, avisos de seguridad). `html` ya es seguro. */
export function smallPrint(html: string): string {
  return `<p style="margin:16px 0 0 0;font-family:${FONT};font-size:13px;line-height:21px;color:${C.muted};">${html}</p>`;
}

/** Enlace de respaldo para cuando el botón no funciona. `href` ya es seguro (variable de Supabase o URL escapada). */
export function urlFallback(href: string): string {
  return (
    `<p style="margin:24px 0 4px 0;font-family:${FONT};font-size:13px;line-height:21px;color:${C.muted};">¿El botón no funciona? Copiá y pegá este enlace en tu navegador:</p>` +
    `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.orangeSoft};word-break:break-all;overflow-wrap:anywhere;">` +
    `<a href="${href}" style="color:${C.orangeSoft};text-decoration:underline;">${href}</a></p>`
  );
}

/** Tarjeta «antes → después» (se usa en el aviso de cambio de precio). Los valores ya son seguros. */
export function compareCard(input: { fromLabel: string; fromValue: string; toLabel: string; toValue: string }): string {
  const cell = (label: string, value: string, strong: boolean) =>
    `<td class="stack" width="50%" valign="top" style="padding:16px 18px;font-family:${FONT};">` +
    `<div style="font-size:12px;line-height:18px;letter-spacing:0.8px;text-transform:uppercase;color:${C.muted};">${label}</div>` +
    `<div style="margin-top:4px;font-size:24px;line-height:30px;font-weight:700;color:${strong ? C.orange : C.text};">${value}</div></td>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;">` +
    `<tr><td bgcolor="${C.cardSoft}" style="background-color:${C.cardSoft};border:1px solid ${C.border};border-radius:12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    cell(input.fromLabel, input.fromValue, false) +
    cell(input.toLabel, input.toValue, true) +
    `</tr></table></td></tr></table>`
  );
}

function button(label: string, href: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" class="btn-table" style="margin:28px auto 8px auto;">` +
    `<tr><td align="center" bgcolor="${C.orange}" style="background-color:${C.orange};border-radius:12px;">` +
    `<a href="${href}" target="_blank" class="btn" style="display:inline-block;padding:16px 40px;font-family:${FONT};font-size:16px;line-height:20px;` +
    `font-weight:700;color:${C.onOrange};text-decoration:none;border-radius:12px;">${label}</a>` +
    `</td></tr></table>`
  );
}

export interface EmailLayoutInput {
  /** <title> del documento (texto plano, sin variables). */
  title: string;
  /** Texto de vista previa que muestra el buzón junto al asunto (texto plano seguro). */
  preheader: string;
  /** Etiqueta pequeña sobre el título. */
  eyebrow: string;
  heading: string;
  /** HTML seguro: usar `paragraph`, `noteBox`, `compareCard`. */
  bodyHtml: string;
  cta?: { label: string; href: string };
  /** HTML seguro que va debajo del botón (enlace de respaldo, avisos). */
  afterCtaHtml?: string;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const { name, siteUrl, logoUrl, logoWidth, logoHeight } = EMAIL_BRAND;
  const preheaderPadding = "&#847;&zwnj;&nbsp;".repeat(40);
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${input.title}</title>
<style type="text/css">
body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table { border-collapse: separate; }
img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
a { word-wrap: break-word; }
@media only screen and (max-width: 620px) {
  .outer { padding: 12px 8px !important; }
  .px { padding-left: 22px !important; padding-right: 22px !important; }
  .h1 { font-size: 24px !important; line-height: 30px !important; }
  .btn-table { width: 100% !important; }
  .btn { display: block !important; padding-left: 12px !important; padding-right: 12px !important; }
  .stack { display: block !important; width: 100% !important; box-sizing: border-box !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${input.preheader}${preheaderPadding}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" class="outer" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" bgcolor="${C.card}" class="px" style="background-color:${C.card};padding:36px 40px 28px 40px;border-radius:16px 16px 0 0;">
<a href="${siteUrl}" target="_blank" style="text-decoration:none;"><img src="${logoUrl}" width="${logoWidth}" height="${logoHeight}" alt="${name}" style="display:block;margin:0 auto;width:${logoWidth}px;max-width:100%;height:auto;border:0;color:${C.text};font-family:${FONT};font-size:20px;font-weight:700;"></a>
</td></tr>
<tr><td height="4" bgcolor="${C.orange}" style="height:4px;line-height:4px;font-size:0;background-color:${C.orange};background-image:linear-gradient(90deg,${C.yellow},${C.orange});">&nbsp;</td></tr>
<tr><td class="px" style="padding:36px 40px 40px 40px;">
<div style="margin:0 0 10px 0;font-family:${FONT};font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${C.orange};">${input.eyebrow}</div>
<h1 class="h1" style="margin:0 0 20px 0;font-family:${FONT};font-size:28px;line-height:34px;font-weight:700;color:${C.text};">${input.heading}</h1>
${input.bodyHtml}
${input.cta ? button(input.cta.label, input.cta.href) : ""}
${input.afterCtaHtml ?? ""}
</td></tr>
<tr><td class="px" bgcolor="${C.cardSoft}" style="background-color:${C.cardSoft};padding:24px 40px 28px 40px;border-top:1px solid ${C.border};border-radius:0 0 16px 16px;">
<p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;line-height:20px;font-weight:700;color:${C.text};">${name}</p>
<p style="margin:0 0 10px 0;font-family:${FONT};font-size:12px;line-height:19px;color:${C.muted};">Aprendé, fabricá y vendé con impresión 3D.</p>
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:19px;color:${C.muted};">Este es un mensaje automático enviado desde una dirección que no recibe respuestas. Si no esperabas este correo, podés ignorarlo.<br><a href="${siteUrl}" target="_blank" style="color:${C.orangeSoft};text-decoration:underline;">universo-stampa.com</a></p>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}
