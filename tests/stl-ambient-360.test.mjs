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
const cycleMod = load("src/lib/stl/preview-cycle.ts", { "@/lib/stl/preview-media": media });
const service = load("src/lib/stl/preview-service.ts", { "@/lib/stl/library": lib, "@/lib/stl/preview-media": media });
const cardMedia = load("src/components/stl/ModelPreviewCardMedia.tsx", { "@/lib/stl/preview-media": media, "@/lib/stl/preview-cycle": cycleMod });
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const React = nodeRequire("react");
const T = media.AMBIENT_TIMING;

// ---------------------------------------------------------------- harness del ciclo (reloj falso)
function harness(ids, { visible = ids, eligible = ids } = {}) {
  let now = 0;
  const timers = new Map();
  let nextHandle = 1;
  const cycle = cycleMod.createPreviewCycle({
    setTimeoutFn: (fn, ms) => {
      const h = nextHandle++;
      timers.set(h, { at: now + ms, fn });
      return h;
    },
    clearTimeoutFn: (h) => timers.delete(h),
  });
  const snapshots = {};
  const maxActive = { value: 0 };
  for (const id of ids) {
    snapshots[id] = { active: false, token: 0 };
    cycle.register(id, (snap) => {
      snapshots[id] = snap;
      const n = Object.values(snapshots).filter((s) => s.active).length;
      maxActive.value = Math.max(maxActive.value, n);
    });
  }
  for (const id of ids) cycle.update(id, { eligible: eligible.includes(id), inView: visible.includes(id) });
  const advance = (ms) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = target;
  };
  return { cycle, snapshots, advance, maxActive, activeIds: () => ids.filter((id) => snapshots[id].active), pending: () => timers.size };
}

// ---------------------------------------------------------------- THUMBNAIL: reglas puras
test("thumbnail: sin thumbnail -> se genera; generada por el sistema -> se regenera; manual -> NO se sobrescribe", () => {
  const gen = "https://sb/storage/v1/object/public/stl-thumbnails/m1/thumbnail.webp?v=5";
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: null, modelId: "m1" }), true);
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: "  ", modelId: "m1" }), true);
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: gen, modelId: "m1" }), true);
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: "https://sb/stl-thumbnails/otro/portada.jpg", modelId: "m1" }), false);
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: "https://cdn.x/foto.png", modelId: "m1" }), false);
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: "https://sb/stl-thumbnails/m2/thumbnail.webp", modelId: "m1" }), false, "de otro modelo no cuenta como generada");
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: "https://cdn.x/foto.png", modelId: "m1", force: true }), true, "Regenerar miniatura es explícito");
});

test("thumbnail: path determinístico en stl-thumbnails y spec WebP 512 en vista 3/4", () => {
  assert.equal(media.STL_THUMBNAIL_BUCKET, "stl-thumbnails");
  assert.equal(media.buildThumbnailPath("abc"), "abc/thumbnail.webp");
  assert.throws(() => media.buildThumbnailPath("../x"));
  assert.equal(media.THUMBNAIL_SPEC.mimeType, "image/webp");
  assert.equal(media.THUMBNAIL_SPEC.size, 512);
  const deg = (media.THUMBNAIL_SPEC.yaw * 180) / Math.PI;
  assert.ok(deg >= 35 && deg <= 45);
});

// ---------------------------------------------------------------- THUMBNAIL: servicio
function fakeSb({ failBucket = null, updateError = null } = {}) {
  const log = { uploads: [], updates: [] };
  return {
    log,
    storage: {
      from(bucket) {
        return {
          async upload(p, blob, opts) {
            log.uploads.push({ bucket, path: p, opts });
            return { error: failBucket === bucket ? { message: "denied" } : null };
          },
          getPublicUrl(p) {
            return { data: { publicUrl: `https://sb/storage/v1/object/public/${bucket}/${p}` } };
          },
        };
      },
    },
    from(table) {
      return {
        update(row) {
          return {
            async eq(k, v) {
              log.updates.push({ table, row, eq: [k, v] });
              return { error: updateError };
            },
          };
        },
      };
    },
  };
}
const okFetch = async (url) =>
  String(url).includes("/api/stl/preview")
    ? { ok: true, status: 200, json: async () => ({ url: "https://signed/file" }) }
    : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
const input = (sb, extra = {}) => ({ supabase: sb, modelId: "m1", variantId: "v1", fileUrl: "storage://stl-files/s/1.stl", ...extra });
const thumb = { blob: new Blob(["w"]), mimeType: "image/webp", bytes: 11 };
const prev = { blob: new Blob(["v"]), mimeType: "video/webm", bytes: 22, frames: 97 };
const assets = (o = {}) => async (format, buf, opts) => {
  assets.last = { format, opts };
  return { thumbnail: thumb, thumbnailError: null, preview: prev, previewError: null, ...o };
};

test("modelo sin thumbnail -> genera WebP, lo sube a stl-thumbnails/{id}/thumbnail.webp y guarda thumbnail_url + preview_url", async () => {
  const sb = fakeSb();
  const res = await service.generateAndStorePreview(input(sb), { fetchImpl: okFetch, generate: assets(), now: () => 7 });
  assert.equal(res.ok, true);
  assert.equal(res.thumbnail, "generated");
  const t = sb.log.uploads.find((u) => u.bucket === "stl-thumbnails");
  assert.deepEqual(t, { bucket: "stl-thumbnails", path: "m1/thumbnail.webp", opts: { upsert: true, contentType: "image/webp", cacheControl: "3600" } });
  assert.ok(sb.log.uploads.find((u) => u.bucket === "stl-previews"));
  assert.equal(sb.log.updates.length, 1, "una sola escritura a DB");
  assert.equal(sb.log.updates[0].row.thumbnail_url, "https://sb/storage/v1/object/public/stl-thumbnails/m1/thumbnail.webp?v=7");
  assert.equal(sb.log.updates[0].row.preview_url, "https://sb/storage/v1/object/public/stl-previews/m1/preview.webm?v=7");
  assert.deepEqual(assets.last.opts, { thumbnail: true, preview: true });
});

test("thumbnail manual -> NO se sobrescribe (ni se pide al generador); el preview sí se genera", async () => {
  const sb = fakeSb();
  const res = await service.generateAndStorePreview(input(sb, { currentThumbnailUrl: "https://cdn.x/portada.jpg" }), {
    fetchImpl: okFetch,
    generate: assets(),
    now: () => 7,
  });
  assert.equal(res.ok, true);
  assert.equal(res.thumbnail, "kept");
  assert.equal(assets.last.opts.thumbnail, false);
  assert.equal(sb.log.uploads.some((u) => u.bucket === "stl-thumbnails"), false);
  assert.equal("thumbnail_url" in sb.log.updates[0].row, false);
});

test("'Regenerar miniatura' (force + thumbnailOnly) reemplaza la manual en el mismo path y no graba video", async () => {
  const sb = fakeSb();
  const res = await service.generateAndStorePreview(
    input(sb, { currentThumbnailUrl: "https://cdn.x/portada.jpg", forceThumbnail: true, thumbnailOnly: true }),
    { fetchImpl: okFetch, generate: assets({ preview: null }), now: () => 9 },
  );
  assert.equal(res.ok, true);
  assert.deepEqual(assets.last.opts, { thumbnail: true, preview: false });
  assert.deepEqual(sb.log.uploads.map((u) => u.path), ["m1/thumbnail.webp"]);
  assert.ok(sb.log.updates[0].row.thumbnail_url.endsWith("m1/thumbnail.webp?v=9"));
  assert.equal("preview_url" in sb.log.updates[0].row, false);
});

test("'Regenerar miniatura' que falla -> ok:false con aviso de miniatura, sin tocar DB", async () => {
  const sb = fakeSb();
  const res = await service.generateAndStorePreview(input(sb, { forceThumbnail: true, thumbnailOnly: true }), {
    fetchImpl: okFetch,
    generate: assets({ thumbnail: null, thumbnailError: "toBlob", preview: null }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, media.THUMBNAIL_FAILURE_NOTICE);
  assert.equal(sb.log.updates.length, 0);
});

test("thumbnail generada previamente + archivo nuevo -> se regenera sola (sin metadata extra)", async () => {
  const sb = fakeSb();
  const generated = "https://sb/storage/v1/object/public/stl-thumbnails/m1/thumbnail.webp?v=1";
  await service.generateAndStorePreview(input(sb, { currentThumbnailUrl: generated }), { fetchImpl: okFetch, generate: assets(), now: () => 2 });
  assert.equal(assets.last.opts.thumbnail, true);
});

test("STL y 3MF generan thumbnail", async () => {
  for (const [file, fmt] of [["a.stl", "stl"], ["a.3mf", "3mf"]]) {
    const sb = fakeSb();
    const res = await service.generateAndStorePreview(input(sb, { fileUrl: `storage://stl-files/s/${file}` }), { fetchImpl: okFetch, generate: assets() });
    assert.equal(res.thumbnail, "generated");
    assert.equal(assets.last.format, fmt);
  }
});

test("fallo de thumbnail (generación) NO rompe el preview; aviso no destructivo", async () => {
  const sb = fakeSb();
  const res = await service.generateAndStorePreview(input(sb), {
    fetchImpl: okFetch,
    generate: assets({ thumbnail: null, thumbnailError: "toBlob" }),
    now: () => 3,
  });
  assert.equal(res.ok, true);
  assert.equal(res.thumbnail, "failed");
  assert.match(res.notice, /miniatura/i);
  assert.ok(res.previewUrl);
  assert.equal("thumbnail_url" in sb.log.updates[0].row, false, "no se toca la miniatura anterior");
});

test("fallo de subida de thumbnail (bucket/policy) NO rompe el preview", async () => {
  const sb = fakeSb({ failBucket: "stl-thumbnails" });
  const res = await service.generateAndStorePreview(input(sb), { fetchImpl: okFetch, generate: assets(), now: () => 3 });
  assert.equal(res.ok, true);
  assert.equal(res.thumbnail, "failed");
  assert.ok(sb.log.updates[0].row.preview_url);
  assert.equal("thumbnail_url" in sb.log.updates[0].row, false);
});

test("fallo de preview NO elimina la thumbnail: se guarda y se informa", async () => {
  const sb = fakeSb();
  const res = await service.generateAndStorePreview(input(sb), {
    fetchImpl: okFetch,
    generate: assets({ preview: null, previewError: "MediaRecorder" }),
    now: () => 4,
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, media.PREVIEW_FAILURE_NOTICE);
  assert.equal(res.thumbnail, "generated");
  assert.match(res.thumbnailUrl, /m1\/thumbnail\.webp\?v=4$/);
  assert.equal(sb.log.updates.length, 1);
  assert.ok(sb.log.updates[0].row.thumbnail_url);
  assert.equal("preview_url" in sb.log.updates[0].row, false);
});

test("fallan ambos -> ok:false, sin escribir DB y sin lanzar", async () => {
  const sb = fakeSb();
  const res = await service.generateAndStorePreview(input(sb), {
    fetchImpl: okFetch,
    generate: assets({ thumbnail: null, thumbnailError: "x", preview: null, previewError: "y" }),
  });
  assert.equal(res.ok, false);
  assert.equal(sb.log.updates.length, 0);
});

test("generador: parsea/arma la escena una vez, captura WebP desde el canvas (no desde el WebM) y reutiliza helpers", () => {
  const src = read("src/lib/stl/generate-preview.ts");
  assert.equal(src.match(/parseModel3D\(/g).length, 1, "un solo parse");
  assert.equal(src.match(/new THREE\.WebGLRenderer/g).length, 1, "un solo renderer");
  assert.match(src, /canvas\.toBlob/);
  assert.match(src, /THUMBNAIL_SPEC\.mimeType/);
  assert.ok(src.indexOf("canvasToBlob(canvas") < src.indexOf("recordTurntable({"), "miniatura antes de grabar");
  assert.match(src, /thumbnailError/);
  assert.match(src, /previewError/);
  assert.doesNotMatch(src, /MeshStandardMaterial/);
});

test("Admin: botón 'Regenerar miniatura' fuerza reemplazo solo-miniatura; la miniatura generada se refleja en el form", () => {
  const form = read("src/components/admin/stl-model-form.tsx");
  assert.match(form, /forceThumbnail: true, thumbnailOnly: true/);
  assert.match(form, /result\.thumbnailUrl/);
  assert.match(read("src/components/admin/stl-preview-panel.tsx"), /Regenerar miniatura/);
});

// ---------------------------------------------------------------- CARDS
const render = (props) => renderToStaticMarkup(React.createElement(cardMedia.ModelPreviewCardMedia, { id: "c1", title: "Dragón", ...props }));

test("card inactiva (estado inicial): muestra thumbnail y el <video> existe sin src, oculto", () => {
  const html = render({ thumbnailUrl: "https://x/t.webp", previewUrl: "https://x/p.webm" });
  assert.match(html, /<img[^>]+src="https:\/\/x\/t\.webp"/);
  assert.match(html, /<video/);
  assert.doesNotMatch(html, /<video[^>]*\ssrc=/);
  assert.match(html, /opacity-0/);
});

test("card activa/terminada/error: transiciones por fuente (src solo al activarse; ended y error vuelven a thumbnail)", () => {
  const src = read("src/components/stl/ModelPreviewCardMedia.tsx");
  assert.match(src, /attachSrc = eligible && hasActivated && \(active \|\| inView\)/);
  assert.match(src, /videoReady && playing \? "opacity-100" : "opacity-0"/);
  assert.match(src, /onEnded=\{onVideoEnded\}/);
  assert.match(src, /const onVideoEnded = \(\) => \{\s*setVideoReady\(false\);\s*getPreviewCycle\(\)\.ended\(id\)/);
  assert.match(src, /setFailed\(true\)[\s\S]*getPreviewCycle\(\)\.failed\(id\)/);
  assert.match(src, /AMBIENT_TIMING\.visibleThreshold/);
  assert.match(src, /prefers-reduced-motion: reduce/);
});

test("badge 360° solo con preview_url; discreto y sin bloquear clics", () => {
  const withPreview = render({ thumbnailUrl: "https://x/t.webp", previewUrl: "https://x/p.webm" });
  assert.match(withPreview, /360°/);
  assert.match(withPreview, /pointer-events-none/);
  for (const previewUrl of [null, undefined, ""]) {
    const html = render({ thumbnailUrl: "https://x/t.webp", previewUrl });
    assert.doesNotMatch(html, /360°/);
    assert.doesNotMatch(html, /<video/);
  }
});

test("card sin preview nunca entra al ciclo (no se registra) y sin thumbnail muestra placeholder", () => {
  const src = read("src/components/stl/ModelPreviewCardMedia.tsx");
  assert.match(src, /if \(!previewUrl\) return;\s*return getPreviewCycle\(\)\.register/);
  const html = render({ thumbnailUrl: null, previewUrl: null });
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /<img|<video/);
});

test("cards: cero Three.js/WebGL, sin loop y sin descargar STL/3MF", () => {
  const src = read("src/components/stl/ModelPreviewCardMedia.tsx") + read("src/components/stl/StlModelCard.tsx");
  assert.doesNotMatch(src, /from "three|WebGLRenderer|Model3DViewer|api\/stl|stl-files/);
  assert.doesNotMatch(src, /^\s+loop\s*$/m);
});

// ---------------------------------------------------------------- CICLO
test("tres cards visibles: A -> B -> C -> A, esperando 'ended'", () => {
  const h = harness(["A", "B", "C"]);
  assert.deepEqual(h.activeIds(), [], "no arranca de golpe");
  h.advance(T.startDelayMs);
  assert.deepEqual(h.activeIds(), ["A"]);
  h.advance(60_000);
  assert.deepEqual(h.activeIds(), ["A"], "sin 'ended' no avanza");
  const order = [];
  for (let i = 0; i < 4; i += 1) {
    order.push(h.activeIds()[0]);
    h.cycle.ended(h.activeIds()[0]);
    assert.deepEqual(h.activeIds(), [], "entre previews la card vuelve a thumbnail");
    h.advance(T.betweenDelayMs);
  }
  assert.deepEqual(order, ["A", "B", "C", "A"]);
});

test("máximo un video activo en todo momento", () => {
  const h = harness(["A", "B", "C", "D"]);
  h.advance(T.startDelayMs);
  for (let i = 0; i < 12; i += 1) {
    h.cycle.ended(h.activeIds()[0]);
    h.advance(T.betweenDelayMs);
  }
  h.cycle.interactStart("D");
  h.cycle.interactEnd("D");
  h.advance(10_000);
  assert.ok(h.maxActive.value <= 1);
});

test("card sin preview o fuera de viewport se omite del ciclo", () => {
  const h = harness(["A", "B", "C"], { visible: ["A", "C"], eligible: ["B", "C"] });
  h.advance(T.startDelayMs);
  assert.deepEqual(h.activeIds(), ["C"], "A sin preview, B fuera de viewport");
  h.cycle.ended("C");
  h.advance(T.soloDelayMs);
  assert.deepEqual(h.activeIds(), ["C"]);
});

test("scroll: la card activa sale del viewport -> se detiene de inmediato y sigue con una visible", () => {
  const h = harness(["A", "B", "C"]);
  h.advance(T.startDelayMs);
  assert.deepEqual(h.activeIds(), ["A"]);
  h.cycle.update("A", { inView: false });
  assert.deepEqual(h.activeIds(), [], "se detiene inmediatamente");
  h.advance(T.recoverDelayMs);
  assert.deepEqual(h.activeIds(), ["B"]);
});

test("scroll: ninguna visible -> no hay timers colgando ni reproducción; al volver reanuda", () => {
  const h = harness(["A"]);
  h.advance(T.startDelayMs);
  h.cycle.update("A", { inView: false });
  h.advance(60_000);
  assert.deepEqual(h.activeIds(), []);
  assert.equal(h.pending(), 0);
  h.cycle.update("A", { inView: true });
  h.advance(T.startDelayMs);
  assert.deepEqual(h.activeIds(), ["A"]);
});

test("hover interrumpe el ciclo: C reproduce de inmediato y repite mientras dure el hover", () => {
  const h = harness(["A", "B", "C"]);
  h.advance(T.startDelayMs);
  assert.deepEqual(h.activeIds(), ["A"]);
  h.cycle.interactStart("C");
  assert.deepEqual(h.activeIds(), ["C"]);
  const token = h.snapshots.C.token;
  h.cycle.ended("C");
  assert.deepEqual(h.activeIds(), ["C"], "sigue activa");
  assert.ok(h.snapshots.C.token > token, "token nuevo -> la card reinicia el video");
  h.advance(60_000);
  assert.deepEqual(h.activeIds(), ["C"], "el ambiental no la pisa");
});

test("mouseleave reanuda el ciclo tras ~1 s, continuando desde la siguiente (no desde la primera)", () => {
  const h = harness(["A", "B", "C"]);
  h.advance(T.startDelayMs);
  h.cycle.interactStart("B");
  h.cycle.interactEnd("B");
  assert.deepEqual(h.activeIds(), [], "vuelve a thumbnail");
  h.advance(T.resumeDelayMs - 1);
  assert.deepEqual(h.activeIds(), []);
  h.advance(1);
  assert.deepEqual(h.activeIds(), ["C"]);
  assert.ok(T.resumeDelayMs >= 750 && T.resumeDelayMs <= 1500);
});

test("focus interrumpe y blur reanuda (misma ruta que hover)", () => {
  const src = read("src/components/stl/ModelPreviewCardMedia.tsx");
  assert.match(src, /addEventListener\("focusin", start\)/);
  assert.match(src, /addEventListener\("focusout", end\)/);
  const h = harness(["A", "B"]);
  h.advance(T.startDelayMs);
  h.cycle.interactStart("B");
  assert.deepEqual(h.activeIds(), ["B"]);
  h.cycle.interactEnd("B");
  h.advance(T.resumeDelayMs);
  assert.deepEqual(h.activeIds(), ["A"]);
});

test("hover solo con puntero real; focus siempre (mobile no depende de hover)", () => {
  const src = read("src/components/stl/ModelPreviewCardMedia.tsx");
  assert.match(src, /hover: hover\) and \(pointer: fine/);
  assert.match(src, /if \(canHover\) \{\s*target\.addEventListener\("mouseenter"/);
});

test("una sola card candidata: puede repetirse tras una pausa razonable (no frenético)", () => {
  const h = harness(["A"]);
  h.advance(T.startDelayMs);
  h.cycle.ended("A");
  h.advance(T.soloDelayMs - 1);
  assert.deepEqual(h.activeIds(), []);
  h.advance(1);
  assert.deepEqual(h.activeIds(), ["A"]);
  assert.ok(T.soloDelayMs >= 2000);
});

test("error de video en A -> queda fuera del ciclo y continúa con B (sin reintentos)", () => {
  const h = harness(["A", "B"]);
  h.advance(T.startDelayMs);
  h.cycle.failed("A");
  assert.deepEqual(h.activeIds(), []);
  h.advance(T.recoverDelayMs);
  assert.deepEqual(h.activeIds(), ["B"]);
  h.cycle.ended("B");
  h.advance(T.soloDelayMs);
  assert.deepEqual(h.activeIds(), ["B"], "A nunca vuelve");
  h.cycle.update("A", { inView: true, eligible: true });
  h.cycle.ended("B");
  h.advance(T.soloDelayMs);
  assert.deepEqual(h.activeIds(), ["B"], "update no rehabilita una card fallida");
});

test("reduced-motion: card no elegible -> nunca autoplay; interactStart tampoco la activa", () => {
  const h = harness(["A", "B"], { eligible: [] });
  h.advance(60_000);
  assert.deepEqual(h.activeIds(), []);
  assert.equal(h.pending(), 0);
  h.cycle.interactStart("A");
  assert.deepEqual(h.activeIds(), []);
  assert.match(read("src/components/stl/ModelPreviewCardMedia.tsx"), /const eligible = hasPreview && !reducedMotion/);
});

test("pestaña oculta: se detiene; al volver reanuda", () => {
  const h = harness(["A", "B"]);
  h.advance(T.startDelayMs);
  h.cycle.setSuspended(true);
  assert.deepEqual(h.activeIds(), []);
  h.advance(60_000);
  assert.deepEqual(h.activeIds(), []);
  h.cycle.setSuspended(false);
  h.advance(T.startDelayMs);
  assert.equal(h.activeIds().length, 1);
});

test("desmontar la card activa libera el ciclo y continúa con otra", () => {
  const ids = ["A", "B"];
  const snaps = { A: { active: false }, B: { active: false } };
  let now = 0;
  const timers = [];
  const cycle = cycleMod.createPreviewCycle({
    setTimeoutFn: (fn, ms) => timers.push({ at: now + ms, fn }) && timers.length,
    clearTimeoutFn: () => undefined,
  });
  const offs = ids.map((id) => cycle.register(id, (s) => { snaps[id] = s; }));
  ids.forEach((id) => cycle.update(id, { eligible: true, inView: true }));
  const run = (ms) => {
    now += ms;
    timers.splice(0).forEach((t) => (t.at <= now ? t.fn() : timers.push(t)));
  };
  run(T.startDelayMs);
  assert.equal(snaps.A.active, true);
  offs[0]();
  assert.equal(cycle.size(), 1);
  assert.equal(cycle.getActiveId(), null);
  run(T.recoverDelayMs);
  assert.equal(cycle.getActiveId(), "B");
});

// ---------------------------------------------------------------- REGRESIÓN
test("regresión: viewer del detalle, descarga y endpoints /api/stl intactos", () => {
  const viewer = read("src/components/stl/Model3DViewer.tsx");
  assert.match(viewer, /OrbitControls/);
  assert.match(viewer, /\/api\/stl\/preview/);
  const diff = execSync(
    "git diff --name-only HEAD -- src/app/api/stl src/components/stl/StlDownloadButton.tsx src/components/stl/Model3DViewer.tsx",
    { cwd: root },
  ).toString().trim();
  assert.equal(diff, "");
});

test("regresión: Librería sin previews sigue renderizando la card", () => {
  const card = load("src/components/stl/StlModelCard.tsx", {
    "next/link": { __esModule: true, default: (p) => React.createElement("a", { href: p.href }, p.children) },
    "@/components/ui/card": { Card: (p) => React.createElement("div", null, p.children) },
    "@/components/stl/ModelPreviewCardMedia": cardMedia,
    "@/components/stl/StlDifficultyBadge": { StlDifficultyBadge: () => null },
  });
  const html = renderToStaticMarkup(React.createElement(card.StlModelCard, { href: "/x", model: { id: "1", title: "Sin preview", hasFile: true } }));
  assert.match(html, /Sin preview/);
  assert.doesNotMatch(html, /<video|360°/);
});

test("sin migration nueva: solo existe la de preview_url", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((f) => /stl/i.test(f) && f >= "20261011");
  assert.deepEqual(files, ["20261011120000_stl_model_preview_360.sql"]);
});

// ---------------------------------------------------------------- ADMIN: dropzone de miniatura manual
const crop = load("src/lib/images/crop.ts", {});
const imgFile = (name, type, size = 1024) => ({ name, type, size });
const form = read("src/components/admin/stl-model-form.tsx");
const dropzone = read("src/components/ui/file-upload-dropzone.tsx");

test("miniatura manual: PNG, JPG/JPEG y WEBP se aceptan", () => {
  for (const [name, type] of [["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.webp", "image/webp"]]) {
    assert.equal(crop.validateRasterImageFile(imgFile(name, type), 5), null, name);
  }
});

test("miniatura manual: formato inválido y archivo pesado se rechazan antes de subir", () => {
  assert.match(crop.validateRasterImageFile(imgFile("a.gif", "image/gif"), 5), /JPG, PNG o WEBP/);
  assert.match(crop.validateRasterImageFile(imgFile("a.svg", "image/svg+xml"), 5), /JPG, PNG o WEBP/);
  assert.match(crop.validateRasterImageFile(imgFile("a.png", "image/png", 6 * 1024 * 1024), 5), /pesada/);
  // el dropzone valida (tipo/tamaño) y corta antes de subir
  const handle = dropzone.slice(dropzone.indexOf("const handleSelectedFile"), dropzone.indexOf("const handleUpload"));
  assert.match(handle, /validationError[\s\S]*return;/);
});

test("form: el dropzone sube a stl-thumbnails (público, 5 MB, solo imágenes) con path basado en modelId", () => {
  assert.match(form, /bucket="stl-thumbnails"/);
  assert.match(form, /pathPrefix=\{`stl-thumbnails\/\$\{modelId \|\| "new"\}`\}/);
  assert.match(form, /accept="\.jpg,\.jpeg,\.png,\.webp"/);
  assert.match(form, /publicBucket=\{true\}/);
  assert.match(form, /maxSizeMb=\{5\}/);
  assert.doesNotMatch(form, /otra sección/);
  assert.doesNotMatch(form, /SERVICE_ROLE/);
});

test("form: la URL subida va a thumbnail_url y se persiste con el guardado (payload canónico)", () => {
  assert.match(form, /onUploaded=\{\(url\) => setFormData\(\(prev\) => \(\{ \.\.\.prev, thumbnail_url: url \}\)\)\}/);
  const payload = load("src/lib/stl/model-payload.ts", { "@/lib/stl/library": lib });
  const v = { title: "X", description: "", difficulty: "beginner", estimated_print_time: "", material_type: "", thumbnail_url: "https://sb/public/stl-thumbnails/m1/9-a.png", is_active: true, category_id: "" };
  assert.equal(payload.buildStlModelPayload(v).thumbnail_url, v.thumbnail_url);
  assert.equal(payload.buildStlModelPayload({ ...v, thumbnail_url: "" }).thumbnail_url, null, "Quitar -> null");
});

test("form: en edición se carga y muestra la miniatura actual, con Reemplazar y Quitar", () => {
  assert.match(form, /thumbnail_url: modelData\.thumbnail_url \|\| ""/);
  assert.match(form, /formData\.thumbnail_url && \(/);
  assert.match(form, /Reemplazar miniatura/);
  assert.match(form, /Quitar miniatura/);
  assert.match(form, /alt="Vista previa de la miniatura"/);
});

test("error de upload: el dropzone muestra el error y NO llama onUploaded; el form no depende del upload para guardar", () => {
  const upload = dropzone.slice(dropzone.indexOf("if (uploadError)"), dropzone.indexOf("onUploadComplete(filePath);\n      }"));
  assert.match(upload, /setError\(uploadError\.message/);
  assert.doesNotMatch(upload, /onUploaded/);
  assert.match(dropzone, /\{error &&/);
  const submit = form.slice(form.indexOf("const handleSubmit"));
  assert.doesNotMatch(submit, /thumbnail.*upload|storage\./);
});

test("miniatura manual subida por el Admin no es sobrescrita por 'Generar vista 360°'; sin miniatura sí se genera", () => {
  const uploaded = "https://sb/storage/v1/object/public/stl-thumbnails/stl-thumbnails/m1/1700-portada.png";
  assert.equal(media.isGeneratedThumbnailUrl(uploaded, "m1"), false);
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: uploaded, modelId: "m1" }), false);
  assert.equal(media.shouldGenerateThumbnail({ currentUrl: "", modelId: "m1" }), true);
  assert.match(form, /currentThumbnailUrl: options\.currentThumbnailUrl \?\? formData\.thumbnail_url/);
});
