import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

/**
 * Explorar Modelos — Sprint 3. Todo con fetch MOCKEADO: estos tests prueban que la integración está implementada y
 * resiliente, NO que las plataformas reales respondan (eso lo comprueba `node scripts/verify-model-search.mjs`).
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
const cults = load("src/lib/model-search/providers/cults.ts");
const mmf = load("src/lib/model-search/providers/myminifactory.ts");
const tv = load("src/lib/model-search/providers/thingiverse.ts");
const service = load("src/lib/model-search/service.ts");
const results = load("src/lib/model-search/results.ts");
const recent = load("src/lib/model-search/recent.ts");
const cache = load("src/lib/model-search/cache.ts");
const sourcesMeta = load("src/lib/model-search/sources.ts");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const filters = { price: "any", commercial: "any", sort: "relevance" };
const request = (extra = {}) => ({ query: "soporte auriculares", sources: null, filters, cursor: {}, ...extra });
const freshDeps = (providers, extra = {}) => ({ providers, cache: cache.createTtlCache(60_000, 50), timeoutMs: 200, ...extra });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Providers REALES (código de producción) con fetch simulado y credenciales falsas.
function cultsWith(fetch) {
  return cults.createCultsProvider({ fetch, username: () => "u", apiKey: () => "k" });
}
function mmfWith(fetch) {
  return mmf.createMyMiniFactoryProvider({ fetch, apiKey: () => "k" });
}
function tvWith(fetch) {
  return tv.createThingiverseProvider({ fetch, accessToken: () => "t" });
}

const cultsBody = (items) => ({ data: { creationsSearchBatch: { total: items.length, results: items } } });
const cultsRow = (n, extra = {}) => ({
  id: `c${n}`,
  name: `Soporte cults ${n}`,
  url: `https://cults3d.com/en/3d-model/gadget/soporte-${n}`,
  illustrationImageUrl: `https://images.cults3d.com/${n}.png`,
  price: { cents: 0 },
  creator: { nick: "ana", shortUrl: "https://cults3d.com/en/users/ana/3d-models" },
  license: { name: "Cults - Private Use", url: null },
  likesCount: 1,
  downloadsCount: 2,
  viewsCount: 3,
  publishedAt: "2026-01-01T00:00:00Z",
  ...extra,
});
const mmfRow = (n, extra = {}) => ({
  id: n,
  url: `https://www.myminifactory.com/object/3d-print-soporte-${n}`,
  name: `Soporte mmf ${n}`,
  designer: { name: "Beto", profile_url: "https://www.myminifactory.com/users/beto" },
  images: [{ is_primary: true, thumbnail: { url: `https://cdn.myminifactory.com/${n}.jpg` } }],
  licenses: [{ type: "store", value: false }],
  files: [{ filename: "a.stl" }],
  ...extra,
});
const tvRow = (n, extra = {}) => ({
  id: n,
  name: `Soporte tv ${n}`,
  public_url: `https://www.thingiverse.com/thing:${n}`,
  thumbnail: `https://cdn.thingiverse.com/renders/${n}.jpg`,
  creator: { name: "carla", public_url: "https://www.thingiverse.com/carla" },
  is_nsfw: false,
  ...extra,
});

// ---------- Múltiples plataformas disponibles (providers reales + fetch simulado) ----------

test("múltiples plataformas: se consultan en paralelo, se normalizan y se intercalan con URL original válida", async () => {
  const providers = [
    cultsWith(async () => json(cultsBody([cultsRow(1), cultsRow(2)]))),
    tvWith(async () => json({ total: 2, hits: [tvRow(10), tvRow(11)] })),
    mmfWith(async () => json({ total_count: 2, items: [mmfRow(20), mmfRow(21)] })),
  ];
  const response = await service.searchModels(request(), freshDeps(providers));
  assert.equal(response.results.length, 6);
  assert.deepEqual(response.sources.map((s) => s.status), ["ok", "ok", "ok"]);
  // Round-robin: las tres primeras son de fuentes distintas.
  assert.deepEqual(response.results.slice(0, 3).map((r) => r.source), ["cults", "thingiverse", "myminifactory"]);
  for (const r of response.results) {
    assert.ok(r.title && r.externalId);
    assert.match(r.originalUrl, /^https:\/\/(www\.)?(cults3d|thingiverse|myminifactory)\.com\//);
    assert.match(r.thumbnailUrl, /^https:\/\//);
  }
  // Nada inventado: Thingiverse no informa precio ni licencia comercial.
  const thing = response.results.find((r) => r.source === "thingiverse");
  assert.equal(thing.priceType, "unknown");
  assert.equal(thing.price, null);
  assert.equal(thing.license.commercialUse, "unknown");
});

test("las tres fuentes caídas: respuesta válida sin resultados y estado por fuente (no rompe)", async () => {
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  const response = await service.searchModels(request(), freshDeps([cultsWith(down), tvWith(down), mmfWith(down)]));
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.sources.map((s) => s.status), ["error", "error", "error"]);
  assert.equal(response.nextCursor, null);
});

// ---------- Errores de conexión, rate limit, credenciales ----------

test("error de conexión de una fuente: las otras responden y el estado es 'error'", async () => {
  const response = await service.searchModels(
    request(),
    freshDeps([
      mmfWith(async () => {
        throw new TypeError("fetch failed");
      }),
      tvWith(async () => json({ total: 1, hits: [tvRow(1)] })),
    ]),
  );
  assert.equal(response.sources.find((s) => s.id === "myminifactory").status, "error");
  assert.equal(response.sources.find((s) => s.id === "thingiverse").status, "ok");
  assert.equal(response.results.length, 1);
});

test("HTTP 429 de una fuente => rate_limited; 401/500 => error; ningún detalle técnico llega al cliente", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const response = await service.searchModels(
      request(),
      freshDeps([
        mmfWith(async () => json({ message: "slow down" }, 429)),
        tvWith(async () => json({ message: "bad token SECRET" }, 401)),
        cultsWith(async () => json({}, 500)),
      ]),
    );
    assert.equal(response.sources.find((s) => s.id === "myminifactory").status, "rate_limited");
    assert.equal(response.sources.find((s) => s.id === "thingiverse").status, "error");
    assert.equal(response.sources.find((s) => s.id === "cults").status, "error");
    assert.doesNotMatch(JSON.stringify(response), /SECRET|slow down/);
    // El log seguro registra proveedor y código HTTP, no el cuerpo ni la credencial.
    assert.ok(warnings.length === 3);
    assert.doesNotMatch(JSON.stringify(warnings), /SECRET|"k"|"t"/);
  } finally {
    console.warn = originalWarn;
  }
});

test("una respuesta con error no se cachea: el siguiente intento vuelve a consultar", async () => {
  let calls = 0;
  const provider = mmfWith(async () => {
    calls += 1;
    return calls === 1 ? json({}, 500) : json({ total_count: 1, items: [mmfRow(1)] });
  });
  const deps = freshDeps([provider]);
  assert.equal((await service.searchModels(request(), deps)).sources[0].status, "error");
  const second = await service.searchModels(request(), deps);
  assert.equal(second.sources[0].status, "ok");
  assert.equal(second.results.length, 1);
});

// ---------- Respuestas incompletas / sin resultados ----------

test("respuestas incompletas: cuerpos vacíos o sin campos no rompen y se descartan items inválidos", async () => {
  const empty = await service.searchModels(
    request(),
    freshDeps([mmfWith(async () => json({})), tvWith(async () => json({})), cultsWith(async () => json(cultsBody([])))]),
  );
  assert.deepEqual(empty.results, []);
  assert.deepEqual(empty.sources.map((s) => s.status), ["ok", "ok", "ok"]);
  assert.deepEqual(empty.sources.map((s) => s.count), [0, 0, 0]);

  const partial = await service.searchModels(
    request({ sources: ["myminifactory"] }),
    freshDeps([
      mmfWith(async () =>
        json({
          total_count: 4,
          items: [
            mmfRow(1),
            { id: 2, name: "Sin url" },
            { id: 3, url: "https://evil.example.com/object/3", name: "Dominio ajeno" },
            mmfRow(4, { images: [], designer: null, licenses: undefined }),
          ],
        }),
      ),
    ]),
  );
  assert.deepEqual(partial.results.map((r) => r.externalId), ["1", "4"]);
  const sparse = partial.results[1];
  assert.equal(sparse.thumbnailUrl, null);
  assert.equal(sparse.authorName, null);
  assert.equal(sparse.priceType, "unknown");
});

test("Cults con respuesta GraphQL inválida => error de la fuente (no resultados falsos)", async () => {
  const response = await service.searchModels(request(), freshDeps([cultsWith(async () => json({ data: null }))]));
  assert.equal(response.sources[0].status, "error");
  assert.deepEqual(response.results, []);
});

// ---------- Cancelación y búsquedas consecutivas ----------

test("cancelación: si el llamador aborta, se aborta el pedido a las fuentes y no se cachea", async () => {
  const controller = new AbortController();
  let providerSignal;
  const provider = mmfWith(
    (url, init) =>
      new Promise((resolve, reject) => {
        providerSignal = init.signal;
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
  );
  const deps = freshDeps([provider], { timeoutMs: 5000 });
  const pending = service.searchModels(request({ signal: controller.signal }), deps);
  controller.abort();
  const response = await pending;
  assert.equal(providerSignal.aborted, true);
  assert.equal(response.sources[0].status, "timeout");
  assert.equal(deps.cache.size(), 0);
});

test("búsquedas consecutivas: consultas distintas no se mezclan y la repetida sale de caché", async () => {
  const seen = [];
  const provider = mmfWith(async (url) => {
    const q = new URL(url).searchParams.get("q");
    seen.push(q);
    return json({ total_count: 1, items: [mmfRow(q === "dragon" ? 1 : 2, { name: `Resultado ${q}` })] });
  });
  const deps = freshDeps([provider]);
  const a = await service.searchModels(request({ query: "dragon" }), deps);
  const b = await service.searchModels(request({ query: "soporte" }), deps);
  const again = await service.searchModels(request({ query: "dragon" }), deps);
  assert.equal(a.results[0].title, "Resultado dragon");
  assert.equal(b.results[0].title, "Resultado soporte");
  assert.equal(again.results[0].title, "Resultado dragon");
  assert.deepEqual(seen, ["dragon", "soporte"]);
});

test("paginación con providers reales: el cursor pide la página siguiente solo a quien tiene más", async () => {
  const mmfUrls = [];
  const providers = [
    mmfWith(async (url) => {
      mmfUrls.push(url);
      return json({ total_count: 100, items: [mmfRow(Number(new URL(url).searchParams.get("page")))] });
    }),
    tvWith(async () => json({ total: 1, hits: [tvRow(1)] })),
  ];
  const deps = freshDeps(providers);
  const first = await service.searchModels(request(), deps);
  assert.ok(first.nextCursor);
  const decoded = JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8"));
  assert.deepEqual(decoded, { myminifactory: 2, thingiverse: null });
  const second = await service.searchModels(request({ cursor: decoded }), deps);
  assert.equal(new URL(mmfUrls[1]).searchParams.get("page"), "2");
  assert.deepEqual(second.results.map((r) => r.source), ["myminifactory"]);
});

// ---------- Deduplicación entre plataformas ----------

function fake(source, id, title, authorName) {
  return {
    source,
    externalId: id,
    title,
    authorName,
    authorUrl: null,
    thumbnailUrl: null,
    originalUrl: `https://www.${source}.com/${id}`,
    priceType: "unknown",
    price: null,
    currency: null,
    license: { name: null, url: null, commercialUse: "unknown", attributionRequired: "unknown", remixAllowed: null },
    likes: null,
    downloads: null,
    views: null,
    rating: null,
    publishedAt: null,
    fileFormats: null,
  };
}

test("dedupe entre plataformas: mismo título+autor se muestra una vez; sin autor o autor distinto se conserva", () => {
  const list = [
    fake("cults", "1", "Soporte Auriculares!", "Ana"),
    fake("thingiverse", "2", "soporte auriculares", " ana "),
    fake("myminifactory", "3", "Soporte auriculares", "Beto"),
    fake("thingiverse", "4", "Dragón", null),
    fake("myminifactory", "5", "Dragón", null),
  ];
  const out = results.dedupeAcrossSources(list);
  assert.deepEqual(out.map((r) => r.externalId), ["1", "3", "4", "5"]);
  // Al anexar una segunda página tampoco reaparece.
  const merged = results.mergeUniqueResults(out, [fake("thingiverse", "9", "SOPORTE auriculares", "Ana"), fake("cults", "1", "Soporte Auriculares!", "Ana")]);
  assert.equal(merged.length, out.length);
});

// ---------- Historial reciente ----------

test("historial reciente: sin repetidos, tope y tolerante a datos corruptos", () => {
  let list = [];
  for (const q of ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete"]) list = recent.addRecentSearch(list, q);
  assert.equal(list.length, recent.MAX_RECENT_SEARCHES);
  assert.equal(list[0], "siete");
  list = recent.addRecentSearch(list, "  CINCO ");
  assert.deepEqual(list.slice(0, 2), ["CINCO", "siete"]);
  assert.equal(list.filter((q) => q.toLowerCase() === "cinco").length, 1);
  assert.deepEqual(recent.addRecentSearch(["a"], "   "), ["a"]);
  assert.deepEqual(recent.parseRecentSearches("{no es json"), []);
  assert.deepEqual(recent.parseRecentSearches('{"a":1}'), []);
  assert.deepEqual(recent.parseRecentSearches('["ok", 3, "", null]'), ["ok"]);
});

// ---------- UI / integración (estático) ----------

test("UI: sin fuentes disponibles se ve la interfaz completa con un aviso honesto (no se esconde ni se inventan resultados)", () => {
  const client = read("src/components/explorar-modelos/ExplorarModelosClient.tsx");
  assert.doesNotMatch(client, /enabledProviders\.length === 0 \?/, "no debe reemplazar toda la UI cuando no hay fuentes");
  assert.match(client, /Las plataformas de modelos no están disponibles por ahora/);
  assert.match(client, /No mostramos resultados de ejemplo/);
  // Las fuentes no disponibles se muestran como tales en el filtro Fuente.
  assert.match(client, /no disponible<\/span>/);
  // Estados: inicial, buscando, sin resultados, error parcial, error total.
  for (const text of ["Buscá un modelo para empezar", "No encontramos modelos para", "Ninguna plataforma pudo responder ahora", "Mostrando resultados de"]) {
    assert.ok(client.includes(text), text);
  }
  assert.match(client, /rate_limited/);
});

test("UI: botón de limpiar, Enter/Buscar, historial en localStorage tolerante y filtros mobile sin overflow", () => {
  const client = read("src/components/explorar-modelos/ExplorarModelosClient.tsx");
  assert.match(client, /aria-label="Borrar búsqueda"/);
  assert.match(client, /type="submit"/);
  assert.match(client, /try \{[\s\S]*localStorage[\s\S]*\} catch/);
  assert.match(client, /sm:hidden/);
  assert.match(client, /aria-expanded=\{filtersOpen\}/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /abortRef\.current\?\.abort\(\)/);
  const card = read("src/components/explorar-modelos/ModelResultCard.tsx");
  assert.match(card, /min-w-0/);
  assert.match(card, /aspect-\[4\/3\]/);
});

test("API: pasa la señal de cancelación del request al servicio y sigue sin exponer credenciales", () => {
  const route = read("src/app/api/model-search/route.ts");
  assert.match(route, /signal: request\.signal/);
  const script = read("scripts/verify-model-search.mjs");
  assert.doesNotMatch(script, /console\.log\([^)]*(API_KEY|ACCESS_TOKEN|apiKey|accessToken|process\.env)/);
});

test("fuentes: la metadata del cliente coincide con los providers registrados", () => {
  const registered = load("src/lib/model-search/registry.ts").createDefaultProviders().map((p) => p.id).sort();
  assert.deepEqual([...sourcesMeta.MODEL_SOURCE_IDS].sort(), registered);
});
