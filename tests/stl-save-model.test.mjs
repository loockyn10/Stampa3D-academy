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
const payloadMod = load("src/lib/stl/model-payload.ts", { "@/lib/stl/library": lib });
const { saveStlModel } = load("src/lib/stl/save-model.ts", { "@/lib/stl/model-payload": payloadMod });

/** Supabase falso que registra exactamente lo que recibe cada tabla. */
function fakeSupabase({ failVariant = null, failModel = null, existingSlugs = [], failDelete = false, uniqueClashOnce = false } = {}) {
  const calls = [];
  let clashed = false;
  return {
    calls,
    from(table) {
      const call = { table, op: "select", payload: null, eq: null, like: null };
      calls.push(call);
      const b = {
        insert(rows) { call.op = "insert"; call.payload = rows; return b; },
        update(row) { call.op = "update"; call.payload = row; return b; },
        delete() { call.op = "delete"; return b; },
        eq(k, v) { call.eq = [k, v]; return b; },
        like(k, v) { call.like = [k, v]; return b; },
        select() { return b; },
        async single() {
          if (table === "stl_models" && call.op === "insert") {
            if (failModel) return { data: null, error: { message: failModel } };
            if (uniqueClashOnce && !clashed) { clashed = true; return { data: null, error: { code: "23505", message: "duplicate key" } }; }
          }
          if (table === "stl_variants" && failVariant) return { data: null, error: { message: failVariant } };
          return { data: { id: table === "stl_models" ? "model-1" : "variant-1" }, error: null };
        },
        then(resolve) {
          if (table === "stl_models" && call.op === "select") return resolve({ data: existingSlugs.map((slug) => ({ slug })), error: null });
          if (call.op === "delete") return resolve({ error: failDelete ? { message: "no delete" } : null });
          return resolve({ error: null });
        },
      };
      return b;
    },
  };
}

const values = (extra = {}) => ({
  title: "PIKACHU FLEXIBLE", description: "", difficulty: "beginner", estimated_print_time: "",
  material_type: "", thumbnail_url: "", is_active: true, category_id: "", ...extra,
});
const modelWrites = (sb) => sb.calls.filter((c) => c.table === "stl_models" && (c.op === "insert" || c.op === "update"));

// ------------------------------------------------------------ MODELO
test("alta: stl_models recibe name = título, title compatible y slug (nunca null)", async () => {
  const sb = fakeSupabase();
  const result = await saveStlModel(sb, { values: values(), fileUrl: "" });
  assert.equal(result.ok, true);
  const [call] = modelWrites(sb);
  assert.equal(call.op, "insert");
  assert.equal(call.payload.length, 1);
  const row = call.payload[0];
  assert.equal(row.name, "PIKACHU FLEXIBLE");
  assert.equal(row.title, "PIKACHU FLEXIBLE");
  assert.equal(row.slug, "pikachu-flexible");
  assert.equal(row.sort_order, 0);
  assert.equal(row.category_id, null);
  assert.ok(row.name && row.slug);
});

test("alta: el título se normaliza con trim", async () => {
  const sb = fakeSupabase();
  await saveStlModel(sb, { values: values({ title: "   Dragón  " }), fileUrl: "" });
  const row = modelWrites(sb)[0].payload[0];
  assert.equal(row.name, "Dragón");
  assert.equal(row.slug, "dragon");
});

test("alta: título vacío o en blanco se rechaza SIN llamar a Supabase", async () => {
  for (const title of ["", "   ", "\n\t"]) {
    const sb = fakeSupabase();
    const result = await saveStlModel(sb, { values: values({ title }), fileUrl: "storage://stl-files/x.stl" });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "validation");
    assert.equal(sb.calls.length, 0, `sin llamadas para ${JSON.stringify(title)}`);
  }
});

test("slug: colisión existente -> pikachu-flexible-2 (y -3 si también existe)", async () => {
  let sb = fakeSupabase({ existingSlugs: ["pikachu-flexible"] });
  await saveStlModel(sb, { values: values(), fileUrl: "" });
  assert.equal(modelWrites(sb)[0].payload[0].slug, "pikachu-flexible-2");
  sb = fakeSupabase({ existingSlugs: ["pikachu-flexible", "pikachu-flexible-2"] });
  await saveStlModel(sb, { values: values(), fileUrl: "" });
  assert.equal(modelWrites(sb)[0].payload[0].slug, "pikachu-flexible-3");
});

test("slug: acentos normalizados y fallback si el título no tiene caracteres válidos", () => {
  assert.equal(payloadMod.buildStlModelSlug("Dragón Ñandú"), "dragon-nandu");
  assert.equal(payloadMod.buildStlModelSlug("¡¡¡"), "modelo");
});

test("slug: si la DB responde unique violation (carrera) reintenta", async () => {
  const sb = fakeSupabase({ uniqueClashOnce: true });
  const result = await saveStlModel(sb, { values: values(), fileUrl: "" });
  assert.equal(result.ok, true);
  assert.equal(modelWrites(sb).length, 2);
});

test("edición: el update lleva name y no cambia el slug", async () => {
  const sb = fakeSupabase();
  const result = await saveStlModel(sb, { modelId: "m9", values: values({ title: "Nuevo" }), fileUrl: "" });
  assert.equal(result.ok, true);
  const [call] = modelWrites(sb);
  assert.equal(call.op, "update");
  assert.deepEqual(call.eq, ["id", "m9"]);
  assert.equal(call.payload.name, "Nuevo");
  assert.equal("slug" in call.payload, false);
  assert.equal(sb.calls.some((c) => c.like), false);
});

// ------------------------------------------------------------ VARIANTE
test("primera variante: model_id, name (= título del modelo), title y file_url", async () => {
  const sb = fakeSupabase();
  const result = await saveStlModel(sb, { values: values(), fileUrl: "storage://stl-files/stl/new/a.3mf" });
  assert.deepEqual([result.ok, result.modelId, result.variantId], [true, "model-1", "variant-1"]);
  const variant = sb.calls.find((c) => c.table === "stl_variants");
  assert.equal(variant.op, "insert");
  const row = variant.payload[0];
  assert.equal(row.model_id, "model-1");
  assert.equal(row.name, "PIKACHU FLEXIBLE");
  assert.equal(row.title, "PIKACHU FLEXIBLE");
  assert.equal(row.file_url, "storage://stl-files/stl/new/a.3mf");
});

test("solo se envían columnas que existen en el schema real", () => {
  const realVariant = new Set(["id", "model_id", "name", "description", "thumbnail_url", "file_url", "material_recommended", "estimated_print_time_minutes", "estimated_weight_grams", "difficulty", "download_count", "is_active", "sort_order", "created_at", "updated_at", "title", "material_type", "color", "print_settings"]);
  const realModel = new Set(["id", "category_id", "name", "slug", "description", "thumbnail_url", "is_active", "sort_order", "created_at", "updated_at", "title", "difficulty", "estimated_print_time", "material_type"]);
  const v1 = payloadMod.buildStlVariantPayload("m1", values(), "storage://x.stl");
  const v2 = payloadMod.buildStlVariantManagerPayload("m1", { title: "Azul", file_url: "storage://x.stl", is_active: true });
  for (const key of [...Object.keys(v1), ...Object.keys(v2)]) assert.ok(realVariant.has(key), `stl_variants.${key}`);
  const m = { ...payloadMod.buildStlModelPayload(values()), slug: "x", sort_order: 0 };
  for (const key of Object.keys(m)) assert.ok(realModel.has(key), `stl_models.${key}`);
});

test("variante: faltantes NOT NULL se rechazan antes de la DB", () => {
  assert.throws(() => payloadMod.buildStlVariantPayload("", values(), "storage://x.stl"));
  assert.throws(() => payloadMod.buildStlVariantPayload("m1", values({ title: " " }), "storage://x.stl"));
  assert.throws(() => payloadMod.buildStlVariantPayload("m1", values(), ""));
});

test("editor de variantes: el título de la UI es name; nunca vacío; exige archivo", () => {
  const ok = payloadMod.buildStlVariantManagerPayload("m1", { title: "  Azul ", file_url: " storage://x.stl ", is_active: true });
  assert.equal(ok.name, "Azul");
  assert.equal(ok.title, "Azul");
  assert.equal(ok.file_url, "storage://x.stl");
  assert.equal(ok.model_id, "m1");
  assert.throws(() => payloadMod.buildStlVariantManagerPayload("m1", { title: "  ", file_url: "storage://x.stl", is_active: true }));
  assert.throws(() => payloadMod.buildStlVariantManagerPayload("m1", { title: "A", file_url: "", is_active: true }));
  assert.throws(() => payloadMod.buildStlVariantManagerPayload("undefined", { title: "A", file_url: "x", is_active: true }));
  const manager = read("src/components/admin/stl-variants-manager.tsx");
  assert.match(manager, /buildStlVariantManagerPayload\(/);
  assert.doesNotMatch(manager, /const payload = \{/, "el manager no arma el payload a mano");
});

// ------------------------------------------------------------ ERRORES / ORFANOS
test("error de variante en alta: se informa, se retira el modelo recién creado y no hay éxito", async () => {
  const sb = fakeSupabase({ failVariant: "boom" });
  const result = await saveStlModel(sb, { values: values(), fileUrl: "storage://stl-files/a.stl" });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "variant");
  assert.match(result.message, /boom/);
  assert.equal(result.orphanModelId, undefined);
  const del = sb.calls.find((c) => c.op === "delete");
  assert.deepEqual([del.table, del.eq], ["stl_models", ["id", "model-1"]]);
});

test("error de variante y cleanup imposible: se documenta el modelo huérfano", async () => {
  const sb = fakeSupabase({ failVariant: "boom", failDelete: true });
  const result = await saveStlModel(sb, { values: values(), fileUrl: "storage://stl-files/a.stl" });
  assert.equal(result.ok, false);
  assert.equal(result.orphanModelId, "model-1");
  assert.match(result.message, /quedó creado sin archivo/);
});

test("error de variante en edición: nunca borra el modelo existente", async () => {
  const sb = fakeSupabase({ failVariant: "boom" });
  const result = await saveStlModel(sb, { modelId: "m9", values: values(), fileUrl: "storage://stl-files/a.stl" });
  assert.equal(result.ok, false);
  assert.equal(sb.calls.some((c) => c.op === "delete"), false);
});

test("error del insert del modelo se propaga y no se intenta la variante", async () => {
  const sb = fakeSupabase({ failModel: "db down" });
  const result = await saveStlModel(sb, { values: values(), fileUrl: "storage://stl-files/a.stl" });
  assert.deepEqual([result.ok, result.stage, result.message], [false, "model", "db down"]);
  assert.equal(sb.calls.some((c) => c.table === "stl_variants"), false);
});

// ------------------------------------------------------------ CÓDIGO REAL
test("el formulario delega el guardado en saveStlModel y no redirige cuando falla", () => {
  const form = read("src/components/admin/stl-model-form.tsx");
  assert.match(form, /saveStlModel\(supabase,/);
  assert.doesNotMatch(form, /\.insert\(/);
  assert.doesNotMatch(form, /\.update\(/);
  const afterFailure = form.slice(form.indexOf("if (!result.ok)"), form.indexOf("setVariantId(result.variantId)"));
  assert.match(afterFailure, /return;/);
  assert.doesNotMatch(afterFailure, /router\.push/);
});

test("todos los writes de stl_models / stl_variants en src pasan por los payloads canónicos", () => {
  const writes = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const src = read(path.relative(root, full)).replace(/\s+/g, " ");
        if (/from\(["']stl_(models|variants)["']\) ?\.(insert|upsert|update)/.test(src)) writes.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(path.join(root, "src"));
  assert.deepEqual(writes.sort(), ["src/components/admin/stl-variants-manager.tsx", "src/lib/stl/save-model.ts"]);
});
