import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const nodeRequire = createRequire(path.join(root, "package.json"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function load(relativePath, deps = {}) {
  const filename = path.join(root, relativePath);
  const { outputText } = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  });
  const m = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (r) => {
      if (r in deps) return deps[r];
      if (r === "react" || r.startsWith("react/") || r === "lucide-react") return nodeRequire(r);
      throw new Error(`Unexpected dependency: ${r}`);
    },
    m,
    m.exports,
  );
  return m.exports;
}

const lib = load("src/lib/stl/library.ts");
const media = load("src/lib/stl/preview-media.ts");
const parseMod = load("src/lib/stl/parse-model.ts", { "@/lib/stl/library": lib });
const payloadMod = load("src/lib/stl/model-payload.ts", { "@/lib/stl/library": lib });
const saveMod = load("src/lib/stl/save-model.ts", { "@/lib/stl/model-payload": payloadMod });
const recorder = load("src/lib/stl/record-turntable.ts", { "@/lib/stl/preview-media": media });
const service = load("src/lib/stl/preview-service.ts", { "@/lib/stl/library": lib, "@/lib/stl/preview-media": media });
const cycleMod = load("src/lib/stl/preview-cycle.ts", { "@/lib/stl/preview-media": media });
const cardMedia = load("src/components/stl/ModelPreviewCardMedia.tsx", { "@/lib/stl/preview-media": media, "@/lib/stl/preview-cycle": cycleMod });
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const React = nodeRequire("react");

// ---------------------------------------------------------------- CARDS (1, 2, 3, 9)
const render = (props) => renderToStaticMarkup(React.createElement(cardMedia.ModelPreviewCardMedia, { id: "m1", title: "Dragón", ...props }));

test("sin preview_url -> solo thumbnail, sin <video>", () => {
  const html = render({ thumbnailUrl: "https://x/t.jpg", previewUrl: null });
  assert.match(html, /<img[^>]+src="https:\/\/x\/t\.jpg"/);
  assert.doesNotMatch(html, /<video/);
});

test("preview_url null/undefined y sin thumbnail -> placeholder, la card no se rompe", () => {
  for (const previewUrl of [null, undefined]) {
    const html = render({ thumbnailUrl: null, previewUrl });
    assert.doesNotMatch(html, /<video|<img/);
    assert.match(html, /<svg/);
  }
});

test("con preview_url -> hay <video> muted/playsInline/preload none, pero SIN src inicial (no carga nada)", () => {
  const html = render({ thumbnailUrl: "https://x/t.jpg", previewUrl: "https://x/p.webm" });
  assert.match(html, /<video/);
  assert.match(html, /muted/);
  assert.match(html, /playsinline/i);
  assert.match(html, /preload="none"/);
  assert.doesNotMatch(html, /src="https:\/\/x\/p\.webm"/, "no debe pedir el video hasta que corresponda");
  assert.doesNotMatch(html, /autoplay|controls/i);
  assert.match(html, /<img/, "el thumbnail está presente");
});

test("componente: IntersectionObserver, matchMedia reduced-motion, onError y sin Three.js", () => {
  const src = read("src/components/stl/ModelPreviewCardMedia.tsx");
  assert.match(src, /new IntersectionObserver/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /hover: hover\) and \(pointer: fine/);
  assert.match(src, /onEnded=\{onVideoEnded\}/);
  assert.doesNotMatch(src, /^\s+loop\s*$/m, "el ambiental no usa loop infinito: avanza con ended");
  assert.match(src, /onError=\{onVideoError\}/);
  assert.match(src, /\bmuted\b/);
  assert.match(src, /playsInline/);
  assert.match(src, /preload="none"/);
  assert.doesNotMatch(src, /from "three|WebGLRenderer|Model3DViewer/, "la card no monta Three.js");
  assert.doesNotMatch(src, /\bcontrols\b/);
  assert.match(read("src/components/stl/StlModelCard.tsx"), /ModelPreviewCardMedia/);
});

// ---------------------------------------------------------------- GENERACIÓN (10, 11)
const THREE = await import("three");
const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
const display = load("src/lib/stl/model-display.ts", {});

const CUBE_STL = `solid cube
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 10 0 0
  vertex 10 10 0
 endloop
endfacet
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 10 10 0
  vertex 0 10 0
 endloop
endfacet
facet normal 0 0 1
 outer loop
  vertex 0 0 20
  vertex 10 10 20
  vertex 10 0 20
 endloop
endfacet
endsolid cube`;

const loaders = (mf) => ({ stl: () => new STLLoader(), "3mf": () => ({ parse: () => mf }) });

test("STL: parseModel3D + helpers compartidos -> material neutro, centrado y radio consistente", () => {
  const buf = new TextEncoder().encode(CUBE_STL).buffer;
  const parsed = parseMod.parseModel3D("stl", buf, loaders(null));
  const model = display.toObject3D(THREE, parsed);
  const material = display.applyNeutralMaterial(THREE, model);
  assert.equal(model.material, material);
  assert.equal(material.color.getHex(), 0xc8ccd4);
  const measured = display.measureAndCenter(THREE, model);
  assert.ok(measured);
  assert.deepEqual([measured.size.x, measured.size.y, measured.size.z], [10, 10, 20]);
  const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  assert.ok(center.length() < 1e-9, "centrado en el origen");
  const radius = display.boundingRadius(measured.size);
  assert.ok(display.fitDistance(radius, 40, 1.15) > radius, "la cámara queda fuera de la esfera");
});

test("3MF: applyNeutralMaterial (helper del fallback) unifica un Group con varias mallas", () => {
  const group = new THREE.Group();
  const geo = () => new THREE.BoxGeometry(5, 5, 5);
  const a = new THREE.Mesh(geo(), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  const b = new THREE.Mesh(geo(), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
  b.position.set(20, 0, 0);
  group.add(a, b);
  const parsed = parseMod.parseModel3D("3mf", new ArrayBuffer(1), loaders(group));
  const model = display.toObject3D(THREE, parsed);
  const material = display.applyNeutralMaterial(THREE, model);
  assert.equal(a.material, material);
  assert.equal(b.material, material, "materiales propios del 3MF descartados");
  const measured = display.measureAndCenter(THREE, model);
  assert.equal(Math.round(measured.size.x), 25);
});

test("modelo sin volumen -> measureAndCenter devuelve null (la generación falla sin romper el alta)", () => {
  assert.equal(display.measureAndCenter(THREE, new THREE.Group()), null);
});

test("generador: reutiliza prepare-model.ts y model-display.ts (sin duplicar parsing/material/centrado)", () => {
  const src = read("src/lib/stl/generate-preview.ts");
  assert.match(src, /prepareModelForDisplay/);
  assert.match(src, /measureAndCenter/);
  assert.doesNotMatch(src, /MeshStandardMaterial/);
  const prepare = read("src/lib/stl/prepare-model.ts");
  assert.match(prepare, /parseModel3D/);
  assert.match(prepare, /applyNeutralMaterial/);
  assert.match(prepare, /3MFLoader\.js/);
  assert.match(prepare, /STLLoader\.js/);
  const viewer = read("src/components/stl/Model3DViewer.tsx");
  assert.match(viewer, /prepareModelForDisplay/, "el viewer de detalle comparte la preparación");
  assert.match(viewer, /OrbitControls/, "el viewer interactivo del detalle sigue intacto");
  assert.match(viewer, /\/api\/stl\/preview/);
});

// ---------------------------------------------------------------- GRABACIÓN (WebM)
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
function fakeRecorderCtor({ supported = ["video/webm;codecs=vp8"], emptyData = false } = {}) {
  return class FakeRecorder {
    static isTypeSupported(type) { return supported.includes(type); }
    constructor(stream, options) { this.stream = stream; this.options = options; this.state = "inactive"; FakeRecorder.last = this; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      if (!emptyData) this.ondataavailable?.({ data: { size: 1234 } });
      this.onstop?.();
    }
  };
}
const fakeCanvas = () => {
  const stopped = [];
  return { stopped, captureStream: (fps) => ({ fps, getTracks: () => [{ stop: () => stopped.push(1) }] }) };
};

test("recordTurntable: una vuelta completa de 360° a ~24 fps durante 4 s, devuelve chunks WebM", async () => {
  const clock = fakeClock();
  const angles = [];
  const canvas = fakeCanvas();
  const Ctor = fakeRecorderCtor();
  const result = await recorder.recordTurntable({ canvas, MediaRecorderCtor: Ctor, ...clock, renderFrame: (a) => angles.push(a) });
  assert.equal(result.mimeType, "video/webm;codecs=vp8");
  assert.equal(result.chunks.length, 1);
  assert.equal(Ctor.last.options.videoBitsPerSecond, media.PREVIEW_SPEC.videoBitsPerSecond);
  assert.equal(angles[0], 0);
  assert.ok(Math.abs(angles.at(-1) - Math.PI * 2) < 1e-9, "termina exactamente en 360°");
  assert.ok(angles.every((a, i) => i === 0 || a >= angles[i - 1]), "ángulo monótono");
  assert.ok(result.frames >= 96 && result.frames <= 100, `frames=${result.frames}`);
  assert.equal(canvas.stopped.length, 1, "libera el stream");
});

test("mime: prefiere VP9, cae a VP8 y luego a webm genérico", () => {
  assert.equal(media.pickRecorderMimeType(() => true), "video/webm;codecs=vp9");
  assert.equal(media.pickRecorderMimeType((t) => t !== "video/webm;codecs=vp9"), "video/webm;codecs=vp8");
  assert.equal(media.pickRecorderMimeType((t) => t === "video/webm"), "video/webm");
  assert.equal(media.pickRecorderMimeType(() => false), null);
  assert.equal(media.pickRecorderMimeType(undefined), null);
});

test("recordTurntable: navegador sin captureStream / MediaRecorder / WebM -> PreviewUnsupportedError", async () => {
  const common = { ...fakeClock(), renderFrame: () => {} };
  await assert.rejects(recorder.recordTurntable({ canvas: {}, MediaRecorderCtor: fakeRecorderCtor(), ...common }), recorder.PreviewUnsupportedError);
  await assert.rejects(recorder.recordTurntable({ canvas: fakeCanvas(), MediaRecorderCtor: null, ...common }), recorder.PreviewUnsupportedError);
  await assert.rejects(recorder.recordTurntable({ canvas: fakeCanvas(), MediaRecorderCtor: fakeRecorderCtor({ supported: [] }), ...common }), recorder.PreviewUnsupportedError);
});

test("recordTurntable: grabación sin datos -> error (nunca sube un blob vacío)", async () => {
  await assert.rejects(
    recorder.recordTurntable({ canvas: fakeCanvas(), MediaRecorderCtor: fakeRecorderCtor({ emptyData: true }), ...fakeClock(), renderFrame: () => {} }),
    /no produjo datos/,
  );
});

test("paths: determinístico por modelo (regenerar reemplaza) y URL con versión anti-cache", () => {
  assert.equal(media.buildPreviewPath("abc"), "abc/preview.webm");
  assert.equal(media.buildPreviewPath("abc"), media.buildPreviewPath("abc"));
  assert.throws(() => media.buildPreviewPath("../x"));
  assert.throws(() => media.buildPreviewPath(""));
  assert.equal(media.buildPreviewUrl("https://s/p.webm?v=1", 2), "https://s/p.webm?v=2");
});

// ---------------------------------------------------------------- SERVICIO: guardar preview (12, 13)
function fakeStorageSupabase({ uploadError = null, updateError = null } = {}) {
  const log = { uploads: [], updates: [] };
  return {
    log,
    storage: {
      from(bucket) {
        return {
          async upload(p, blob, opts) { log.uploads.push({ bucket, path: p, opts }); return { error: uploadError }; },
          getPublicUrl(p) { return { data: { publicUrl: `https://sb/storage/v1/object/public/${bucket}/${p}` } }; },
        };
      },
    },
    from(table) {
      return { update(row) { return { async eq(k, v) { log.updates.push({ table, row, eq: [k, v] }); return { error: updateError }; } }; } };
    },
  };
}
const okFetch = (status = 200) => async (url) =>
  String(url).includes("/api/stl/preview")
    ? { ok: status === 200, status, json: async () => ({ url: "https://signed/file", format: "stl" }) }
    : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
const input = (supabase, extra = {}) => ({ supabase, modelId: "model-1", variantId: "var-1", fileUrl: "storage://stl-files/stl/m/1-a.stl", ...extra });
const goodGenerate = async () => ({ thumbnail: null, thumbnailError: "n/a", preview: { blob: new Blob(["x"]), mimeType: "video/webm", bytes: 321, frames: 97 }, previewError: null });

test("servicio: sube a stl-previews/{modelId}/preview.webm con upsert y guarda preview_url", async () => {
  const sb = fakeStorageSupabase();
  const res = await service.generateAndStorePreview(input(sb), { fetchImpl: okFetch(), generate: goodGenerate, now: () => 111 });
  assert.equal(res.ok, true);
  assert.deepEqual(sb.log.uploads[0], { bucket: "stl-previews", path: "model-1/preview.webm", opts: { upsert: true, contentType: "video/webm", cacheControl: "3600" } });
  assert.equal(sb.log.updates[0].row.preview_url, "https://sb/storage/v1/object/public/stl-previews/model-1/preview.webm?v=111");
  assert.deepEqual(sb.log.updates[0].eq, ["id", "model-1"]);
});

test("regeneración: mismo path (reemplaza el asset) y nueva versión de URL", async () => {
  const sb = fakeStorageSupabase();
  await service.generateAndStorePreview(input(sb), { fetchImpl: okFetch(), generate: goodGenerate, now: () => 1 });
  await service.generateAndStorePreview(input(sb), { fetchImpl: okFetch(), generate: goodGenerate, now: () => 2 });
  assert.equal(sb.log.uploads[0].path, sb.log.uploads[1].path);
  assert.equal(sb.log.uploads.every((u) => u.opts.upsert), true);
  assert.notEqual(sb.log.updates[0].row.preview_url, sb.log.updates[1].row.preview_url);
});

test("3MF también se genera por el mismo servicio", async () => {
  const sb = fakeStorageSupabase();
  let formatSeen = null;
  const res = await service.generateAndStorePreview(input(sb, { fileUrl: "storage://stl-files/stl/m/1-a.3mf" }), {
    fetchImpl: okFetch(),
    generate: async (format) => { formatSeen = format; return goodGenerate(); },
  });
  assert.equal(res.ok, true);
  assert.equal(formatSeen, "3mf");
});

test("error de generación/subida/firma/DB -> ok:false con mensaje no destructivo, sin lanzar", async () => {
  const notice = "No pudimos generar la vista 360°. El modelo fue guardado correctamente.";
  const cases = [
    [fakeStorageSupabase(), { generate: async () => { throw new Error("WebGL no está disponible."); } }],
    [fakeStorageSupabase({ uploadError: { message: "mime not allowed" } }), { generate: goodGenerate }],
    [fakeStorageSupabase({ updateError: { message: "column preview_url does not exist" } }), { generate: goodGenerate }],
    [fakeStorageSupabase(), { generate: goodGenerate, fetchImpl: okFetch(403) }],
    [fakeStorageSupabase(), { generate: goodGenerate, fetchImpl: async () => { throw new Error("offline"); } }],
  ];
  for (const [sb, deps] of cases) {
    const res = await service.generateAndStorePreview(input(sb), { fetchImpl: okFetch(), ...deps });
    assert.equal(res.ok, false);
    assert.equal(res.message, notice);
    assert.ok(res.reason);
  }
});

test("ZIP, URL externa o sin variante: no se genera (y no se toca Storage)", async () => {
  for (const extra of [{ fileUrl: "storage://stl-files/x/pack.zip" }, { fileUrl: "https://ext/a.stl" }, { variantId: null }, { fileUrl: null }]) {
    const sb = fakeStorageSupabase();
    const res = await service.generateAndStorePreview(input(sb, extra), { fetchImpl: okFetch(), generate: goodGenerate });
    assert.equal(res.ok, false);
    assert.equal(sb.log.uploads.length, 0);
  }
});

// ---------------------------------------------------------------- GUARDADO (12, 14)
function saveSupabase({ failPreviewUpdate = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, op: "select", payload: null };
      calls.push(call);
      const b = {
        insert(rows) { call.op = "insert"; call.payload = rows; return b; },
        update(row) { call.op = "update"; call.payload = row; return b; },
        delete() { call.op = "delete"; return b; },
        eq() { return b; }, like() { return b; }, select() { return b; },
        async single() { return { data: { id: table === "stl_models" ? "model-1" : "variant-1" }, error: null }; },
        then(resolve) {
          if (call.op === "update" && call.payload && "preview_url" in call.payload && failPreviewUpdate) return resolve({ error: { message: "column preview_url does not exist" } });
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
  };
}
const formValues = { title: "Dragón", description: "", difficulty: "beginner", estimated_print_time: "", material_type: "", thumbnail_url: "", is_active: true, category_id: "" };
const previewWrites = (sb) => sb.calls.filter((c) => c.table === "stl_models" && c.op === "update" && c.payload && "preview_url" in c.payload);

test("archivo reemplazado -> preview anterior invalidado (preview_url = null)", async () => {
  const sb = saveSupabase();
  const res = await saveMod.saveStlModel(sb, { modelId: "model-1", values: formValues, fileUrl: "storage://stl-files/new.stl", variantId: "variant-1", fileChanged: true });
  assert.equal(res.ok, true);
  assert.equal(res.previewInvalidated, true);
  assert.equal(previewWrites(sb).length, 1);
  assert.equal(previewWrites(sb)[0].payload.preview_url, null);
});

test("archivo sin cambios (o solo metadata) -> NO toca preview_url", async () => {
  const sb = saveSupabase();
  const res = await saveMod.saveStlModel(sb, { modelId: "model-1", values: formValues, fileUrl: "storage://stl-files/same.stl", variantId: "variant-1", fileChanged: false });
  assert.equal(res.ok, true);
  assert.equal(previewWrites(sb).length, 0);
  const payload = sb.calls.find((c) => c.table === "stl_models" && c.op === "update").payload;
  assert.ok(!("preview_url" in payload), "el payload de edición normal nunca incluye preview_url");
});

test("invalidación fallida (p. ej. migration sin aplicar) NO bloquea el guardado del modelo", async () => {
  const sb = saveSupabase({ failPreviewUpdate: true });
  const res = await saveMod.saveStlModel(sb, { modelId: "model-1", values: formValues, fileUrl: "storage://stl-files/new.stl", variantId: "variant-1", fileChanged: true });
  assert.equal(res.ok, true);
  assert.equal(res.previewInvalidated, false);
});

test("alta: el payload del modelo no incluye preview_url (se escribe solo tras generar)", () => {
  assert.ok(!("preview_url" in payloadMod.buildStlModelPayload({ ...formValues })));
});

// ---------------------------------------------------------------- LIBRERÍA / COMPAT (16)
test("queries: la librería reintenta sin preview_url si la migration aún no está aplicada", async () => {
  const queries = load("src/lib/stl/queries.ts", { "@/lib/stl/library": lib, "@/lib/stl/model-payload": payloadMod });
  const seen = [];
  const supabase = {
    from(table) {
      const b = {
        _cols: "",
        select(cols) { this._cols = cols; return this; },
        eq() { return this; },
        order() {
          if (table === "stl_models") seen.push(this._cols);
          const res = table === "stl_models"
            ? (this._cols.includes("preview_url")
              ? { data: null, error: { code: "42703", message: "column stl_models.preview_url does not exist" } }
              : { data: [{ id: "m1", name: "A", title: "", category_id: null, is_active: true }], error: null })
            : { data: [], error: null };
          return Promise.resolve(res);
        },
      };
      return b;
    },
  };
  const result = await queries.fetchStlLibrary(supabase);
  assert.equal(result.error, null);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].title, "A");
  assert.equal(seen.length, 2);
  assert.ok(seen[0].includes("preview_url") && !seen[1].includes("preview_url"));
});

// ---------------------------------------------------------------- SEGURIDAD / STORAGE (15)
test("migration: stl-previews público solo video/webm; stl-files no se toca ni se hace público", () => {
  const sql = read("supabase/migrations/20261011120000_stl_model_preview_360.sql");
  const code = sql.replace(/--.*$/gm, "");
  assert.match(code, /add column if not exists preview_url text/);
  assert.match(code, /'stl-previews'/);
  assert.match(code, /array\['video\/webm'\]/);
  assert.doesNotMatch(code, /stl-files|stl-thumbnails/, "no toca otros buckets");
  assert.match(code, /insert to authenticated[\s\S]*public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(code, /update to authenticated[\s\S]*public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(code, /delete to authenticated[\s\S]*public\.is_admin\(auth\.uid\(\)\)/);
  assert.doesNotMatch(code, /for (insert|update|delete) to public|(insert|update|delete) to public/);
});

test("storage.ts: stl-files sigue privado; sin service role en código cliente nuevo", () => {
  const storage = read("src/lib/storage.ts");
  const publicList = storage.match(/publicBuckets = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(publicList, /stl-files/);
  for (const f of ["src/lib/stl/preview-service.ts", "src/lib/stl/generate-preview.ts", "src/components/stl/ModelPreviewCardMedia.tsx", "src/components/admin/stl-preview-panel.tsx", "src/components/admin/stl-model-form.tsx"]) {
    assert.doesNotMatch(read(f), /SERVICE_ROLE|service_role/, f);
  }
});

test("descarga y endpoints sin cambios: /api/stl/* y StlDownloadButton intactos", () => {
  const diff = execSync("git diff --name-only HEAD -- src/app/api/stl src/components/stl/StlDownloadButton.tsx", { cwd: root }).toString().trim();
  assert.equal(diff, "");
});

test("estados y copy del Admin", () => {
  assert.equal(media.PREVIEW_STATUS_LABEL.generating, "Generando vista 360°…");
  assert.equal(media.PREVIEW_STATUS_LABEL.ready, "Vista 360° lista");
  assert.equal(media.PREVIEW_STATUS_LABEL.failed, "No se pudo generar");
  assert.equal(media.PREVIEW_FAILURE_NOTICE, "No pudimos generar la vista 360°. El modelo fue guardado correctamente.");
  assert.equal(media.canGeneratePreview("storage://stl-files/a/b.STL"), true);
  assert.equal(media.canGeneratePreview("storage://stl-files/a/b.3mf"), true);
  assert.equal(media.canGeneratePreview("storage://stl-files/a/b.zip"), false);
  assert.equal(media.canGeneratePreview(""), false);
});

test("form Admin: guarda primero y genera después; el fallo de preview no usa el canal de error del guardado", () => {
  const src = read("src/components/admin/stl-model-form.tsx");
  const submit = src.slice(src.indexOf("const handleSubmit"));
  assert.ok(submit.indexOf("saveStlModel(") < submit.indexOf("runPreviewGeneration("), "primero se guarda");
  assert.match(submit, /fileChanged/);
  const gen = src.slice(src.indexOf("const runPreviewGeneration"), src.indexOf("const handleSubmit"));
  assert.doesNotMatch(gen, /setError\(/);
});
