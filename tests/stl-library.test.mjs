import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function load(relativePath, deps = {}) {
  const filename = path.join(root, relativePath);
  const { outputText } = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const m = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (r) => {
      if (r in deps) return deps[r];
      throw new Error(`Unexpected dependency: ${r}`);
    },
    m,
    m.exports,
  );
  return m.exports;
}

const lib = load("src/lib/stl/library.ts");

const group = (id, name, extra = {}) => ({
  id, name, slug: id, description: null, thumbnail_url: null, sort_order: 0, is_active: true, ...extra,
});
const model = (id, category_id, extra = {}) => ({ id, category_id, is_active: true, title: id, ...extra });

// ---------------------------------------------------------------- GRUPOS
test("grupo publicado aparece, no publicado no", () => {
  const groups = [group("a", "Dragones"), group("b", "Oculto", { is_active: false })];
  const models = [model("m1", "a"), model("m2", "b")];
  const names = lib.buildGroupSummaries(groups, models).map((g) => g.name);
  assert.deepEqual(names, ["Dragones"]);
});

test("contador cuenta solo modelos publicados del grupo", () => {
  const groups = [group("a", "Dragones")];
  const models = [model("m1", "a"), model("m2", "a"), model("m3", "a", { is_active: false })];
  const [summary] = lib.buildGroupSummaries(groups, models);
  assert.equal(summary.modelCount, 2);
});

test("un grupo muestra únicamente sus modelos publicados", () => {
  const groups = [group("a", "A"), group("b", "B")];
  const models = [model("m1", "a"), model("m2", "b"), model("m3", "a", { is_active: false })];
  assert.deepEqual(lib.modelsOfGroup(groups, models, "a").map((m) => m.id), ["m1"]);
  assert.deepEqual(lib.modelsOfGroup(groups, models, "b").map((m) => m.id), ["m2"]);
});

test("modelo publicado dentro de grupo no publicado no es visible ni cae en Otros modelos", () => {
  const groups = [group("b", "Oculto", { is_active: false })];
  const models = [model("m1", "b")];
  assert.deepEqual(lib.modelsOfGroup(groups, models, "b"), []);
  assert.deepEqual(lib.modelsOfGroup(groups, models, null), []);
  assert.deepEqual(lib.buildGroupSummaries(groups, models), []);
});

test("modelos existentes sin grupo no desaparecen: grupo virtual Otros modelos", () => {
  const groups = [group("a", "A")];
  const models = [model("m1", "a"), model("m2", null), model("m3", null), model("m4", null, { is_active: false })];
  const summaries = lib.buildGroupSummaries(groups, models);
  const others = summaries.at(-1);
  assert.equal(others.isVirtual, true);
  assert.equal(others.name, "Otros modelos");
  assert.equal(others.modelCount, 2);
  assert.deepEqual(lib.modelsOfGroup(groups, models, null).map((m) => m.id), ["m2", "m3"]);
});

test("sin modelos huérfanos no se inventa el grupo Otros modelos; grupos vacíos no se listan", () => {
  const summaries = lib.buildGroupSummaries([group("a", "A")], []);
  assert.deepEqual(summaries, []);
});

test("los grupos se ordenan por sort_order", () => {
  const groups = [group("a", "A", { sort_order: 2 }), group("b", "B", { sort_order: 1 })];
  const models = [model("m1", "a"), model("m2", "b")];
  assert.deepEqual(lib.buildGroupSummaries(groups, models).map((g) => g.name), ["B", "A"]);
});

// ---------------------------------------------------------------- ROUTING
test("resolución de grupo por slug, por id, virtual y 404", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const groups = [group(id, "Navidad", { slug: "navidad" }), group("22222222-2222-4222-8222-222222222222", "Sin slug", { slug: null }), group("h", "Oculto", { slug: "oculto", is_active: false })];
  assert.equal(lib.resolveGroupSegment(groups, "navidad").name, "Navidad");
  assert.equal(lib.resolveGroupSegment(groups, id).name, "Navidad");
  assert.equal(lib.resolveGroupSegment(groups, "22222222-2222-4222-8222-222222222222").name, "Sin slug");
  assert.equal(lib.resolveGroupSegment(groups, "otros-modelos").isVirtual, true);
  assert.equal(lib.resolveGroupSegment(groups, "no-existe"), null, "grupo inexistente");
  assert.equal(lib.resolveGroupSegment(groups, "oculto"), null, "grupo no publicado");
});

test("hrefs de grupo y modelo; sin slug usa el id", () => {
  assert.equal(lib.groupHref({ id: "x", slug: "navidad" }), "/libreria-stl/navidad");
  assert.equal(lib.groupHref({ id: "x", slug: null }), "/libreria-stl/x");
  assert.equal(lib.groupHref({ id: null, slug: null }), "/libreria-stl/otros-modelos");
  assert.equal(lib.modelHref({ id: "x", slug: "navidad" }, "m1"), "/libreria-stl/navidad/m1");
});

test("slugify", () => {
  assert.equal(lib.slugifyGroupName("  Dragones Articulados Ñandú! "), "dragones-articulados-nandu");
});

// ---------------------------------------------------------------- VIEWER (helpers)
test("el viewer solo soporta .stl alojados en storage", () => {
  assert.equal(lib.getStlViewerSupport("storage://stl-files/a/b.STL").supported, true);
  assert.equal(lib.getStlViewerSupport("storage://stl-files/a/b.3mf").supported, false);
  assert.equal(lib.getStlViewerSupport("storage://stl-files/a/b.zip").supported, false);
  assert.equal(lib.getStlViewerSupport("https://drive.google.com/file/d/1/view").supported, false);
  assert.equal(lib.getStlViewerSupport(null).supported, false);
});

test("dimensiones: sin afirmar unidades", () => {
  assert.equal(lib.formatStlDimensions({ x: 143.2, y: 81.04, z: 52 }), "143 × 81 × 52");
  assert.doesNotMatch(read("src/app/libreria-stl/[group]/[model]/page.tsx"), /\bmm\b/);
  assert.match(read("src/app/libreria-stl/[group]/[model]/page.tsx"), /unidades del archivo/);
});

// ---------------------------------------------------------------- API /api/stl/preview (comportamiento)
function loadPreviewRoute({ access, rows, signed = { data: { signedUrl: "https://signed.example/x?token=t" }, error: null } }) {
  const signCalls = [];
  const queryBuilder = (table) => {
    const filters = {};
    const b = {
      select: () => b,
      eq: (k, v) => { filters[k] = v; return b; },
      maybeSingle: async () => ({ data: rows[table]?.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null }),
    };
    return b;
  };
  const route = load("src/app/api/stl/preview/route.ts", {
    "next/server": {
      NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers }) },
    },
    "@/utils/supabase/server": { createClient: async () => ({ from: queryBuilder }) },
    "@supabase/supabase-js": {
      createClient: () => ({
        storage: { from: (bucket) => ({ createSignedUrl: async (p, ttl) => { signCalls.push({ bucket, p, ttl }); return signed; } }) },
      }),
    },
    "@/lib/storage": { parseStorageReference: (v) => { if (!v?.startsWith("storage://")) return null; const r = v.slice(10); const i = r.indexOf("/"); return { bucket: r.slice(0, i), path: r.slice(i + 1) }; } },
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access }) },
    "@/lib/stl/library": lib,
  });
  return { POST: route.POST, signCalls };
}

const req = (body) => ({ json: async () => body });
const member = { authenticated: true, userId: "u1", capabilities: { downloadStl: true, viewInactiveContent: false } };
const baseRows = () => ({
  stl_variants: [
    { id: "v1", model_id: "m1", file_url: "storage://stl-files/stl/m1/a.stl", is_active: true },
    { id: "v3mf", model_id: "m1", file_url: "storage://stl-files/stl/m1/a.3mf", is_active: true },
    { id: "vext", model_id: "m1", file_url: "https://drive.example/x.stl", is_active: true },
    { id: "vhidden", model_id: "m2", file_url: "storage://stl-files/stl/m2/a.stl", is_active: true },
    { id: "vingroup", model_id: "m3", file_url: "storage://stl-files/stl/m3/a.stl", is_active: true },
  ],
  stl_models: [
    { id: "m1", is_active: true, category_id: null },
    { id: "m2", is_active: false, category_id: null },
    { id: "m3", is_active: true, category_id: "gOff" },
  ],
  stl_categories: [{ id: "gOff", is_active: false }],
});
const OLD_ENV = { ...process.env };
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

test("preview: usuario autorizado recibe URL firmada corta, sin path interno", async () => {
  const { POST, signCalls } = loadPreviewRoute({ access: member, rows: baseRows() });
  const res = await POST(req({ variantId: "v1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body), ["url"]);
  assert.equal(signCalls[0].ttl <= 300, true);
  assert.equal(signCalls[0].bucket, "stl-files");
  assert.doesNotMatch(JSON.stringify(res.body), /stl-files|service-role-secret/);
});

test("preview: sin sesión 401 y sin capability 403 (no se firma nada)", async () => {
  let r = loadPreviewRoute({ access: { authenticated: false, userId: null, capabilities: {} }, rows: baseRows() });
  assert.equal((await r.POST(req({ variantId: "v1" }))).status, 401);
  r = loadPreviewRoute({ access: { ...member, capabilities: { downloadStl: false } }, rows: baseRows() });
  assert.equal((await r.POST(req({ variantId: "v1" }))).status, 403);
  assert.equal(r.signCalls.length, 0);
});

test("preview: archivo inexistente -> 404, falta variantId -> 400", async () => {
  const { POST } = loadPreviewRoute({ access: member, rows: baseRows() });
  assert.equal((await POST(req({ variantId: "nope" }))).status, 404);
  assert.equal((await POST(req({}))).status, 400);
});

test("preview: modelo o grupo no publicado no sirve archivo a miembros, sí a Admin", async () => {
  let r = loadPreviewRoute({ access: member, rows: baseRows() });
  assert.equal((await r.POST(req({ variantId: "vhidden" }))).status, 404);
  assert.equal((await r.POST(req({ variantId: "vingroup" }))).status, 404);
  assert.equal(r.signCalls.length, 0);
  const admin = { ...member, capabilities: { downloadStl: true, viewInactiveContent: true } };
  r = loadPreviewRoute({ access: admin, rows: baseRows() });
  assert.equal((await r.POST(req({ variantId: "vhidden" }))).status, 200);
});

test("preview: formatos no soportados y URLs externas -> 422 sin firmar", async () => {
  const { POST, signCalls } = loadPreviewRoute({ access: member, rows: baseRows() });
  assert.equal((await POST(req({ variantId: "v3mf" }))).status, 422);
  assert.equal((await POST(req({ variantId: "vext" }))).status, 422);
  assert.equal(signCalls.length, 0);
});

test("preview: fallo al firmar (archivo faltante) -> 404 con code missing", async () => {
  const { POST } = loadPreviewRoute({ access: member, rows: baseRows(), signed: { data: null, error: { message: "Object not found" } } });
  const res = await POST(req({ variantId: "v1" }));
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "missing");
});

process.on("exit", () => Object.assign(process.env, OLD_ENV));

// ---------------------------------------------------------------- Seguridad / performance (estático)
test("service role solo en rutas de servidor, nunca en componentes ni páginas de la Librería", () => {
  const clientFiles = [
    "src/app/libreria-stl/page.tsx",
    "src/app/libreria-stl/[group]/page.tsx",
    "src/app/libreria-stl/[group]/[model]/page.tsx",
    "src/components/stl/StlViewer.tsx",
    "src/components/stl/StlDownloadButton.tsx",
    "src/components/stl/StlModelCard.tsx",
    "src/components/stl/StlGroupCard.tsx",
    "src/lib/stl/queries.ts",
    "src/lib/stl/library.ts",
  ];
  for (const f of clientFiles) assert.doesNotMatch(read(f), /SERVICE_ROLE/i, f);
  assert.match(read("src/app/api/stl/preview/route.ts"), /getCurrentUserAccess/);
});

test("el viewer 3D vive solo en el detalle: ni cards ni listados lo importan", () => {
  for (const f of [
    "src/components/stl/StlModelCard.tsx",
    "src/components/stl/StlGroupCard.tsx",
    "src/app/libreria-stl/page.tsx",
    "src/app/libreria-stl/[group]/page.tsx",
  ]) {
    assert.doesNotMatch(read(f), /StlViewer|from "three|import\("three/, f);
  }
  const detail = read("src/app/libreria-stl/[group]/[model]/page.tsx");
  assert.match(detail, /dynamic\(\(\) => import\("@\/components\/stl\/StlViewer"\)/);
  assert.match(detail, /ssr: false/);
});

test("viewer: obtiene el archivo solo vía /api/stl/preview y maneja errores y cleanup", () => {
  const v = read("src/components/stl/StlViewer.tsx");
  assert.match(v, /fetch\("\/api\/stl\/preview"/);
  assert.doesNotMatch(v, /createSignedUrl|getPublicUrl|storage:\/\//);
  assert.match(v, /Archivo no encontrado/);
  assert.match(v, /Archivo dañado/);
  assert.match(v, /Modelo muy pesado/);
  assert.match(v, /Visor no compatible/);
  for (const call of ["geometry.dispose()", "material.dispose()", "renderer.dispose()", "controls.dispose()", "forceContextLoss()", "abort.abort()"]) {
    assert.ok(v.includes(call), `cleanup ${call}`);
  }
});

// ---------------------------------------------------------------- ADMIN / regresiones
test("admin: grupos con nombre, descripción, portada, orden y publicación; sin hard delete", () => {
  const g = read("src/components/admin/stl-categories-manager.tsx");
  for (const field of ["name", "slug", "description", "thumbnail_url", "sort_order", "is_active"]) assert.match(g, new RegExp(field));
  assert.match(g, /\.insert\(/);
  assert.match(g, /\.update\(/);
  assert.doesNotMatch(g, /\.delete\(/);
  assert.match(g, /FileUploadDropzone/);
});

test("admin: el modelo se asigna a un grupo con Combobox (sin select nativo) y puede quedar sin grupo", () => {
  const f = read("src/components/admin/stl-model-form.tsx");
  assert.match(f, /<Combobox/);
  assert.doesNotMatch(f, /name="category_id"/);
  assert.match(f, /category_id: formData\.category_id[\s\S]*: null/);
  assert.match(f, /Sin grupo/);
  assert.match(read("src/components/admin/stl-models-table.tsx"), /Sin grupo/);
});

test("regresión: la descarga conserva su contrato y la página usa el mismo botón autorizado", () => {
  const dl = read("src/app/api/stl/download/route.ts");
  assert.match(dl, /capabilities\.downloadStl/);
  assert.match(dl, /createSignedUrl\(parsedRef\.path, 60, \{ download: true \}\)/);
  const btn = read("src/components/stl/StlDownloadButton.tsx");
  assert.match(btn, /\/api\/stl\/download/);
  assert.match(btn, /stl_downloads/);
  assert.match(read("src/app/libreria-stl/[group]/[model]/page.tsx"), /StlDownloadButton/);
});

test("regresión: la Librería sigue leyendo stl_models / stl_variants / stl_categories (sin tablas nuevas)", () => {
  const q = read("src/lib/stl/queries.ts");
  assert.match(q, /stl_categories/);
  assert.match(q, /stl_models/);
  assert.match(q, /stl_variants/);
  assert.match(q, /\.eq\("is_active", true\)/);
  assert.equal(fs.readdirSync(path.join(root, "supabase/migrations")).some((f) => /stl_groups/.test(f)), false);
});
