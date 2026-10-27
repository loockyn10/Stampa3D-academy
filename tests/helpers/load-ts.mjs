import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const nodeRequire = createRequire(path.join(root, "package.json"));

/**
 * Carga un módulo TS/TSX del repo transpilado a CommonJS, resolviendo `@/…` recursivamente.
 * `mocks` reemplaza especificadores concretos (p. ej. "next/link"); react y lucide-react se cargan reales.
 */
export function loadTs(relativePath, mocks = {}, cache = new Map()) {
  const absolute = path.join(root, relativePath);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const { outputText } = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: absolute,
  });
  const m = { exports: {} };
  cache.set(absolute, m);
  const localRequire = (specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier.startsWith("@/") || specifier.startsWith("./") || specifier.startsWith("../")) {
      const base = specifier.startsWith("@/")
        ? path.join("src", specifier.slice(2))
        : path.join(path.dirname(relativePath), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(path.join(root, candidate))) return loadTs(candidate, mocks, cache);
      }
      throw new Error(`No se pudo resolver ${specifier}`);
    }
    if (specifier === "react" || specifier.startsWith("react/") || specifier.startsWith("react-dom") || specifier === "lucide-react") {
      return nodeRequire(specifier);
    }
    throw new Error(`Dependencia inesperada: ${specifier}`);
  };
  new Function("require", "module", "exports", outputText)(localRequire, m, m.exports);
  return m.exports;
}

export const readRepoFile = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
