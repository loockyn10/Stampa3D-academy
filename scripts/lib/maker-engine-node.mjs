// Carga el motor REAL de Stampa Maker (src/lib/maker/**, TypeScript) en Node,
// sin build: transpila con el compilador de TypeScript y resuelve el alias
// "@/…" y los imports relativos. Lo usan los tests de presets y el generador
// de miniaturas, para que ambos pasen por exactamente el mismo motor que la
// aplicación (nunca un segundo motor de geometría).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const srcRoot = path.join(root, "src");
const nodeRequire = createRequire(path.join(root, "package.json"));
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
  const { outputText } = ts.transpileModule(fs.readFileSync(absPath, "utf8"), {
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

/** Carga `src/<relFromSrc>` (p.ej. "lib/maker/defaults.ts"). */
export function loadMakerModule(relFromSrc) {
  return loadTsModule(path.join(srcRoot, relFromSrc));
}

/** Carga una fuente del catálogo de Maker desde public/fonts/maker (mismo archivo que sirve la app). */
export function loadMakerFontFile(fileName) {
  const opentype = nodeRequire("opentype.js");
  const buf = fs.readFileSync(path.join(root, "public/fonts/maker", fileName));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export { nodeRequire, root };
