// Genera src/app/theme-palette.css: remapeo de las paletas de Tailwind para el modo claro y el
// reseteo a los valores por defecto para el scope `.theme-force-dark`.
//
// Uso: node scripts/generate-theme-css.mjs
// El modo oscuro NO redefine nada: usa los valores por defecto de Tailwind (equivalente al diseño original).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const themeCss = readFileSync("node_modules/tailwindcss/theme.css", "utf8");
const defaults = new Map();
for (const m of themeCss.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g)) {
  defaults.set(`${m[1]}-${m[2]}`, m[3].trim());
}
const get = (family, shade) => {
  const v = defaults.get(`${family}-${shade}`);
  if (!v) throw new Error(`missing ${family}-${shade}`);
  return v;
};
// Ajuste de luminosidad (oklch L) para que los textos tenues cumplan contraste AA sobre el papel claro.
const withLightness = (oklch, l) => oklch.replace(/oklch\(\s*[\d.]+%/, `oklch(${l}%`);

// Neutros: la escala se espeja (texto claro -> tinta oscura; superficies oscuras -> superficies claras).
// 950 no se remapea: lo usan los botones naranjas como tinta fija (text-neutral-950).
const neutralFamilies = ["gray", "zinc", "neutral", "slate", "stone"];
const neutralMap = { 50: 900, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100 };
const lightnessOverride = { 400: 41, 500: 47 };
// Gris 600 = "muy tenue" en oscuro; en claro se vuelve un gris medio legible.
const dimOverride = "oklch(54% 0.012 70)";

// Cromaticos: 200/300/400 se usan como texto sobre fondos oscuros; 500+ queda como acento/relleno.
const chromatic = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const chromaticMap = { 200: 900, 300: 800, 400: 700 };

const lightLines = [];
const resetLines = [];
for (const f of neutralFamilies) {
  for (const [from, to] of Object.entries(neutralMap)) {
    let value = f === "gray" && from === "600" ? dimOverride : get(f, to);
    if (lightnessOverride[from]) value = withLightness(get(f, to), lightnessOverride[from]);
    lightLines.push(`  --color-${f}-${from}: ${value};`);
    resetLines.push(`  --color-${f}-${from}: ${get(f, from)};`);
  }
}
for (const f of chromatic) {
  for (const [from, to] of Object.entries(chromaticMap)) {
    lightLines.push(`  --color-${f}-${from}: ${get(f, to)};`);
    resetLines.push(`  --color-${f}-${from}: ${get(f, from)};`);
  }
}

// text-{hue}-100 y text-{hue}-500 no se pueden remapear por variable (los mismos tonos se usan como relleno y
// borde), asi que se emiten reglas puntuales solo para las clases de texto que existen en src/. En claro:
// 100 -> 900 y 500 -> 600/700 (el mas claro que cumpla contraste). Se excluye el contenido de .theme-force-dark.
const darkerFiveHundred = new Set(["red", "rose", "pink", "fuchsia", "purple", "violet", "indigo", "blue"]);
const used = new Set();
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx|ts)$/.test(entry.name)) {
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(new RegExp(`(?<![\\w:/-])(hover:)?text-(${chromatic.join("|")})-(100|500)(?:/(\\d+))?(?![\\w-])`, "g"))) {
        used.add(`${m[1] ?? ""}|${m[2]}|${m[3]}|${m[4] ?? ""}`);
      }
    }
  }
})("src");
const text100Rules = [...used]
  .sort()
  .map((key) => {
    const [hover, f, shade, alpha] = key.split("|");
    const target = shade === "100" ? 900 : darkerFiveHundred.has(f) ? 600 : 700;
    const color = alpha ? `color-mix(in oklab, ${get(f, target)} ${alpha}%, transparent)` : get(f, target);
    const cls = `.${hover ? "hover\\:" : ""}text-${f}-${shade}${alpha ? `\\/${alpha}` : ""}${hover ? ":hover" : ""}`;
    return `:root[data-theme="light"] ${cls}:not(.theme-force-dark *),\n.theme-force-light ${cls} {\n  color: ${color};\n}`;
  })
  .join("\n");
const groupHoverRule = `:root[data-theme="light"] .group:hover .group-hover\\:text-orange-100:not(.theme-force-dark *) {\n  color: ${get("orange", 900)};\n}`;

const out = `/* ARCHIVO GENERADO por scripts/generate-theme-css.mjs: no editar a mano.
 *
 * Modo claro: espeja las escalas neutras de Tailwind (gray/zinc/neutral/slate/stone 50-900) y oscurece
 * los tonos 200-400 de los colores cromaticos (pensados como texto sobre fondo oscuro).
 * El modo oscuro no redefine nada: usa los valores por defecto de Tailwind.
 */
:root[data-theme="light"],
.theme-force-light {
${lightLines.join("\n")}
}

${text100Rules}
${groupHoverRule}

/* Scope que fija la apariencia oscura sin importar el tema global (ver docs/ARCHITECTURE.md > Temas). */
.theme-force-dark {
  color-scheme: dark;
${resetLines.join("\n")}
}
`;
writeFileSync("src/app/theme-palette.css", out);
console.log("theme-palette.css written:", lightLines.length, "light vars");
