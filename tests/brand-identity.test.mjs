// Identidad visual de Universo Stampa: assets oficiales generados, iconos de la PWA, metadatos Open Graph y ausencia de logos antiguos.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const sharp = createRequire(import.meta.url)("sharp");

test("los SVG oficiales están versionados y los PNG de marca salen de ellos (con transparencia)", async () => {
  for (const f of ["design/brand/universo-stampa-isotipo.svg", "design/brand/universo-stampa-logotipo.svg"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  for (const [file, w, h] of [["public/brand/universo-isotipo.png", 512, 357], ["public/brand/universo-logotipo.png", 1200, 403]]) {
    const meta = await sharp(path.join(root, file)).metadata();
    assert.deepEqual([meta.width, meta.height, meta.hasAlpha], [w, h, true], file);
  }
  // Los componentes usan las proporciones reales: si cambian los archivos hay que actualizarlas.
  const component = read("src/components/brand/UniversoLogo.tsx");
  assert.match(component, /width: 512, height: 357/);
  assert.match(component, /width: 1200, height: 403/);
});

test("iconos de la PWA y favicon: tamaños correctos, referenciados por el manifest y por el layout", async () => {
  const expected = { "icon-192.png": 192, "icon-512.png": 512, "icon-512-maskable.png": 512, "apple-touch-icon.png": 180, "icon-32.png": 32, "icon-48.png": 48 };
  for (const [name, size] of Object.entries(expected)) {
    const meta = await sharp(path.join(root, "public/icons", name)).metadata();
    assert.deepEqual([meta.width, meta.height], [size, size], name);
  }
  // PWA / apple-touch son opacos (fondo del producto); el maskable deja margen para la zona segura.
  for (const name of ["icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"]) {
    const { channels } = await sharp(path.join(root, "public/icons", name)).stats();
    const alpha = channels[3];
    assert.equal(alpha.min, 255, `${name} debe ser opaco`);
  }
  const ico = fs.readFileSync(path.join(root, "src/app/favicon.ico"));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3], "favicon.ico con 3 tamaños");
  const manifest = read("src/app/manifest.ts");
  for (const src of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png"]) assert.match(manifest, new RegExp(src.replace(/\./g, "\.")));
  assert.match(manifest, /name: "Universo Stampa"/);
  assert.match(manifest, /background_color: "#171717"/);
});

test("metadatos: Open Graph y Twitter apuntan a la imagen oficial de 1200x630", async () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /metadataBase: new URL\(siteOrigin\(\)\)/);
  assert.match(layout, /openGraph:/);
  assert.match(layout, /summary_large_image/);
  assert.match(layout, /apple-touch-icon\.png/);
  const meta = await sharp(path.join(root, "public/og/universo-stampa-og.png")).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 630]);
});

test("la interfaz de Universo usa la identidad nueva y no quedan logos antiguos", () => {
  for (const file of [
    "src/components/layout/sidebar.tsx",
    "src/components/layout/mobile-header.tsx",
    "src/components/auth/AuthBrand.tsx",
    "src/components/explorar-modelos/ExplorarModelosClient.tsx",
    "src/app/sin-acceso/sin-acceso-client.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /UniversoIsotipo/, file);
    assert.doesNotMatch(source, /src="\/favicon\.svg"/, `${file}: logo antiguo`);
  }
  for (const file of [
    "src/components/landing-hero/UniversoHero.tsx",
    "src/components/landing-hero/commercial/PreviewFooter.tsx",
    "src/components/landing-membership/LandingMembershipNavbar.tsx",
    "src/components/landing-membership/LandingFooter.tsx",
  ]) assert.match(read(file), /UniversoLogotipo/, file);
  // Superficies que siguen el tema claro/oscuro no pueden usar el logotipo completo (su texto es blanco).
  for (const file of ["src/components/layout/sidebar.tsx", "src/components/layout/mobile-header.tsx", "src/components/auth/AuthBrand.tsx"]) {
    assert.doesNotMatch(read(file), /UniversoLogotipo/, `${file}: el logotipo completo solo va sobre fondos oscuros`);
  }
});
