// Verificación REAL de Explorar Modelos: consulta cada fuente configurada y compara contra el contrato.
//
//   node scripts/verify-model-search.mjs "soporte auriculares"
//
// Lee las credenciales de .env.local (o del entorno) y hace requests reales, una por fuente. Nunca imprime claves.
// Una fuente sin credencial se informa como "disabled" (no verificada). Sale con código 1 si alguna fuente habilitada
// falla o devuelve datos que no cumplen el contrato; con 2 si no hay ninguna fuente habilitada.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnvFile(path.join(root, ".env.local"));

const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const mod = { exports: {} };
  cache.set(filename, mod);
  const localRequire = (request) => {
    if (request.startsWith("@/")) return load(path.join(root, "src", `${request.slice(2)}.ts`));
    if (request.startsWith(".")) return load(path.resolve(path.dirname(filename), `${request}.ts`));
    throw new Error(`Dependencia inesperada: ${request}`);
  };
  new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
  return mod.exports;
}

const { createDefaultProviders } = load(path.join(root, "src/lib/model-search/registry.ts"));
const { searchModels, PROVIDER_TIMEOUT_MS } = load(path.join(root, "src/lib/model-search/service.ts"));

const query = process.argv.slice(2).join(" ").trim() || "headphone stand";
const providers = createDefaultProviders();
const enabled = providers.filter((provider) => provider.isEnabled());

console.log(`Consulta: "${query}"  (timeout por fuente: ${PROVIDER_TIMEOUT_MS} ms)\n`);
for (const provider of providers) {
  if (!provider.isEnabled()) console.log(`- ${provider.label}: DISABLED (falta credencial) → NO verificada contra el servicio real`);
}
if (enabled.length === 0) {
  console.log("\nNinguna fuente tiene credenciales: nada que verificar. Ver docs/ARCHITECTURE.md §18 para configurarlas.");
  process.exit(2);
}

let failed = false;
const problems = [];
for (const provider of enabled) {
  const started = Date.now();
  const filters = { price: "any", commercial: "any", sort: "relevance" };
  const response = await searchModels({ query, sources: [provider.id], filters, cursor: {} }, { providers: [provider] });
  const source = response.sources[0];
  const ms = Date.now() - started;
  console.log(`\n- ${provider.label}: ${source.status.toUpperCase()} · ${response.results.length} resultados · ${ms} ms · hasMore=${source.hasMore}`);
  if (source.status !== "ok") {
    failed = true;
    problems.push(`${provider.label}: estado ${source.status} (ver el log [model-search] provider failed para el motivo)`);
    continue;
  }
  if (response.results.length === 0) {
    problems.push(`${provider.label}: respondió OK pero sin resultados para "${query}" (probá otra consulta antes de darla por verificada)`);
    continue;
  }
  for (const result of response.results.slice(0, 3)) {
    const thumbHost = result.thumbnailUrl ? new URL(result.thumbnailUrl).host : "sin imagen";
    console.log(`    · ${result.title} | autor: ${result.authorName ?? "—"} | precio: ${result.priceType} | img: ${thumbHost}`);
    console.log(`      ${result.originalUrl}`);
  }
  const withImage = response.results.filter((result) => result.thumbnailUrl).length;
  const priced = response.results.filter((result) => result.priceType !== "unknown").length;
  const licensed = response.results.filter((result) => result.license.name).length;
  console.log(`    cobertura: imagen ${withImage}/${response.results.length} · precio informado ${priced}/${response.results.length} · licencia ${licensed}/${response.results.length}`);
  if (withImage === 0) problems.push(`${provider.label}: ningún resultado con imagen válida (¿dominio de CDN fuera de la lista permitida en providers/${provider.id}.ts?)`);
}

if (problems.length) console.log(`\nA revisar:\n${problems.map((problem) => `  ! ${problem}`).join("\n")}`);
console.log(failed ? "\nRESULTADO: hay fuentes con fallas." : "\nRESULTADO: las fuentes habilitadas respondieron. Revisá las advertencias antes de darlas por verificadas.");
process.exit(failed ? 1 : 0);
