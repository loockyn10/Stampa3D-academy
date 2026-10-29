import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

/**
 * Búsqueda ampliada en el servicio. TODO con providers y fetch SIMULADOS: prueban la orquestación (variantes,
 * mezcla, paginación, filtros, caché, timeouts, presupuesto, cancelación, errores parciales), NO que las plataformas
 * reales encuentren modelos con las variantes. Eso lo comprueba `node scripts/verify-model-search.mjs --multilingual`.
 */
const root = process.cwd();

function createLoader() {
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
      throw new Error(`Unexpected dependency: ${request}`);
    };
    new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return (relative) => load(path.join(root, relative));
}

const load = createLoader();
const service = load("src/lib/model-search/service.ts");
const params = load("src/lib/model-search/params.ts");
const cacheLib = load("src/lib/model-search/cache.ts");
const resultsLib = load("src/lib/model-search/results.ts");
const cults = load("src/lib/model-search/providers/cults.ts");
const mmf = load("src/lib/model-search/providers/myminifactory.ts");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const filters = { price: "any", commercial: "any", sort: "relevance" };
const request = (extra = {}) => ({ query: "soporte notebook", sources: null, filters, cursor: {}, ...extra });
const deps = (providers, extra = {}) => ({
  providers,
  cache: cacheLib.createTtlCache(60_000, 100),
  timeoutMs: 250,
  variantGraceMs: 120,
  variantLimiters: new Map(),
  ...extra,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function res(source, id, title, extra = {}) {
  return {
    source,
    externalId: String(id),
    title,
    authorName: null,
    authorUrl: null,
    thumbnailUrl: null,
    originalUrl: `https://www.${source}.com/${id}`,
    priceType: "free",
    price: 0,
    currency: "USD",
    license: { name: null, url: null, commercialUse: "unknown", attributionRequired: "unknown", remixAllowed: null },
    likes: null,
    downloads: null,
    views: null,
    rating: null,
    publishedAt: null,
    fileFormats: null,
    ...extra,
  };
}
const page = (results, hasMore = false) => ({ results, total: results.length, hasMore });

/** Provider simulado que registra cada consulta que recibe. */
function makeProvider(id, handler, capabilities = {}) {
  const calls = [];
  const provider = {
    id,
    label: id,
    isEnabled: () => true,
    getCapabilities: () => ({
      sorts: ["relevance", "popular", "newest"],
      maxPerPage: 30,
      supportsPriceFilter: true,
      reportsPrice: true,
      priceFilterMode: "post",
      commercialFilters: ["allowed"],
      maxQueryVariants: 1,
      variantsPerMinute: 1000,
      ...capabilities,
    }),
    health: async () => ({ status: "ok" }),
    search: async (input) => {
      calls.push({ query: input.query, page: input.page, perPage: input.perPage, filters: input.filters, signal: input.signal });
      return handler(input);
    },
  };
  return { provider, calls };
}
const queriesOf = (calls) => calls.map((call) => call.query);
const silenceWarnings = async (run) => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    return { value: await run(), warnings };
  } finally {
    console.warn = original;
  }
};

// ---------- Consulta original + variante ----------

test("cada fuente recibe la consulta original y UNA variante (límite por capacidad), con página más chica para la variante", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([]));
  const response = await service.searchModels(request(), deps([provider]));
  assert.deepEqual(queriesOf(calls).sort(), ["laptop stand", "soporte notebook"]);
  assert.equal(calls.find((call) => call.query === "soporte notebook").perPage, 12);
  assert.equal(calls.find((call) => call.query === "laptop stand").perPage, 6);
  assert.deepEqual(response.queryVariants, ["laptop stand"]);
});

test("un provider sin capacidad de variantes solo recibe la consulta original", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([res("cults", 1, "Soporte")]), { maxQueryVariants: undefined });
  const response = await service.searchModels(request(), deps([provider]));
  assert.deepEqual(queriesOf(calls), ["soporte notebook"]);
  assert.deepEqual(response.queryVariants, []);
  const zero = makeProvider("cults", async () => page([]), { maxQueryVariants: 0 });
  await service.searchModels(request(), deps([zero.provider]));
  assert.deepEqual(queriesOf(zero.calls), ["soporte notebook"]);
});

test("el tope global manda aunque un provider declare más variantes", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([]), { maxQueryVariants: 99 });
  await service.searchModels(request(), deps([provider]));
  assert.ok(calls.length <= 3, `como máximo original + 2 variantes, hubo ${calls.length}`);
  assert.equal(calls.length, 3);
});

test("consulta sin variante interpretable: una sola request por fuente y sin indicador", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([res("cults", 1, "Benchy")]));
  const response = await service.searchModels(request({ query: "benchy" }), deps([provider]));
  assert.deepEqual(queriesOf(calls), ["benchy"]);
  assert.deepEqual(response.queryVariants, []);
});

test("resultados distintos por idioma se combinan: MMF no encuentra en español pero sí con la variante", async () => {
  const cultsP = makeProvider("cults", async ({ query }) => page(query === "soporte notebook" ? [res("cults", 1, "Soporte notebook plegable")] : []));
  const mmfP = makeProvider("myminifactory", async ({ query }) =>
    page(query === "laptop stand" ? [res("myminifactory", 7, "Laptop Stand"), res("myminifactory", 8, "Foldable Laptop Stand")] : []),
  );
  const response = await service.searchModels(request(), deps([cultsP.provider, mmfP.provider]));
  assert.deepEqual(
    response.results.map((item) => `${item.source}:${item.externalId}`).sort(),
    ["cults:1", "myminifactory:7", "myminifactory:8"],
  );
  assert.deepEqual(response.sources.map((source) => [source.id, source.status, source.count]), [["cults", "ok", 1], ["myminifactory", "ok", 2]]);
  assert.deepEqual(response.queryVariants, ["laptop stand"]);
});

test("la consulta original conserva prioridad: 2 de la original por 1 de la variante, la variante nunca la reemplaza", async () => {
  const { provider } = makeProvider("cults", async ({ query }) =>
    page(
      query === "soporte notebook"
        ? [1, 2, 3, 4].map((n) => res("cults", `o${n}`, `Soporte notebook ${n}`))
        : [1, 2].map((n) => res("cults", `v${n}`, `Laptop stand ${n}`)),
    ),
  );
  const response = await service.searchModels(request(), deps([provider]));
  assert.deepEqual(response.results.map((item) => item.externalId), ["o1", "o2", "v1", "o3", "o4", "v2"]);
});

test("una variante con resultados sin relación va al final y no desplaza a los relevantes (nada se descarta)", () => {
  const original = [res("cults", "o1", "Soporte notebook"), res("cults", "o2", "Soporte notebook 2")];
  const variant = [res("cults", "x1", "Sombrilla de playa"), res("cults", "v1", "Laptop Stand")];
  const merged = service.mergeProviderResults(original, [{ query: "laptop stand", results: variant }]);
  assert.deepEqual(merged.map((item) => item.externalId), ["o1", "o2", "v1", "x1"]);
  assert.equal(merged.length, 4, "los resultados poco relacionados se conservan, solo se ordenan al final");
});

test("deduplicación: el mismo modelo en la original y en la variante aparece una sola vez (conserva el enlace original)", async () => {
  const shared = res("cults", "same", "Laptop stand", { originalUrl: "https://cults3d.com/en/3d-model/home/laptop-stand" });
  const { provider } = makeProvider("cults", async ({ query }) =>
    page(query === "soporte notebook" ? [shared, res("cults", "o2", "Soporte notebook")] : [shared, res("cults", "v2", "Laptop stand 2")]),
  );
  const response = await service.searchModels(request(), deps([provider]));
  const ids = response.results.map((item) => item.externalId);
  assert.equal(ids.filter((id) => id === "same").length, 1);
  assert.deepEqual([...ids].sort(), ["o2", "same", "v2"]);
  assert.equal(response.results.find((item) => item.externalId === "same").originalUrl, "https://cults3d.com/en/3d-model/home/laptop-stand");
});

test("el mismo modelo republicado en otra plataforma sigue deduplicándose entre fuentes", async () => {
  const a = makeProvider("cults", async () => page([res("cults", "1", "Laptop Stand", { authorName: "Ana" })]));
  const b = makeProvider("myminifactory", async () => page([res("myminifactory", "9", "Laptop stand", { authorName: "ana" })]));
  const response = await service.searchModels(request(), deps([a.provider, b.provider]));
  assert.equal(response.results.length, 1);
});

test("plataforma, imagen, autor, precio y licencia de cada resultado llegan intactos", async () => {
  const original = res("myminifactory", 5, "Laptop Stand", {
    authorName: "Beto",
    authorUrl: "https://www.myminifactory.com/users/beto",
    thumbnailUrl: "https://assets.myminifactory.com/x.jpg",
    priceType: "paid",
    price: 4.5,
    currency: "USD",
    license: { name: "CC BY", url: null, commercialUse: "allowed", attributionRequired: true, remixAllowed: true },
  });
  const { provider } = makeProvider("myminifactory", async ({ query }) => page(query === "laptop stand" ? [original] : []));
  const response = await service.searchModels(request(), deps([provider]));
  assert.deepEqual(response.results[0], original);
});

// ---------- Paginación ----------

test("paginación: cada consulta avanza su propia página y 'Ver más' no repite ni pierde modelos", async () => {
  const handler = async ({ query, page: current }) => {
    const prefix = query === "soporte notebook" ? "o" : "v";
    return page([res("cults", `${prefix}${current}a`, `Laptop stand ${prefix}${current}a`), res("cults", `${prefix}${current}b`, `Laptop stand ${prefix}${current}b`)], current < 3);
  };
  const { provider, calls } = makeProvider("cults", handler);
  const d = deps([provider]);

  const first = await service.searchModels(request(), d);
  const cursor1 = params.decodeCursor(first.nextCursor);
  assert.deepEqual(cursor1, { cults: 2, "cults~1": 2 });

  const second = await service.searchModels(request({ cursor: cursor1 }), d);
  assert.deepEqual(calls.slice(2).map((call) => [call.query, call.page]).sort(), [["laptop stand", 2], ["soporte notebook", 2]]);
  assert.deepEqual(params.decodeCursor(second.nextCursor), { cults: 3, "cults~1": 3 });

  const third = await service.searchModels(request({ cursor: params.decodeCursor(second.nextCursor) }), d);
  assert.equal(third.nextCursor, null, "agotadas las dos consultas no hay más páginas");

  // Como hace la UI: acumular páginas sin repetir.
  let shown = [];
  for (const response of [first, second, third]) shown = resultsLib.mergeUniqueResults(shown, response.results);
  const ids = shown.map((item) => item.externalId);
  assert.equal(new Set(ids).size, ids.length, "sin repetidos");
  assert.deepEqual([...ids].sort(), ["o1a", "o1b", "o2a", "o2b", "o3a", "o3b", "v1a", "v1b", "v2a", "v2b", "v3a", "v3b"], "no desaparece ninguno entre páginas");
});

test("si la variante se agota primero, la original sigue sin volver a pedir la variante", async () => {
  const { provider, calls } = makeProvider("cults", async ({ query, page: current }) =>
    page([res("cults", `${query}-${current}`, `Laptop stand ${current}`)], query === "soporte notebook"),
  );
  const d = deps([provider]);
  const first = await service.searchModels(request(), d);
  assert.deepEqual(params.decodeCursor(first.nextCursor), { cults: 2, "cults~1": null });
  await service.searchModels(request({ cursor: params.decodeCursor(first.nextCursor) }), d);
  assert.deepEqual(calls.slice(2).map((call) => call.query), ["soporte notebook"], "la variante agotada no se vuelve a consultar");
});

test("si la original se agota primero, la variante sigue paginando", async () => {
  const { provider, calls } = makeProvider("cults", async ({ query, page: current }) =>
    page([res("cults", `${query}-${current}`, `Laptop stand ${current}`)], query === "laptop stand"),
  );
  const d = deps([provider]);
  const first = await service.searchModels(request(), d);
  assert.deepEqual(params.decodeCursor(first.nextCursor), { cults: null, "cults~1": 2 });
  const second = await service.searchModels(request({ cursor: params.decodeCursor(first.nextCursor) }), d);
  assert.deepEqual(calls.slice(2).map((call) => [call.query, call.page]), [["laptop stand", 2]]);
  assert.equal(second.sources[0].status, "ok");
});

test("el estado de cada fuente se conserva al paginar: una fuente agotada no se vuelve a pedir desde la página 1", async () => {
  const a = makeProvider("cults", async ({ page: current }) => page([res("cults", `c${current}`, "Laptop stand")], false));
  const b = makeProvider("myminifactory", async ({ page: current }) => page([res("myminifactory", `m${current}`, "Laptop stand")], true));
  const d = deps([a.provider, b.provider]);
  const first = await service.searchModels(request(), d);
  const cursor = params.decodeCursor(first.nextCursor);
  assert.equal(cursor.cults, null);
  assert.equal(cursor["cults~1"], null);
  await service.searchModels(request({ cursor }), d);
  assert.equal(a.calls.length, 2, "Cults (agotada) no recibe más requests");
  assert.equal(b.calls.length, 4);
});

// ---------- Filtros ----------

test("los filtros viajan igual a la original y a la variante y el post-filtro de precio alcanza a ambas", async () => {
  const { provider, calls } = makeProvider("myminifactory", async ({ query }) =>
    page(
      query === "soporte notebook"
        ? [res("myminifactory", 1, "Soporte notebook", { priceType: "free" }), res("myminifactory", 2, "Soporte", { priceType: "paid" })]
        : [res("myminifactory", 3, "Laptop stand", { priceType: "free" }), res("myminifactory", 4, "Laptop stand", { priceType: "unknown" }), res("myminifactory", 5, "Laptop stand", { priceType: "paid" })],
    ),
  );
  const response = await service.searchModels(request({ filters: { price: "free", commercial: "allowed", sort: "popular" } }), deps([provider]));
  assert.deepEqual(response.results.map((item) => item.externalId).sort(), ["1", "3"]);
  for (const call of calls) assert.deepEqual(call.filters, { price: "free", commercial: "allowed", sort: "popular" });
});

test("una fuente que no soporta el filtro queda fuera: no se le pide ni la original ni la variante", async () => {
  const unsupported = makeProvider("cults", async () => page([res("cults", 1, "x")]), { supportsPriceFilter: false });
  const supported = makeProvider("myminifactory", async () => page([res("myminifactory", 2, "Laptop stand")]));
  const response = await service.searchModels(request({ filters: { ...filters, price: "free" } }), deps([unsupported.provider, supported.provider]));
  assert.equal(unsupported.calls.length, 0);
  assert.equal(response.sources.find((source) => source.id === "cults").status, "unsupported");
  assert.equal(supported.calls.length, 2);
});

test("funciona con un único proveedor seleccionado", async () => {
  const a = makeProvider("cults", async () => page([res("cults", 1, "Laptop stand")]));
  const b = makeProvider("myminifactory", async () => page([res("myminifactory", 2, "Laptop stand")]));
  const response = await service.searchModels(request({ sources: ["myminifactory"] }), deps([a.provider, b.provider]));
  assert.equal(a.calls.length, 0);
  assert.equal(b.calls.length, 2);
  assert.deepEqual(response.sources.map((source) => source.id), ["myminifactory"]);
  assert.deepEqual(response.queryVariants, ["laptop stand"]);
});

// ---------- Caché ----------

test("caché: repetir la búsqueda no repite requests (ni la original ni la variante)", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([res("cults", 1, "Laptop stand")]));
  const d = deps([provider]);
  await service.searchModels(request(), d);
  assert.equal(calls.length, 2);
  const again = await service.searchModels(request(), d);
  assert.equal(calls.length, 2, "todo salió de la caché");
  assert.deepEqual(again.queryVariants, ["laptop stand"], "la indicación de búsqueda ampliada se mantiene con respuestas en caché");
});

test("caché: dos consultas distintas con la misma variante reutilizan la variante", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([res("cults", 1, "Laptop stand")]));
  const d = deps([provider]);
  await service.searchModels(request({ query: "soporte notebook" }), d);
  await service.searchModels(request({ query: "soporte de notebook" }), d);
  assert.equal(calls.filter((call) => call.query === "laptop stand").length, 1);
  assert.equal(calls.filter((call) => call.query !== "laptop stand").length, 2);
});

test("una variante que falló no se cachea: el siguiente intento vuelve a consultarla", async () => {
  let failVariant = true;
  const { provider, calls } = makeProvider("cults", async ({ query }) => {
    if (query === "laptop stand" && failVariant) throw new Error("boom");
    return page([res("cults", query, query)]);
  });
  const d = deps([provider]);
  await silenceWarnings(() => service.searchModels(request(), d));
  failVariant = false;
  const retry = await service.searchModels(request(), d);
  assert.equal(calls.filter((call) => call.query === "laptop stand").length, 2);
  assert.deepEqual(retry.queryVariants, ["laptop stand"]);
});

// ---------- Errores parciales ----------

test("una variante caída no marca la fuente con error ni toca los resultados de la original", async () => {
  const { provider } = makeProvider("cults", async ({ query }) => {
    if (query === "laptop stand") throw new Error("variant down");
    return page([res("cults", 1, "Soporte notebook")], true);
  });
  const { value: response, warnings } = await silenceWarnings(() => service.searchModels(request(), deps([provider])));
  assert.deepEqual(response.sources, [{ id: "cults", status: "ok", count: 1, hasMore: true }]);
  assert.deepEqual(response.queryVariants, [], "una variante que no respondió no se informa como usada");
  assert.deepEqual(params.decodeCursor(response.nextCursor), { cults: 2 });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].variant, true);
  assert.doesNotMatch(JSON.stringify(warnings), /laptop stand|soporte notebook/, "el log no incluye lo que busca el usuario");
});

test("si la original falla pero la variante responde, la fuente aporta la variante", async () => {
  const { provider } = makeProvider("myminifactory", async ({ query }) => {
    if (query === "soporte notebook") throw new Error("original down");
    return page([res("myminifactory", 1, "Laptop Stand")]);
  });
  const { value: response } = await silenceWarnings(() => service.searchModels(request(), deps([provider])));
  assert.equal(response.sources[0].status, "ok");
  assert.deepEqual(response.results.map((item) => item.externalId), ["1"]);
});

test("si todas las consultas de una fuente fallan: error de esa fuente, un solo aviso, y las demás siguen", async () => {
  const bad = makeProvider("cults", async () => {
    throw new Error("down");
  });
  const good = makeProvider("myminifactory", async () => page([res("myminifactory", 1, "Laptop Stand")]));
  const { value: response, warnings } = await silenceWarnings(() => service.searchModels(request(), deps([bad.provider, good.provider])));
  assert.equal(response.sources.find((source) => source.id === "cults").status, "error");
  assert.equal(response.sources.find((source) => source.id === "myminifactory").status, "ok");
  assert.equal(warnings.length, 1);
});

test("429 de la fuente se informa como rate_limited aunque la variante también haya fallado", async () => {
  const { ProviderHttpError } = load("src/lib/model-search/types.ts");
  const { provider } = makeProvider("cults", async () => {
    throw new ProviderHttpError(429);
  });
  const { value: response } = await silenceWarnings(() => service.searchModels(request(), deps([provider])));
  assert.equal(response.sources[0].status, "rate_limited");
});

// ---------- Timeouts, lentitud y cancelación ----------

test("una variante lenta (que ignora la señal) no bloquea los resultados de la original", async () => {
  const { provider } = makeProvider("cults", async ({ query }) => {
    if (query === "laptop stand") return new Promise(() => {});
    return page([res("cults", 1, "Soporte notebook")]);
  });
  const started = Date.now();
  const response = await service.searchModels(request(), deps([provider], { timeoutMs: 2000, variantGraceMs: 40 }));
  assert.ok(Date.now() - started < 700, `tardó ${Date.now() - started} ms: debía cortar la variante tras el margen, no esperar 2000 ms`);
  assert.equal(response.sources[0].status, "ok");
  assert.deepEqual(response.results.map((item) => item.externalId), ["1"]);
  assert.deepEqual(response.queryVariants, []);
});

test("el margen de gracia no corta a una variante que responde a tiempo", async () => {
  const { provider } = makeProvider("cults", async ({ query }) => {
    if (query === "laptop stand") {
      await sleep(30);
      return page([res("cults", "v", "Laptop stand")]);
    }
    return page([res("cults", "o", "Soporte notebook")]);
  });
  const response = await service.searchModels(request(), deps([provider], { variantGraceMs: 300 }));
  assert.deepEqual(response.results.map((item) => item.externalId).sort(), ["o", "v"]);
  assert.deepEqual(response.queryVariants, ["laptop stand"]);
});

test("el timeout individual también rige para las variantes y no afecta a la original", async () => {
  const { provider } = makeProvider("cults", async ({ query, signal }) => {
    if (query === "laptop stand") {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1500);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    return page([res("cults", query, query)]);
  });
  const started = Date.now();
  const response = await service.searchModels(request(), deps([provider], { timeoutMs: 60, variantGraceMs: 5000 }));
  assert.ok(Date.now() - started < 600);
  assert.deepEqual(response.results.map((item) => item.externalId), ["soporte notebook"]);
});

test("la señal de abortar llega a la variante y la búsqueda cancelada termina enseguida", async () => {
  const hang = ({ signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const { provider, calls } = makeProvider("cults", hang);
  const controller = new AbortController();
  const started = Date.now();
  const pending = service.searchModels(request({ signal: controller.signal }), deps([provider], { timeoutMs: 5000, variantGraceMs: 5000 }));
  await sleep(20);
  controller.abort();
  const { value: response } = await silenceWarnings(() => pending);
  assert.ok(Date.now() - started < 1000, "no espera los 5000 ms");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.signal.aborted), "original y variante recibieron la cancelación");
  assert.equal(response.sources[0].status, "timeout");
});

test("una búsqueda ya cancelada no deja temporizadores colgados ni consultas pendientes", async () => {
  const { provider } = makeProvider("cults", async () => page([res("cults", 1, "Laptop stand")]));
  const controller = new AbortController();
  controller.abort();
  const { value: response } = await silenceWarnings(() => service.searchModels(request({ signal: controller.signal }), deps([provider])));
  assert.ok(Array.isArray(response.results));
});

// ---------- Presupuesto de consultas (rate limiting) ----------

test("las variantes tienen presupuesto propio por minuto: agotado, solo se consulta la original y se conserva la página", async () => {
  const { provider, calls } = makeProvider("cults", async ({ query }) => page([res("cults", query, `Laptop stand ${query}`)]), { variantsPerMinute: 1 });
  const d = deps([provider]);
  const first = await service.searchModels(request({ query: "soporte notebook" }), d);
  assert.deepEqual(first.queryVariants, ["laptop stand"]);

  const second = await service.searchModels(request({ query: "soporte celular" }), d);
  assert.deepEqual(queriesOf(calls).filter((query) => query === "phone stand"), [], "la variante de la segunda búsqueda no se pidió");
  assert.deepEqual(second.queryVariants, []);
  assert.equal(second.sources[0].status, "ok", "agotar el presupuesto no es un error de la fuente");

  // Con la página de la variante ya en curso, el cursor se conserva para retomarla cuando haya presupuesto.
  const third = await service.searchModels(request({ query: "soporte celular", cursor: { cults: 2, "cults~1": 2 } }), d);
  assert.deepEqual(params.decodeCursor(third.nextCursor), { cults: null, "cults~1": 2 }, "la original se agotó; la variante conserva su página");
});

test("presupuesto cero o por provider: la original nunca se ve afectada", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([res("cults", 1, "Soporte notebook")]), { variantsPerMinute: 0 });
  const response = await service.searchModels(request(), deps([provider]));
  assert.deepEqual(queriesOf(calls), ["soporte notebook"]);
  assert.equal(response.results.length, 1);
});

test("el presupuesto es independiente por fuente", async () => {
  const a = makeProvider("cults", async () => page([res("cults", 1, "Laptop stand")]), { variantsPerMinute: 1 });
  const b = makeProvider("myminifactory", async () => page([res("myminifactory", 2, "Laptop stand")]), { variantsPerMinute: 5 });
  const d = deps([a.provider, b.provider]);
  await service.searchModels(request({ query: "soporte notebook" }), d);
  await service.searchModels(request({ query: "soporte celular" }), d);
  assert.equal(queriesOf(a.calls).filter((query) => query === "phone stand").length, 0);
  assert.equal(queriesOf(b.calls).filter((query) => query === "phone stand").length, 1);
});

// ---------- Punto de enganche para interpretación avanzada ----------

test("expandQuery inyectable (IA a futuro): se usa, se sanea y sus fallos no rompen la búsqueda", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([res("cults", 1, "Hammock stand")]));
  const received = [];
  const hook = async (query, max) => {
    received.push([query, max]);
    return ["Hammock Stand", "hammock stand", "  ", "x".repeat(500), "hamaca soporte", "otra más"];
  };
  const response = await service.searchModels(request({ query: "hamaca" }), deps([provider], { expandQuery: hook }));
  assert.deepEqual(received, [["hamaca", 2]]);
  assert.deepEqual(queriesOf(calls).map((query) => query.toLowerCase()).sort(), ["hamaca", "hammock stand"], "sin repetidos, sin vacíos, sin textos enormes y ≤ capacidad del provider");
  assert.deepEqual(response.queryVariants, ["Hammock Stand"]);

  const broken = makeProvider("cults", async () => page([res("cults", 2, "Soporte")]));
  const survived = await service.searchModels(
    request(),
    deps([broken.provider], {
      expandQuery: async () => {
        throw new Error("modelo caído");
      },
    }),
  );
  assert.deepEqual(queriesOf(broken.calls), ["soporte notebook"]);
  assert.deepEqual(survived.queryVariants, []);
});

test("sin interpretación (expandQuery vacío) la búsqueda se comporta como antes", async () => {
  const { provider, calls } = makeProvider("cults", async () => page([res("cults", 1, "x")]));
  const response = await service.searchModels(request(), deps([provider], { expandQuery: () => [] }));
  assert.deepEqual(queriesOf(calls), ["soporte notebook"]);
  assert.deepEqual(response.queryVariants, []);
});

// ---------- Providers reales (código de producción) con fetch simulado ----------

test("Cults3D y MyMiniFactory reales: la variante viaja como consulta propia, con página chica y credenciales solo en el servidor", async () => {
  const cultsBodies = [];
  const mmfUrls = [];
  const cultsProvider = cults.createCultsProvider({
    username: () => "u",
    apiKey: () => "CULTS-SECRET",
    fetch: async (_url, init) => {
      cultsBodies.push(JSON.parse(init.body).variables);
      return new Response(JSON.stringify({ data: { creationsSearchBatch: { total: 100, results: [] } } }), { status: 200 });
    },
  });
  const mmfProvider = mmf.createMyMiniFactoryProvider({
    apiKey: () => "MMF-SECRET",
    fetch: async (url) => {
      mmfUrls.push(new URL(url));
      return new Response(JSON.stringify({ total_count: 100, items: [] }), { status: 200 });
    },
  });
  const d = deps([cultsProvider, mmfProvider]);
  const first = await service.searchModels(request(), d);
  assert.deepEqual(cultsBodies.map((v) => [v.query, v.limit, v.offset]).sort(), [["laptop stand", 6, 0], ["soporte notebook", 12, 0]]);
  assert.deepEqual(mmfUrls.map((u) => [u.searchParams.get("q"), u.searchParams.get("per_page"), u.searchParams.get("page")]).sort(), [["laptop stand", "6", "1"], ["soporte notebook", "12", "1"]]);

  await service.searchModels(request({ cursor: params.decodeCursor(first.nextCursor) }), d);
  assert.deepEqual(cultsBodies.slice(2).map((v) => [v.query, v.limit, v.offset]).sort(), [["laptop stand", 6, 6], ["soporte notebook", 12, 12]], "offset coherente con el tamaño de cada consulta");
  assert.deepEqual(mmfUrls.slice(2).map((u) => [u.searchParams.get("q"), u.searchParams.get("page")]).sort(), [["laptop stand", "2"], ["soporte notebook", "2"]]);
  assert.doesNotMatch(JSON.stringify(first), /SECRET/);
});

// ---------- Cursor ----------

test("el cursor acepta claves de variante válidas y rechaza el resto", () => {
  const ok = params.encodeCursor({ cults: 2, "cults~1": 3, myminifactory: null, "myminifactory~1": 2 });
  assert.deepEqual(params.decodeCursor(ok), { cults: 2, "cults~1": 3, myminifactory: null, "myminifactory~1": 2 });
  for (const key of ["cults~0", "cults~3", "cults~1~1", "foo~1", "~1", "cults~x", "cults~"]) {
    const forged = Buffer.from(JSON.stringify({ [key]: 2 })).toString("base64url");
    assert.equal(params.decodeCursor(forged), null, key);
  }
  assert.equal(params.cursorDepth({ cults: 2, "cults~1": 4 }), 4);
  const full = params.encodeCursor({ cults: 20, "cults~1": 20, "cults~2": 20, myminifactory: 20, "myminifactory~1": 20, "myminifactory~2": 20, thingiverse: 20, "thingiverse~1": 20, "thingiverse~2": 20 });
  assert.ok(full.length <= 400 && params.decodeCursor(full) !== null, "el cursor máximo cabe en el límite");
});

test("el tope de páginas del visitante anónimo sigue rigiendo con cursores de variante", () => {
  const route = read("src/app/api/model-search/route.ts");
  assert.match(route, /cursorDepth\(cursor\) > maxPages/);
  assert.match(route, /signal: request\.signal/);
  assert.match(route, /anonymousLimiter = createRateLimiter/);
});

// ---------- UI (estático, igual que el resto de la suite) ----------

test("UI: encabezado compacto — título solo para lectores de pantalla y buscador al comienzo", () => {
  const client = read("src/components/explorar-modelos/ExplorarModelosClient.tsx");
  assert.match(client, /<h1 className="sr-only">Explorar Modelos/);
  assert.doesNotMatch(client, /text-2xl font-extrabold/);
  assert.doesNotMatch(client, /Encontrá modelos 3D en distintas plataformas desde un solo lugar\.<\/p>/);
  assert.match(client, /px-4 py-3 sm:py-4/);
  assert.match(client, /role="search"/);
  assert.match(client, /aria-label="Borrar búsqueda"/);
  assert.match(client, /Búsqueda en curso|animate-spin/);
  const layout = read("src/app/main-layout.tsx");
  assert.match(layout, /isExploreModelsRoute \? "py-2 lg:py-3" : "py-6 lg:py-8"/, "el ajuste de aire vertical es solo para esta ruta");
});

test("UI: historial compacto y expandible, conservado", () => {
  const client = read("src/components/explorar-modelos/ExplorarModelosClient.tsx");
  assert.match(client, /const RECENT_COLLAPSED = 3/);
  assert.match(client, /aria-expanded=\{recentExpanded\}/);
  assert.match(client, /Borrar historial/);
  assert.match(client, /RECENT_SEARCHES_KEY/);
});

test("UI: filtros desplegables accesibles, una fila en escritorio, panel en móvil y todos los filtros existentes", () => {
  const bar = read("src/components/explorar-modelos/ModelSearchFilterBar.tsx");
  const client = read("src/components/explorar-modelos/ExplorarModelosClient.tsx");
  assert.match(bar, /aria-haspopup="listbox"/);
  assert.match(bar, /aria-expanded=\{open\}/);
  assert.match(bar, /role="listbox"/);
  assert.match(bar, /role="option"/);
  assert.match(bar, /aria-selected/);
  for (const key of ["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Tab"]) assert.ok(bar.includes(`"${key}"`), `teclado: ${key}`);
  assert.match(bar, /pointerdown/, "cierra al hacer clic afuera");
  assert.match(bar, /max-w-\[min\(20rem,calc\(100vw-2rem\)\)\]/, "el desplegable no desborda a 320 px");
  assert.match(bar, /Limpiar filtros/);
  assert.match(bar, /isGroupActive/, "los filtros activos se distinguen");
  // Los cuatro filtros y sus opciones siguen existiendo; solo cambió la presentación.
  for (const label of ['label: "Fuente"', 'label: "Precio"', 'label: "Uso comercial"', 'label: "Orden"']) assert.ok(client.includes(label), label);
  assert.match(client, /<FilterDropdowns/);
  assert.match(client, /<FilterChipGroups/);
  assert.match(client, /className="mt-2\.5 hidden sm:block"/, "escritorio");
  assert.match(client, /className="mt-2\.5 sm:hidden"/, "móvil: botón Filtros");
  assert.match(client, /aria-expanded=\{filtersOpen\}/);
  assert.match(client, /activeFilterCount > 0/);
  // Las aclaraciones ya no ocupan espacio permanente: viven dentro del desplegable.
  assert.doesNotMatch(client, /<p className="text-xs text-gray-500">Los modelos con precio no informado/);
  assert.match(client, /hint: !priceEnabled/);
  assert.match(client, /commercialHint/);
});

test("UI: indicador de búsqueda ampliada discreto, solo con variantes usadas, y se conserva al paginar", () => {
  const client = read("src/components/explorar-modelos/ExplorarModelosClient.tsx");
  assert.match(client, /const showExpansion = queryVariants\.length > 0 && submitted/);
  assert.match(client, /\{showExpansion && \(/);
  assert.match(client, /Búsqueda ampliada:/);
  assert.match(client, /\[submitted, \.\.\.queryVariants\]\.join\(" · "\)/);
  assert.match(client, /text-xs text-gray-500/, "texto chico y neutro");
  assert.match(client, /append \? Array\.from\(new Set\(\[\.\.\.current/);
  assert.equal(client.split("Búsqueda ampliada:").length - 1, 1, "una única aparición");
});

test("UI: claro/oscuro/automático — solo tokens del sistema, sin colores fijos", () => {
  for (const file of ["src/components/explorar-modelos/ModelSearchFilterBar.tsx", "src/components/explorar-modelos/ExplorarModelosClient.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /\b(bg-white|bg-black|text-black|text-white)\b/, file);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/, file);
    assert.doesNotMatch(source, /process\.env|model-search\/(providers|registry|service)/, file);
  }
  assert.doesNotMatch(read("src/components/explorar-modelos/ModelSearchFilterBar.tsx"), /#[0-9a-fA-F]{3,8}\b/);
});

test("el tutorial de Explorar Modelos refleja el buscador multilingüe y los filtros compactos", () => {
  const tutorial = read("src/lib/tutorials/definitions/tools.ts");
  const block = tutorial.slice(tutorial.indexOf("modelSearchTutorial"));
  assert.match(block, /español o en inglés/);
  assert.match(block, /desplegables/);
});
