// Genera los PNG de marca de Universo Stampa a partir de los SVG oficiales (design/brand/*.svg).
//
// Cada SVG oficial trae DOS imágenes PNG incrustadas: la ilustración a color sobre fondo negro y la misma silueta en escala
// de grises, que el SVG usa como máscara de luminancia para volver transparente el fondo. Este script reproduce exactamente
// esa composición (color + máscara => RGBA) y nada más: no redibuja, no vectoriza ni retoca la identidad. Lo único que hace
// además es (1) recortar el margen vacío, (2) quitar el halo negro de los bordes antialias (des-premultiplicar contra negro)
// para que el logo se vea limpio también sobre fondos claros, y (3) apoyar el resultado sobre el fondo del producto
// (#171717) para los iconos que no admiten transparencia (PWA, apple-touch, Open Graph).
//
// Uso: node scripts/brand/build-brand-assets.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BG = { r: 23, g: 23, b: 23, alpha: 1 }; // #171717, igual que theme_color / background_color del manifest.

function embeddedPngs(svgPath) {
  const svg = readFileSync(svgPath, "utf8");
  const found = [...svg.matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) => Buffer.from(m[1], "base64"));
  if (found.length !== 2) throw new Error(`${svgPath}: se esperaban 2 imágenes incrustadas (máscara + color), hay ${found.length}`);
  return found;
}

/** Devuelve { data, width, height } RGBA no premultiplicado, recortado al contenido visible con `pad` px de margen. */
async function compose(svgPath, pad) {
  const [a, b] = embeddedPngs(svgPath);
  // La imagen en escala de grises (1 canal) es la máscara; la RGB es el color.
  const [mask, color] = (await sharp(a).metadata()).channels === 1 ? [a, b] : [b, a];
  const { width, height } = await sharp(color).metadata();
  const maskRaw = await sharp(mask).greyscale().raw().toBuffer();
  const rgb = await sharp(color).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const alpha = maskRaw[i];
    // Des-premultiplicar: el color fue pintado sobre negro, así que en los bordes parciales está oscurecido por esa proporción.
    for (let c = 0; c < 3; c++) {
      const v = rgb[i * 3 + c];
      rgba[i * 4 + c] = alpha === 0 ? 0 : alpha >= 250 ? v : Math.min(255, Math.round((v * 255) / alpha));
    }
    rgba[i * 4 + 3] = alpha;
  }
  // Recorte al contenido (alfa > 8).
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const left = Math.max(0, minX - pad), top = Math.max(0, minY - pad);
  const w = Math.min(width, maxX + pad + 1) - left, h = Math.min(height, maxY + pad + 1) - top;
  const cropped = await sharp(rgba, { raw: { width, height, channels: 4 } }).extract({ left, top, width: w, height: h }).png().toBuffer();
  return { png: cropped, width: w, height: h };
}

const out = (rel) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); return p; };

/** Centra `png` dentro de un lienzo cuadrado transparente de `size`, ocupando `fill` (0-1) del lado mayor. */
async function square(png, size, fill, background) {
  const inner = Math.round(size * fill);
  const resized = await sharp(png).resize({ width: inner, height: inner, fit: "inside" }).toBuffer();
  const m = await sharp(resized).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }])
    .png({ compressionLevel: 9 });
}

const iso = await compose(join(root, "design/brand/universo-stampa-isotipo.svg"), 24);
const logo = await compose(join(root, "design/brand/universo-stampa-logotipo.svg"), 24);

// Piezas transparentes para la interfaz.
writeFileSync(out("public/brand/universo-isotipo.png"), await sharp(iso.png).resize({ width: 512, fit: "inside" }).png({ compressionLevel: 9 }).toBuffer());
writeFileSync(out("public/brand/universo-logotipo.png"), await sharp(logo.png).resize({ width: 1200, fit: "inside" }).png({ compressionLevel: 9 }).toBuffer());

// Favicon / iconos de pestaña: isotipo sobre transparente (cuadrado) y .ico de 16/32/48.
for (const size of [32, 48]) writeFileSync(out(`public/icons/icon-${size}.png`), await (await square(iso.png, size, 0.96)).toBuffer());
// PWA y apple-touch: fondo opaco del producto. "any" ocupa ~84 %; "maskable" ~62 % para quedar dentro de la zona segura (círculo del 80 %).
writeFileSync(out("public/icons/icon-192.png"), await (await square(iso.png, 192, 0.84, BG)).toBuffer());
writeFileSync(out("public/icons/icon-512.png"), await (await square(iso.png, 512, 0.84, BG)).toBuffer());
writeFileSync(out("public/icons/icon-512-maskable.png"), await (await square(iso.png, 512, 0.62, BG)).toBuffer());
writeFileSync(out("public/icons/apple-touch-icon.png"), await (await square(iso.png, 180, 0.8, BG)).toBuffer());

// favicon.ico (PNG embebido en un contenedor ICO: 16, 32 y 48 px).
const icoSizes = [16, 32, 48];
const icoPngs = await Promise.all(icoSizes.map(async (s) => (await square(iso.png, s, 0.96)).toBuffer()));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + 16 * icoSizes.length;
const entries = icoSizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(icoPngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += icoPngs[i].length;
  return e;
});
writeFileSync(out("src/app/favicon.ico"), Buffer.concat([header, ...entries, ...icoPngs]));

// favicon.svg: el mismo isotipo (PNG transparente incrustado) para los clientes que piden SVG.
const svgPng = await (await square(iso.png, 256, 0.96)).toBuffer();
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256" width="256" height="256"><title>Universo Stampa</title><image width="256" height="256" xlink:href="data:image/png;base64,${svgPng.toString("base64")}"/></svg>\n`;
writeFileSync(out("public/favicon.svg"), favicon);

// Open Graph / Twitter: 1200x630, logotipo completo (texto blanco) sobre el fondo del producto.
const ogLogo = await sharp(logo.png).resize({ width: 920, fit: "inside" }).toBuffer();
const ogMeta = await sharp(ogLogo).metadata();
writeFileSync(
  out("public/og/universo-stampa-og.png"),
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: BG } })
    .composite([{ input: ogLogo, left: Math.round((1200 - ogMeta.width) / 2), top: Math.round((630 - ogMeta.height) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

console.log(JSON.stringify({ isotipo: [iso.width, iso.height], logotipo: [logo.width, logo.height] }));
