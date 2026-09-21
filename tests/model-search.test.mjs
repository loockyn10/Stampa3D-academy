import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

// Loader mínimo para módulos TS que se importan entre sí (`@/…` y rutas relativas).
function createLoader() {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
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
const mmf = load("src/lib/model-search/providers/myminifactory.ts");
const tv = load("src/lib/model-search/providers/thingiverse.ts");
const sanitize = load("src/lib/model-search/sanitize.ts");
const license = load("src/lib/model-search/license.ts");
const params = load("src/lib/model-search/params.ts");
const service = load("src/lib/model-search/service.ts");
const cache = load("src/lib/model-search/cache.ts");
const rateLimit = load("src/lib/model-search/rate-limit.ts");
const calculatorLink = load("src/lib/model-search/calculator-link.ts");

const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function mmfItem(overrides = {}) {
  return {
    id: 4242,
    url: "https://www.myminifactory.com/object/3d-print-dragon-4242",
    name: "Dragón articulado",
    designer: { username: "dragonmaker", name: "Dragon Maker", profile_url: "https://www.myminifactory.com/users/dragonmaker" },
    images: [
      { is_primary: false, thumbnail: { url: "https://cdn.myminifactory.com/other.jpg" } },
      { is_primary: true, thumbnail: { url: "https://cdn.myminifactory.com/thumb.jpg" } },
    ],
    likes: 120,
    views: 3400,
    published_at: "2025-03-01T10:00:00.000Z",
    license: "Attribution",
    licenses: [
      { type: "mention", value: true },
      { type: "remix", value: true },
      { type: "commercial-use", value: true },
      { type: "store", value: false },
    ],
    files: [{ filename: "dragon.STL" }, { filename: "notes.txt" }],
    ...overrides,
  };
}

function tvItem(overrides = {}) {
  return {
    id: 99,
    name: "Soporte auriculares",
    public_url: "https://www.thingiverse.com/thing:99",
    thumbnail: "https://cdn.thingiverse.com/renders/aa/thumb.jpg",
    creator: { name: "maker", public_url: "https://www.thingiverse.com/maker" },
    like_count: 10,
    download_count: 500,
    view_count: 900,
    added: "2024-01-01T00:00:00+00:00",
    license: "Creative Commons - Attribution",
    allows_derivatives: true,
    is_nsfw: false,
    ...overrides,
  };
}

const filters = { freeOnly: false, commercial: "any", sort: "relevance" };

function result(source, id, extra = {}) {
  return {
    source,
    externalId: String(id),
    title: `${source}-${id}`,
    authorName: null,
    authorUrl: null,
    thumbnailUrl: null,
    originalUrl: `https://www.${source}.com/${id}`,
    isFree: true,
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

function fakeProvider(id, behavior, { enabled = true } = {}) {
  return {
    id,
    label: id,
    isEnabled: () => enabled,
    getCapabilities: () => ({ sorts: ["relevance", "popular", "newest"], maxPerPage: 30 }),
    health: async () => ({ status: enabled ? "ok" : "disabled" }),
    search: behavior,
  };
}

const okPage = (results, hasMore = false) => async () => ({ results, total: results.length, hasMore });
const request = (extra = {}) => ({ query: "dragon", sources: null, filters, cursor: {}, ...extra });
const freshDeps = (providers, extra = {}) => ({ providers, cache: cache.createTtlCache(60_000, 50), timeoutMs: 60, ...extra });

// ---------- PROVIDER CORE ----------

test("1. MyMiniFactory item se normaliza al DTO común", () => {
  const dto = mmf.normalizeMyMiniFactoryItem(mmfItem());
  assert.equal(dto.source, "myminifactory");
  assert.equal(dto.externalId, "4242");
  assert.equal(dto.title, "Dragón articulado");
  assert.equal(dto.authorName, "Dragon Maker");
  assert.equal(dto.authorUrl, "https://www.myminifactory.com/users/dragonmaker");
  assert.equal(dto.thumbnailUrl, "https://cdn.myminifactory.com/thumb.jpg");
  assert.equal(dto.originalUrl, "https://www.myminifactory.com/object/3d-print-dragon-4242");
  assert.equal(dto.isFree, true);
  assert.equal(dto.likes, 120);
  assert.equal(dto.views, 3400);
  assert.equal(dto.downloads, null);
  assert.equal(dto.rating, null);
  assert.equal(dto.publishedAt, "2025-03-01T10:00:00.000Z");
  assert.deepEqual(dto.fileFormats, ["stl"]);
});

test("2. licencia MMF con commercial-use=true => allowed", () => {
  const dto = mmf.normalizeMyMiniFactoryItem(mmfItem());
  assert.equal(dto.license.commercialUse, "allowed");
  assert.equal(dto.license.attributionRequired, true);
  assert.equal(dto.license.remixAllowed, true);
});

test("3. licencia MMF con commercial-use=false => prohibited", () => {
  const dto = mmf.normalizeMyMiniFactoryItem(
    mmfItem({ licenses: [{ type: "commercial-use", value: false }, { type: "mention", value: false }] }),
  );
  assert.equal(dto.license.commercialUse, "prohibited");
  assert.equal(dto.license.attributionRequired, false);
});

test("4. sin metadata de licencia => unknown (gratis no implica uso comercial)", () => {
  const dto = mmf.normalizeMyMiniFactoryItem(mmfItem({ licenses: undefined, license: undefined }));
  assert.equal(dto.license.commercialUse, "unknown");
  assert.equal(dto.license.attributionRequired, "unknown");
  assert.equal(dto.isFree, null);

  const freeButNonCommercial = mmf.normalizeMyMiniFactoryItem(
    mmfItem({ licenses: [{ type: "store", value: false }, { type: "commercial-use", value: false }] }),
  );
  assert.equal(freeButNonCommercial.isFree, true);
  assert.equal(freeButNonCommercial.license.commercialUse, "prohibited");

  const paid = mmf.normalizeMyMiniFactoryItem(mmfItem({ licenses: [{ type: "store", value: true }] }));
  assert.equal(paid.isFree, false);
  assert.equal(paid.license.commercialUse, "unknown");
});

test("5. resultados externos malformados se descartan sin romper", () => {
  for (const bad of [null, undefined, "x", 12, [], {}, mmfItem({ id: undefined }), mmfItem({ name: "" }), mmfItem({ url: undefined })]) {
    assert.equal(mmf.normalizeMyMiniFactoryItem(bad), null);
  }
  const dto = mmf.normalizeMyMiniFactoryItem(mmfItem({ likes: -3, views: "many", images: "nope", designer: "x", published_at: "not-a-date", licenses: "bad" }));
  assert.equal(dto.likes, null);
  assert.equal(dto.views, null);
  assert.equal(dto.thumbnailUrl, null);
  assert.equal(dto.authorName, null);
  assert.equal(dto.publishedAt, null);
  assert.equal(dto.license.commercialUse, "unknown");
});

test("MMF provider: pide /api/v2/search con API key server-side y filtros nativos", async () => {
  let calledUrl = "";
  const provider = mmf.createMyMiniFactoryProvider({
    apiKey: () => "SECRET-MMF-KEY",
    fetch: async (url) => {
      calledUrl = url;
      return new Response(JSON.stringify({ total_count: 40, items: [mmfItem(), { broken: true }] }), { status: 200 });
    },
  });
  const page = await provider.search({
    query: "dragon",
    filters: { freeOnly: false, commercial: "allowed", sort: "popular" },
    page: 2,
    perPage: 12,
    signal: new AbortController().signal,
  });
  const url = new URL(calledUrl);
  assert.equal(url.origin + url.pathname, "https://www.myminifactory.com/api/v2/search");
  assert.equal(url.searchParams.get("q"), "dragon");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "12");
  assert.equal(url.searchParams.get("sort"), "popularity");
  assert.equal(url.searchParams.get("commercial_use"), "1");
  assert.equal(url.searchParams.get("key"), "SECRET-MMF-KEY");
  assert.equal(page.results.length, 1);
  assert.equal(page.hasMore, true);
  assert.doesNotMatch(JSON.stringify(page), /SECRET-MMF-KEY/);
});

test("MMF provider: sin API key queda disabled", async () => {
  const provider = mmf.createMyMiniFactoryProvider({ apiKey: () => undefined });
  assert.equal(provider.isEnabled(), false);
  assert.deepEqual(await provider.health(), { status: "disabled" });
});

test("Thingiverse: normalización, licencias explícitas y NSFW excluido", () => {
  const dto = tv.normalizeThingiverseItem(tvItem());
  assert.equal(dto.source, "thingiverse");
  assert.equal(dto.originalUrl, "https://www.thingiverse.com/thing:99");
  assert.equal(dto.authorName, "maker");
  assert.equal(dto.likes, 10);
  assert.equal(dto.downloads, 500);
  assert.equal(dto.license.commercialUse, "allowed");
  assert.equal(dto.license.attributionRequired, true);

  const nonCommercial = tv.normalizeThingiverseItem(tvItem({ license: "Creative Commons - Attribution - Non-Commercial - Share Alike" }));
  assert.equal(nonCommercial.license.commercialUse, "prohibited");

  const unknownLicense = tv.normalizeThingiverseItem(tvItem({ license: "Licencia rara 3000" }));
  assert.equal(unknownLicense.license.commercialUse, "unknown");
  assert.equal(unknownLicense.license.name, "Licencia rara 3000");
  assert.equal(tv.normalizeThingiverseItem(tvItem({ license: undefined })).license.commercialUse, "unknown");

  assert.equal(tv.normalizeThingiverseItem(tvItem({ is_nsfw: true })), null);
  assert.equal(tv.normalizeThingiverseItem(tvItem({ public_url: "https://evil.example/thing:99" })), null);
});

test("Thingiverse provider: token por header Bearer (nunca en la URL) y disabled sin token", async () => {
  let calledUrl = "";
  let calledInit;
  const provider = tv.createThingiverseProvider({
    accessToken: () => "SECRET-TV-TOKEN",
    fetch: async (url, init) => {
      calledUrl = url;
      calledInit = init;
      return new Response(JSON.stringify({ total: 5, hits: [tvItem()] }), { status: 200 });
    },
  });
  const page = await provider.search({ query: "soporte auriculares", filters: { ...filters, sort: "newest" }, page: 1, perPage: 12, signal: new AbortController().signal });
  assert.match(calledUrl, /^https:\/\/api\.thingiverse\.com\/search\/soporte%20auriculares\?/);
  assert.equal(new URL(calledUrl).searchParams.get("type"), "things");
  assert.equal(new URL(calledUrl).searchParams.get("sort"), "newest");
  assert.doesNotMatch(calledUrl, /SECRET-TV-TOKEN/);
  assert.equal(calledInit.headers.Authorization, "Bearer SECRET-TV-TOKEN");
  assert.equal(page.results.length, 1);

  const disabled = tv.createThingiverseProvider({ accessToken: () => undefined });
  assert.equal(disabled.isEnabled(), false);
  assert.deepEqual(await disabled.health(), { status: "disabled" });
});

// ---------- ORCHESTRATOR ----------

test("6. provider A ok", async () => {
  const response = await service.searchModels(request(), freshDeps([fakeProvider("myminifactory", okPage([result("myminifactory", 1)]))]));
  assert.equal(response.results.length, 1);
  assert.deepEqual(response.sources, [{ id: "myminifactory", status: "ok", count: 1, hasMore: false }]);
});

test("7. provider B falla: resultados parciales sin tirar la búsqueda", async () => {
  const response = await service.searchModels(
    request(),
    freshDeps([
      fakeProvider("myminifactory", okPage([result("myminifactory", 1)])),
      fakeProvider("thingiverse", async () => { throw new Error("boom"); }),
    ]),
  );
  assert.equal(response.results.length, 1);
  assert.equal(response.sources.find((s) => s.id === "thingiverse").status, "error");
  assert.equal(response.sources.find((s) => s.id === "myminifactory").status, "ok");
});

test("8. timeout aislado: el provider lento no bloquea a los demás", async () => {
  const started = Date.now();
  const response = await service.searchModels(
    request(),
    freshDeps(
      [
        fakeProvider("myminifactory", okPage([result("myminifactory", 1)])),
        fakeProvider("thingiverse", () => new Promise(() => {})), // ignora la señal y nunca responde
      ],
      { timeoutMs: 40 },
    ),
  );
  assert.ok(Date.now() - started < 1000);
  assert.equal(response.sources.find((s) => s.id === "thingiverse").status, "timeout");
  assert.equal(response.results.length, 1);
});

test("9. todos los providers fallan: respuesta válida sin resultados", async () => {
  const response = await service.searchModels(
    request(),
    freshDeps([
      fakeProvider("myminifactory", async () => { throw new Error("x"); }),
      fakeProvider("thingiverse", () => new Promise(() => {})),
    ], { timeoutMs: 30 }),
  );
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.sources.map((s) => s.status).sort(), ["error", "timeout"]);
  assert.equal(response.nextCursor, null);
});

test("10. provider disabled no se consulta y no rompe la búsqueda", async () => {
  let called = false;
  const response = await service.searchModels(
    request(),
    freshDeps([
      fakeProvider("myminifactory", okPage([result("myminifactory", 1)])),
      fakeProvider("thingiverse", async () => { called = true; return { results: [], total: 0, hasMore: false }; }, { enabled: false }),
    ]),
  );
  assert.equal(called, false);
  assert.equal(response.sources.find((s) => s.id === "thingiverse").status, "disabled");
  assert.equal(response.results.length, 1);
});

test("11. merge round-robin entre fuentes", async () => {
  const response = await service.searchModels(
    request(),
    freshDeps([
      fakeProvider("myminifactory", okPage([result("myminifactory", 1), result("myminifactory", 2), result("myminifactory", 3)])),
      fakeProvider("thingiverse", okPage([result("thingiverse", 1), result("thingiverse", 2)])),
    ]),
  );
  assert.deepEqual(response.results.map((r) => r.title), [
    "myminifactory-1", "thingiverse-1", "myminifactory-2", "thingiverse-2", "myminifactory-3",
  ]);
});

test("filtros gratis/uso comercial se aplican sobre el DTO normalizado; sources limita providers", async () => {
  const providers = [
    fakeProvider("myminifactory", okPage([
      result("myminifactory", 1, { isFree: false }),
      result("myminifactory", 2, { license: { name: null, url: null, commercialUse: "allowed", attributionRequired: true, remixAllowed: null } }),
      result("myminifactory", 3),
    ])),
    fakeProvider("thingiverse", okPage([result("thingiverse", 1)])),
  ];
  const free = await service.searchModels(request({ filters: { ...filters, freeOnly: true } }), freshDeps(providers));
  assert.ok(free.results.every((r) => r.isFree === true));
  assert.equal(free.results.length, 3);

  const allowed = await service.searchModels(request({ filters: { ...filters, commercial: "allowed" } }), freshDeps(providers));
  assert.deepEqual(allowed.results.map((r) => r.externalId), ["2"]);

  const only = await service.searchModels(request({ sources: ["thingiverse"] }), freshDeps(providers));
  assert.deepEqual(only.sources.map((s) => s.id), ["thingiverse"]);
});

test("cache de páginas por provider: mismo query/filtros/página no repite request externa", async () => {
  let calls = 0;
  const provider = fakeProvider("myminifactory", async () => { calls += 1; return { results: [result("myminifactory", 1)], total: 1, hasMore: false }; });
  const deps = freshDeps([provider]);
  await service.searchModels(request({ query: "Dragon" }), deps);
  await service.searchModels(request({ query: "dragon" }), deps);
  assert.equal(calls, 1);
  await service.searchModels(request({ filters: { ...filters, sort: "newest" } }), deps);
  await service.searchModels(request({ cursor: { myminifactory: 2 } }), deps);
  assert.equal(calls, 3);
});

test("cache TTL expira y los errores no se cachean", async () => {
  const ttl = cache.createTtlCache(1000, 2);
  ttl.set("a", 1, 0);
  assert.equal(ttl.get("a", 500), 1);
  assert.equal(ttl.get("a", 1500), undefined);
  ttl.set("x", 1, 0); ttl.set("y", 2, 0); ttl.set("z", 3, 0);
  assert.equal(ttl.size(), 2);

  let attempts = 0;
  const flaky = fakeProvider("myminifactory", async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary");
    return { results: [result("myminifactory", 1)], total: 1, hasMore: false };
  });
  const deps = freshDeps([flaky]);
  const first = await service.searchModels(request(), deps);
  const second = await service.searchModels(request(), deps);
  assert.equal(first.sources[0].status, "error");
  assert.equal(second.sources[0].status, "ok");
});

test("cursor por provider: continúa solo los que tienen más páginas", async () => {
  const seen = [];
  const providers = [
    fakeProvider("myminifactory", async (input) => { seen.push(["mmf", input.page]); return { results: [result("myminifactory", input.page)], total: 50, hasMore: true }; }),
    fakeProvider("thingiverse", async (input) => { seen.push(["tv", input.page]); return { results: [result("thingiverse", input.page)], total: 1, hasMore: false }; }),
  ];
  const first = await service.searchModels(request(), freshDeps(providers));
  assert.deepEqual(params.decodeCursor(first.nextCursor), { myminifactory: 2 });
  await service.searchModels(request({ cursor: params.decodeCursor(first.nextCursor) }), freshDeps(providers));
  assert.deepEqual(seen.slice(2), [["mmf", 2], ["tv", 1]]);
});

// ---------- API (validación de parámetros) ----------

const parse = (query) => params.parseModelSearchParams(new URLSearchParams(query));

test("12. q vacío o ausente => missing_query", () => {
  assert.deepEqual(parse(""), { ok: false, error: "missing_query" });
  assert.deepEqual(parse("q="), { ok: false, error: "missing_query" });
  assert.deepEqual(parse("q=%20%20%20"), { ok: false, error: "missing_query" });
  assert.deepEqual(parse("q=a"), { ok: false, error: "query_too_short" });
});

test("13. q demasiado largo => query_too_long; se hace trim y colapso de espacios", () => {
  assert.deepEqual(parse(`q=${"a".repeat(101)}`), { ok: false, error: "query_too_long" });
  assert.equal(parse(`q=${"a".repeat(100)}`).ok, true);
  assert.equal(parse("q=%20%20dragón%20%20%20articulado%09").value.query, "dragón articulado");
});

test("14. source inválida => invalid_source (no se aceptan providers ni URLs arbitrarias)", () => {
  for (const sources of ["makerworld", "https://evil.example", "myminifactory,foo", "../etc/passwd", ","]) {
    assert.deepEqual(parse(`q=dragon&sources=${encodeURIComponent(sources)}`), { ok: false, error: "invalid_source" });
  }
  assert.equal(parse("q=dragon&sources=all").value.sources, null);
});

test("15. filtros válidos se aceptan; inválidos se rechazan", () => {
  const ok = parse("q=dragon&sources=thingiverse,myminifactory&free=1&commercial=allowed&sort=popular");
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.sources, ["thingiverse", "myminifactory"]);
  assert.deepEqual(ok.value.filters, { freeOnly: true, commercial: "allowed", sort: "popular" });
  assert.deepEqual(parse("q=dragon&free=maybe"), { ok: false, error: "invalid_filter" });
  assert.deepEqual(parse("q=dragon&commercial=si"), { ok: false, error: "invalid_filter" });
  assert.deepEqual(parse("q=dragon&sort=random"), { ok: false, error: "invalid_filter" });
  assert.deepEqual(parse("q=dragon&cursor=@@@"), { ok: false, error: "invalid_cursor" });
  const cursor = params.encodeCursor({ myminifactory: 3, thingiverse: 2 });
  assert.deepEqual(parse(`q=dragon&cursor=${cursor}`).value.cursor, { myminifactory: 3, thingiverse: 2 });
  const forged = Buffer.from(JSON.stringify({ evil: 1 })).toString("base64url");
  assert.deepEqual(parse(`q=dragon&cursor=${forged}`), { ok: false, error: "invalid_cursor" });
  const huge = Buffer.from(JSON.stringify({ myminifactory: 9999 })).toString("base64url");
  assert.deepEqual(parse(`q=dragon&cursor=${huge}`), { ok: false, error: "invalid_cursor" });
});

test("16. el secret no se expone: ni en la respuesta, ni en el cliente, ni en NEXT_PUBLIC", async () => {
  const provider = mmf.createMyMiniFactoryProvider({
    apiKey: () => "SECRET-MMF-KEY",
    fetch: async () => new Response(JSON.stringify({ total_count: 1, items: [mmfItem()] }), { status: 200 }),
  });
  const response = await service.searchModels(request(), freshDeps([provider]));
  assert.doesNotMatch(JSON.stringify(response), /SECRET-MMF-KEY/);
  assert.deepEqual(service.describeProviders([provider]), [
    { id: "myminifactory", label: "MyMiniFactory", enabled: true, sorts: ["relevance", "popular", "newest"] },
  ]);

  for (const file of ["src/components/explorar-modelos/ExplorarModelosClient.tsx", "src/components/explorar-modelos/ModelResultCard.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /process\.env|MYMINIFACTORY_API_KEY|THINGIVERSE_ACCESS_TOKEN/);
    assert.doesNotMatch(source, /model-search\/(providers|registry|service)/);
  }
  const allSources = ["src/lib/model-search/providers/myminifactory.ts", "src/lib/model-search/providers/thingiverse.ts", "src/app/api/model-search/route.ts"].map(read).join("\n");
  assert.doesNotMatch(allSources, /NEXT_PUBLIC_(MYMINIFACTORY|THINGIVERSE)/);
});

test("rate limiter: excede el máximo por ventana y se libera", () => {
  const limiter = rateLimit.createRateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(limiter.check("ip:1", 0).allowed, true);
  assert.equal(limiter.check("ip:1", 10).allowed, true);
  const blocked = limiter.check("ip:1", 20);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(limiter.check("ip:2", 20).allowed, true);
  assert.equal(limiter.check("ip:1", 1500).allowed, true);
});

// ---------- SECURITY ----------

test("17. URL externa inválida se descarta o se anula", () => {
  const domains = ["myminifactory.com"];
  for (const bad of ["not a url", "", null, 42, "javascript:alert(1)", "data:text/html,x", "//evil.example/x", "https://user:pw@www.myminifactory.com/x"]) {
    assert.equal(sanitize.safeExternalUrl(bad, domains), null);
  }
});

test("18. protocolo no HTTPS se rechaza", () => {
  assert.equal(sanitize.safeExternalUrl("http://www.myminifactory.com/object/1", ["myminifactory.com"]), null);
  assert.equal(sanitize.safeExternalUrl("ftp://www.myminifactory.com/object/1", ["myminifactory.com"]), null);
  assert.equal(mmf.normalizeMyMiniFactoryItem(mmfItem({ url: "http://www.myminifactory.com/object/1" })), null);
  assert.equal(sanitize.safeExternalUrl("https://www.myminifactory.com/object/1", ["myminifactory.com"]), "https://www.myminifactory.com/object/1");
});

test("19. dominio inesperado del provider: se descarta el resultado o la imagen", () => {
  const domains = ["myminifactory.com"];
  assert.equal(sanitize.safeExternalUrl("https://myminifactory.com.evil.example/x", domains), null);
  assert.equal(sanitize.safeExternalUrl("https://evilmyminifactory.com/x", domains), null);
  assert.equal(sanitize.safeExternalUrl("https://cdn.myminifactory.com/x.jpg", domains), "https://cdn.myminifactory.com/x.jpg");
  assert.equal(mmf.normalizeMyMiniFactoryItem(mmfItem({ url: "https://evil.example/object/1" })), null);
  const noThumb = mmf.normalizeMyMiniFactoryItem(mmfItem({ images: [{ is_primary: true, thumbnail: { url: "https://tracker.example/p.gif" } }] }));
  assert.equal(noThumb.thumbnailUrl, null);
  assert.equal(tv.normalizeThingiverseItem(tvItem({ public_url: "https://www.myminifactory.com/object/1" })), null);
});

test("texto externo se sanea (control chars, largo) y la UI no usa dangerouslySetInnerHTML", () => {
  assert.equal(sanitize.cleanText("  a" + String.fromCharCode(0) + "b\n\nc  ", 50), "a b c");
  assert.equal(sanitize.cleanText("x".repeat(500), 20).length, 20);
  assert.equal(sanitize.cleanText(undefined, 10), null);
  for (const file of ["src/components/explorar-modelos/ExplorarModelosClient.tsx", "src/components/explorar-modelos/ModelResultCard.tsx"]) {
    assert.doesNotMatch(read(file), /dangerouslySetInnerHTML/);
  }
});

// ---------- UI / ACCESO ----------

test("20. anonymous puede buscar: página y API públicas en proxy, sin exigir acceso pago", () => {
  const middleware = read("src/utils/supabase/middleware.ts");
  assert.match(middleware, /"\/api\/model-search"/);
  assert.match(middleware, /pathname === '\/explorar-modelos'/);
  const route = read("src/app/api/model-search/route.ts");
  assert.match(route, /ANONYMOUS_MAX_PAGES/);
  assert.match(route, /getCurrentUserAccess/);
  assert.doesNotMatch(route, /has_platform_access|sin-acceso|redirect\(/);
  const layout = read("src/app/main-layout.tsx");
  assert.match(layout, /isExploreModelsRoute/);
});

test("21. free puede buscar: authenticated (no paid) obtiene búsqueda completa", () => {
  const route = read("src/app/api/model-search/route.ts");
  assert.match(route, /const isMember = access\.authenticated === true/);
  assert.match(route, /!isMember && \(filters\.commercial !== "any"/);
  // El acceso pago solo cambia la etiqueta del tier; nunca bloquea la búsqueda.
  assert.match(route, /access\.capabilities\.accessPlatform \? "paid"/);
});

test("22. solo paid ve “Calcular en Stampa” y usa el único motor de la Calculadora", () => {
  const card = read("src/components/explorar-modelos/ModelResultCard.tsx");
  assert.match(card, /\{canCalculate && \(/);
  const client = read("src/components/explorar-modelos/ExplorarModelosClient.tsx");
  assert.match(client, /canCalculate=\{tier === "paid"\}/);
  const link = calculatorLink.buildCalculatorLink({ title: "Soporte auriculares" });
  assert.equal(link, "/calculadora?action=calculate&name=Soporte+auriculares");
  assert.equal(calculatorLink.parseCalculatorPrefillName("  Hola" + String.fromCharCode(0) + "   mundo "), "Hola mundo");
  assert.equal(calculatorLink.parseCalculatorPrefillName(null), null);
  assert.equal(calculatorLink.parseCalculatorPrefillName("x".repeat(500)).length, 120);
  const calculator = read("src/app/calculadora/page.tsx");
  assert.match(calculator, /parseCalculatorPrefillName\(searchParams\.get\("name"\)\)/);
  // No se reimplementa el cálculo ni se asumen peso/tiempo/material.
  assert.deepEqual(Array.from(new URL(link, "https://stampa.test").searchParams.keys()), ["action", "name"]);
});

test("23. Librería STL no se mezcla con Explorar Modelos", () => {
  const files = [
    "src/lib/model-search/service.ts",
    "src/lib/model-search/registry.ts",
    "src/lib/model-search/providers/myminifactory.ts",
    "src/lib/model-search/providers/thingiverse.ts",
    "src/app/api/model-search/route.ts",
    "src/components/explorar-modelos/ExplorarModelosClient.tsx",
  ];
  for (const file of files) assert.doesNotMatch(read(file), /stl_models|stl_variants|stl_categories|libreria-stl|api\/stl/);
  assert.doesNotMatch(read("src/app/libreria-stl/page.tsx"), /model-search|explorar-modelos/);
  const sidebar = read("src/components/layout/sidebar.tsx");
  assert.match(sidebar, /path: "\/libreria-stl", label: "Librería STL"/);
  assert.match(sidebar, /path: "\/explorar-modelos", label: "Explorar Modelos"/);
});

test("Ver modelo abre originalUrl en pestaña nueva con noopener noreferrer; la fuente siempre es visible", () => {
  const card = read("src/components/explorar-modelos/ModelResultCard.tsx");
  assert.match(card, /href=\{result\.originalUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(card, /MODEL_SOURCE_LABELS\[result\.source\]/);
  assert.match(card, /Verificá la licencia en la fuente/);
});
