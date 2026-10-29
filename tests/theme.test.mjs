import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadThemeModule() {
  const filename = path.join(root, "src/lib/theme/theme.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    () => { throw new Error("The theme module must stay dependency-free"); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const theme = loadThemeModule();

/** Ejecuta el script de inicializacion contra un DOM minimo y devuelve lo que dejo en <html> y <meta>. */
function runInitScript({ stored, systemLight = false, throwOnStorage = false }) {
  const attrs = {};
  const root = { dataset: {}, style: {} };
  const meta = { content: "#171717", setAttribute(name, value) { if (name === "content") this.content = value; } };
  const fakeDocument = { documentElement: root, querySelector: (selector) => (selector === 'meta[name="theme-color"]' ? meta : null) };
  const fakeLocalStorage = {
    getItem() {
      if (throwOnStorage) throw new Error("blocked");
      return stored ?? null;
    },
  };
  const fakeMatchMedia = (query) => ({ matches: query === "(prefers-color-scheme: light)" ? systemLight : false });
  new Function("document", "localStorage", "matchMedia", theme.THEME_INIT_SCRIPT)(fakeDocument, fakeLocalStorage, fakeMatchMedia);
  return { dataset: root.dataset, colorScheme: root.style.colorScheme, metaColor: meta.content, attrs };
}

test("el tema por defecto conserva el aspecto oscuro original", () => {
  assert.equal(theme.DEFAULT_THEME_PREFERENCE, "dark");
  const result = runInitScript({ stored: null, systemLight: true });
  assert.equal(result.dataset.theme, "dark");
  assert.equal(result.dataset.themePreference, "dark");
  assert.equal(result.colorScheme, "dark");
  assert.equal(result.metaColor, theme.THEME_COLORS.dark);
});

test("el script de inicializacion respeta la preferencia guardada antes del primer render", () => {
  const light = runInitScript({ stored: "light" });
  assert.equal(light.dataset.theme, "light");
  assert.equal(light.colorScheme, "light");
  assert.equal(light.metaColor, theme.THEME_COLORS.light);

  assert.equal(runInitScript({ stored: "dark", systemLight: true }).dataset.theme, "dark");
});

test("el modo automatico sigue al sistema operativo", () => {
  const onLight = runInitScript({ stored: "system", systemLight: true });
  assert.equal(onLight.dataset.theme, "light");
  assert.equal(onLight.dataset.themePreference, "system");
  assert.equal(runInitScript({ stored: "system", systemLight: false }).dataset.theme, "dark");
});

test("valores guardados invalidos o storage bloqueado caen al valor por defecto", () => {
  assert.equal(runInitScript({ stored: "rosa" }).dataset.theme, "dark");
  assert.equal(runInitScript({ throwOnStorage: true }).dataset.theme, "dark");
});

test("isThemePreference solo acepta las tres preferencias", () => {
  for (const ok of ["light", "dark", "system"]) assert.equal(theme.isThemePreference(ok), true);
  for (const bad of ["auto", "", null, undefined, 1]) assert.equal(theme.isThemePreference(bad), false);
});

function tokensOf(css, selectorPattern) {
  const block = css.match(selectorPattern);
  assert.ok(block, `bloque no encontrado: ${selectorPattern}`);
  return new Set([...block[1].matchAll(/(--stampa-[a-z-]+)\s*:/g)].map((m) => m[1]));
}

test("el tema claro define todos los tokens --stampa-* del tema oscuro", () => {
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const dark = tokensOf(css, /:root,\s*\.theme-force-dark\s*\{([\s\S]*?)\n\}/);
  const light = tokensOf(css, /:root\[data-theme="light"\],\s*\.theme-force-light\s*\{([\s\S]*?)\n\}/);
  assert.ok(dark.size >= 15, "el bloque oscuro deberia definir los tokens base");
  assert.deepEqual([...dark].filter((token) => !light.has(token)), [], "tokens del oscuro sin equivalente en claro");
  assert.deepEqual([...light].filter((token) => !dark.has(token)), [], "tokens del claro sin equivalente en oscuro");
});

test("la paleta del modo claro esta generada y es consistente con el reseteo de theme-force-dark", () => {
  const css = fs.readFileSync(path.join(root, "src/app/theme-palette.css"), "utf8");
  const light = css.match(/:root\[data-theme="light"\],\s*\.theme-force-light\s*\{([\s\S]*?)\n\}/);
  const forceDark = css.match(/\.theme-force-dark\s*\{([\s\S]*?)\n\}/);
  assert.ok(light && forceDark);
  const names = (block) => new Set([...block.matchAll(/(--color-[a-z]+-\d+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual([...names(light[1])].sort(), [...names(forceDark[1])].sort());
  // 950 es tinta fija de los botones naranjas: nunca se remapea.
  assert.ok(![...names(light[1])].some((name) => name.endsWith("-950")));
});

test("el layout raiz inyecta el script de tema en <head> y no vuelve dinamico el render", () => {
  const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /THEME_INIT_SCRIPT/);
  assert.match(layout, /<head>[\s\S]*THEME_INIT_SCRIPT[\s\S]*<\/head>/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.doesNotMatch(layout, /cookies\(\)|headers\(\)/);
});
