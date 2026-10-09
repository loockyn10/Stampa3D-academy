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

const payloadMod = load("src/lib/stl/model-payload.ts");
const { saveStlModel } = load("src/lib/stl/save-model.ts", { "@/lib/stl/model-payload": payloadMod });

/** Supabase falso que registra exactamente lo que recibe cada tabla. */
function fakeSupabase({ failVariant = null, failModel = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, op: null, payload: null, eq: null };
      calls.push(call);
      const b = {
        insert(rows) { call.op = "insert"; call.payload = rows; return b; },
        update(row) { call.op = "update"; call.payload = row; return b; },
        eq(k, v) { call.eq = [k, v]; return b; },
        select() { return b; },
        async single() {
          if (table === "stl_models" && failModel) return { data: null, error: { message: failModel } };
          if (table === "stl_variants" && failVariant) return { data: null, error: { message: failVariant } };
          return { data: { id: table === "stl_models" ? "model-1" : "variant-1" }, error: null };
        },
        then(resolve) {
          resolve({ error: table === "stl_models" && failModel ? { message: failModel } : null });
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
const modelCalls = (sb) => sb.calls.filter((c) => c.table === "stl_models");

test("alta: el objeto que recibe stl_models trae name = título (nunca null)", async () => {
  const sb = fakeSupabase();
  const result = await saveStlModel(sb, { values: values(), fileUrl: "" });
  assert.equal(result.ok, true);
  const [call] = modelCalls(sb);
  assert.equal(call.op, "insert");
  assert.equal(call.payload.length, 1);
  assert.equal(call.payload[0].name, "PIKACHU FLEXIBLE");
  assert.equal(call.payload[0].title, "PIKACHU FLEXIBLE");
  assert.equal(call.payload[0].category_id, null);
});

test("alta: el título se normaliza con trim antes del insert", async () => {
  const sb = fakeSupabase();
  await saveStlModel(sb, { values: values({ title: "   Dragón  " }), fileUrl: "" });
  assert.equal(modelCalls(sb)[0].payload[0].name, "Dragón");
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

test("edición: el update también lleva name", async () => {
  const sb = fakeSupabase();
  const result = await saveStlModel(sb, { modelId: "m9", values: values({ title: "Nuevo" }), fileUrl: "" });
  assert.equal(result.ok, true);
  const [call] = modelCalls(sb);
  assert.equal(call.op, "update");
  assert.deepEqual(call.eq, ["id", "m9"]);
  assert.equal(call.payload.name, "Nuevo");
});

test("nunca se envía name null/undefined/vacío en ningún insert/update de stl_models", async () => {
  for (const extra of [{}, { category_id: "g1" }, { description: "x" }]) {
    const sb = fakeSupabase();
    await saveStlModel(sb, { values: values(extra), fileUrl: "storage://stl-files/a.3mf" });
    for (const call of modelCalls(sb)) {
      const rows = Array.isArray(call.payload) ? call.payload : [call.payload];
      for (const row of rows) assert.ok(typeof row.name === "string" && row.name.length > 0);
    }
  }
});

test("variante: se crea con el archivo, sin columna name no confirmada", async () => {
  const sb = fakeSupabase();
  const result = await saveStlModel(sb, { values: values(), fileUrl: "storage://stl-files/stl/new/a.3mf" });
  assert.deepEqual([result.ok, result.modelId, result.variantId], [true, "model-1", "variant-1"]);
  const variant = sb.calls.find((c) => c.table === "stl_variants");
  assert.equal(variant.op, "insert");
  assert.equal(variant.payload[0].model_id, "model-1");
  assert.equal(variant.payload[0].file_url, "storage://stl-files/stl/new/a.3mf");
  assert.equal("name" in variant.payload[0], false);
});

test("error de variante: no se ignora y se informa que el modelo quedó creado", async () => {
  const sb = fakeSupabase({ failVariant: "boom" });
  const result = await saveStlModel(sb, { values: values(), fileUrl: "storage://stl-files/a.stl" });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "variant");
  assert.equal(result.modelId, "model-1");
  assert.match(result.message, /no pude asociar el archivo: boom/);
});

test("error del insert del modelo se propaga y no se intenta la variante", async () => {
  const sb = fakeSupabase({ failModel: "db down" });
  const result = await saveStlModel(sb, { values: values(), fileUrl: "storage://stl-files/a.stl" });
  assert.deepEqual([result.ok, result.stage, result.message], [false, "model", "db down"]);
  assert.equal(sb.calls.some((c) => c.table === "stl_variants"), false);
});

test("el formulario real delega TODO el guardado en saveStlModel (sin otro insert propio)", () => {
  const form = read("src/components/admin/stl-model-form.tsx");
  assert.match(form, /saveStlModel\(supabase,/);
  assert.doesNotMatch(form, /\.insert\(/);
  assert.doesNotMatch(form, /\.update\(/);
  assert.match(form, /values: formData/);
  assert.match(form, /name="title"/); // el input sigue siendo "title" y el helper lo mapea a name
});

test("único camino de alta de stl_models en el repo es save-model.ts", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        if (/from\(["']stl_models["']\)\s*\.(insert|upsert)/.test(src.replace(/\s+/g, " ").replace(/\) \./g, ").")) ) offenders.push(path.relative(root, full));
      }
    }
  };
  walk(path.join(root, "src"));
  assert.deepEqual(offenders.map((f) => f.replace(/\\/g, "/")), ["src/lib/stl/save-model.ts"]);
});
