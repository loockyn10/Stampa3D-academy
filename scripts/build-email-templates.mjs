// Genera los HTML de email-templates/ (plantillas de Supabase Auth + referencia del aviso de Pioneros) y la vista previa.
// Fuente única: src/lib/email/layout.ts + templates.ts. Uso: node scripts/build-email-templates.mjs
// No toca Supabase, Resend ni ninguna credencial: solo escribe archivos locales.
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "../tests/helpers/load-ts.mjs";

const root = process.cwd();
const T = loadTs("src/lib/email/templates.ts");
const outDir = path.join(root, "email-templates");
const supabaseDir = path.join(outDir, "supabase");
fs.mkdirSync(supabaseDir, { recursive: true });

const write = (file, content) => fs.writeFileSync(file, content.replace(/\r\n/g, "\n"), "utf8");

for (const tpl of T.AUTH_EMAIL_TEMPLATES) {
  write(path.join(supabaseDir, tpl.file), tpl.html);
  // El asunto va en un .txt aparte para pegarlo tal cual en el campo «Subject».
  write(path.join(supabaseDir, tpl.file.replace(/\.html$/, ".subject.txt")), `${tpl.subject}\n`);
}

// Referencia del aviso de Pioneros: el backend lo renderiza con los valores reales (no se pega en ningún panel).
const backendDir = path.join(outDir, "backend");
fs.mkdirSync(backendDir, { recursive: true });
const pioneros = {
  file: "06-aviso-fin-promocion-pioneros.html",
  subject: "Tu precio promocional de Universo Stampa cambia el {{fecha}}",
  html: T.renderPriceChangeNoticeHtml({ promoPrice: "{{precioPromo}}", postPrice: "{{precioPosterior}}", date: "{{fecha}}", manageUrl: "{{urlMembresia}}" }),
};
write(path.join(backendDir, pioneros.file), pioneros.html);
write(path.join(backendDir, pioneros.file.replace(/\.html$/, ".subject.txt")), `${pioneros.subject}\n`);

// ── Vista previa: variables de Supabase reemplazadas por datos de ejemplo ───────────────────────────────────────────
const SAMPLE = {
  "{{ .ConfirmationURL }}": "https://abcdefghijkl.supabase.co/auth/v1/verify?token=pkce_3f9a1c0d7b2e4f65a8c91d0e&type=signup&redirect_to=https%3A%2F%2Funiverso-stampa.com%2Fauth%2Fcallback%3Fnext%3D%252F",
  "{{ .TokenHash }}": "pkce_3f9a1c0d7b2e4f65a8c91d0e",
  "{{ .Email }}": "ana.perez@gmail.com",
  "{{ .NewEmail }}": "ana@miestudio3d.com",
  "{{ .SiteURL }}": "https://universo-stampa.com",
};
const fill = (html) => Object.entries(SAMPLE).reduce((acc, [key, value]) => acc.split(key).join(value), html);

const previews = [
  ...T.AUTH_EMAIL_TEMPLATES.map((tpl) => ({ id: tpl.id, title: tpl.slot.split("→").slice(-1)[0].replace(/\(.*\)/, "").trim(), subject: tpl.subject, html: fill(tpl.html), where: tpl.slot })),
  {
    id: "pioneros",
    title: "Aviso fin de promoción Pioneros",
    subject: "Tu precio promocional de Universo Stampa cambia el 15 de julio de 2027",
    where: "Backend → Resend (src/lib/mercadopago/price-notice.ts)",
    html: T.renderPriceChangeNoticeHtml({ promoPrice: "$9.900", postPrice: "$19.900", date: "15 de julio de 2027", manageUrl: "https://universo-stampa.com/configuracion" }),
  },
];

const previewDir = path.join(outDir, "preview");
fs.mkdirSync(previewDir, { recursive: true });
for (const p of previews) write(path.join(previewDir, `${p.id}.html`), p.html);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const cards = previews
  .map(
    (p) => `<section class="card" id="${p.id}">
  <header><h2>${esc(p.title)}</h2><p class="subject"><span>Asunto</span> ${esc(p.subject)}</p><p class="where">${esc(p.where)}</p></header>
  <div class="frames">
    <figure><figcaption>Escritorio · 640 px</figcaption><iframe src="${p.id}.html" title="${esc(p.title)} (escritorio)" style="width:640px;height:980px" loading="lazy"></iframe></figure>
    <figure><figcaption>Móvil · 375 px</figcaption><iframe src="${p.id}.html" title="${esc(p.title)} (móvil)" style="width:375px;height:980px" loading="lazy"></iframe></figure>
  </div>
</section>`,
  )
  .join("\n");

write(
  path.join(previewDir, "index.html"),
  `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vista previa de correos - Universo Stampa</title>
<style>
body{margin:0;background:#101012;color:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;padding:32px 24px}
h1{margin:0 0 4px;font-size:28px} .lead{color:#a1a1aa;margin:0 0 32px;max-width:720px;line-height:1.5}
.card{margin:0 0 56px} .card h2{margin:0 0 6px;font-size:20px;color:#ff9a3d}
.subject{margin:0 0 2px} .subject span{display:inline-block;background:#2e2e35;color:#a1a1aa;border-radius:6px;padding:1px 8px;font-size:12px;margin-right:6px}
.where{margin:0 0 16px;color:#a1a1aa;font-size:13px}
.frames{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
figure{margin:0} figcaption{color:#a1a1aa;font-size:12px;margin-bottom:6px}
iframe{border:1px solid #2e2e35;border-radius:10px;background:#0e0e10;max-width:100%}
</style></head><body>
<h1>Correos de Universo Stampa</h1>
<p class="lead">Vista previa con datos de ejemplo. Las variables de Supabase (<code>{{ .ConfirmationURL }}</code>, <code>{{ .Email }}</code>…) están reemplazadas solo en esta vista; los archivos de <code>email-templates/supabase/</code> las conservan intactas.</p>
${cards}
</body></html>
`,
);

console.log(`Generado: ${T.AUTH_EMAIL_TEMPLATES.length} plantillas de Supabase + aviso de Pioneros + vista previa en email-templates/`);
