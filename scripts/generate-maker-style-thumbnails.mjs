// Genera las miniaturas de los estilos del Creador de Carteles con el motor
// REAL (createLetterGeometry): mismo texto de ejemplo para todos, misma
// cámara, mismo catálogo que ve el visor. Salida: public/maker/styles/<id>.png
// + manifest.json (firma de cada estilo, para que un test detecte miniaturas
// desactualizadas). Uso:  node scripts/generate-maker-style-thumbnails.mjs
import fs from "node:fs";
import path from "node:path";
import { loadMakerModule, loadMakerFontFile, nodeRequire, root } from "./lib/maker-engine-node.mjs";
import { renderPartsToRgba } from "./lib/maker-thumbnail-render.mjs";

const UPNG = nodeRequire("upng-js");
const { createLetterGeometry } = loadMakerModule("lib/maker/geometry/createLetterGeometry.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const { getMakerFontDefinition } = loadMakerModule("lib/maker/fonts/registry.ts");
const styles = loadMakerModule("lib/maker/presets/stylePresets.ts");

export const THUMBNAIL_SIZE = { width: 400, height: 300 };

const outDir = path.join(root, "public/maker/styles");
fs.mkdirSync(outDir, { recursive: true });

const fontFile = path.basename(getMakerFontDefinition(DEFAULT_LETTER_SIGN_PARAMS.fontId).url);
const font = loadMakerFontFile(fontFile);

const manifest = {
  generator: "scripts/generate-maker-style-thumbnails.mjs",
  sampleText: styles.STYLE_THUMBNAIL_SAMPLE_TEXT,
  sampleHeightMm: styles.STYLE_THUMBNAIL_SAMPLE_HEIGHT_MM,
  fontId: DEFAULT_LETTER_SIGN_PARAMS.fontId,
  width: THUMBNAIL_SIZE.width,
  height: THUMBNAIL_SIZE.height,
  styles: [],
};

for (const preset of styles.STYLE_PRESETS) {
  const params = {
    ...DEFAULT_LETTER_SIGN_PARAMS,
    ...styles.resolveStyleSettings(preset),
    text: styles.STYLE_THUMBNAIL_SAMPLE_TEXT,
    heightMm: styles.STYLE_THUMBNAIL_SAMPLE_HEIGHT_MM,
  };
  const geometry = createLetterGeometry(font, params);
  if (geometry.errors.length > 0 || geometry.triangleCount === 0) {
    throw new Error(`El estilo "${preset.id}" no genera un modelo válido: ${geometry.errors.map((e) => e.message).join(" | ") || "sin triángulos"}`);
  }
  const { width, height, rgba } = renderPartsToRgba(geometry.parts, THUMBNAIL_SIZE);
  const png = Buffer.from(UPNG.encode([rgba.buffer], width, height, 256));
  const file = `${preset.id}.png`;
  fs.writeFileSync(path.join(outDir, file), png);
  manifest.styles.push({ id: preset.id, version: preset.version, signature: styles.styleSignature(preset), file, triangles: geometry.triangleCount, parts: geometry.parts.map((p) => p.kind), bytes: png.length });
  console.log(`${preset.id.padEnd(11)} ${String(geometry.triangleCount).padStart(7)} tri  ${geometry.parts.map((p) => p.kind).join("+").padEnd(22)} ${(png.length / 1024).toFixed(1)} KB`);
}

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${manifest.styles.length} miniaturas en ${path.relative(root, outDir)}`);
