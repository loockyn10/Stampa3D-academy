import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Carga módulos TypeScript de src/lib/maker/** (mismo mecanismo que tests/maker-mugs.test.mjs).
const root = process.cwd();
const srcRoot = path.join(root, "src");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModulePath(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No se pudo resolver "${specifier}" desde ${fromFile}`);
}

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;
  const source = fs.readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: absPath,
  });
  const mod = { exports: {} };
  moduleCache.set(absPath, mod);
  const localRequire = (specifier) => {
    const resolved = resolveModulePath(specifier, absPath);
    return resolved ? loadTsModule(resolved) : nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", outputText)(localRequire, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

const load = (rel) => loadTsModule(path.join(srcRoot, rel));

// Jarros 3D congelado: Beta / solo administradores.
const { canAccessMakerTool, visibleMakerTools, MAKER_TOOL_AVAILABILITY } = load("lib/maker/availability.ts");
const read = (rel) => fs.readFileSync(path.join(srcRoot, rel), "utf8");
const TOOLS = [{ href: "/stampa-maker/carteles" }, { href: "/stampa-maker/neon" }, { href: "/stampa-maker/jarros" }];
const hrefs = (list) => list.map((t) => t.href);

test("landing: el admin ve Jarros con badge Beta", () => {
  const list = visibleMakerTools(TOOLS, true);
  assert.deepEqual(hrefs(list), hrefs(TOOLS));
  assert.equal(list.find((t) => t.href.endsWith("jarros")).beta, true);
});

test("landing: el usuario normal no ve Jarros; Carteles y Neon no cambian ni son beta", () => {
  const list = visibleMakerTools(TOOLS, false);
  assert.deepEqual(hrefs(list), ["/stampa-maker/carteles", "/stampa-maker/neon"]);
  assert.ok(list.every((t) => t.beta === false));
});

test("acceso a rutas: Jarros solo admin; Carteles y Neon abiertos", () => {
  assert.equal(canAccessMakerTool("/stampa-maker/jarros", true), true);
  assert.equal(canAccessMakerTool("/stampa-maker/jarros", false), false);
  for (const h of ["/stampa-maker/carteles", "/stampa-maker/neon"]) {
    assert.equal(canAccessMakerTool(h, false), true);
    assert.equal(MAKER_TOOL_AVAILABILITY.find((t) => t.href === h)?.adminOnly, undefined);
  }
});

test("la ruta /stampa-maker/jarros se protege server-side con el rol admin existente", () => {
  const layout = read("app/stampa-maker/jarros/layout.tsx");
  assert.doesNotMatch(layout, /"use client"/);
  assert.match(layout, /getCurrentUserAccess/);
  assert.match(layout, /capabilities\.accessAdmin/);
  assert.match(layout, /redirect\("\/stampa-maker"\)/);
  const action = read("app/stampa-maker/jarros/actions.ts");
  assert.match(action, /capabilities\.accessAdmin/);
});

test("la landing decide con el rol server-side y usa la política de disponibilidad", () => {
  const page = read("app/stampa-maker/page.tsx");
  assert.doesNotMatch(page, /"use client"/);
  assert.match(page, /capabilities\.accessAdmin/);
  assert.match(page, /visibleMakerTools/);
  assert.match(page, /Beta/);
});
