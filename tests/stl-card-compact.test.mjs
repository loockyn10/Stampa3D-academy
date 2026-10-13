import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const nodeRequire = createRequire(path.join(root, "package.json"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");

function load(relativePath, deps = {}) {
  const { outputText } = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
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

const media = load("src/lib/stl/preview-media.ts");
const cycle = load("src/lib/stl/preview-cycle.ts", { "@/lib/stl/preview-media": media });
const cardMedia = load("src/components/stl/ModelPreviewCardMedia.tsx", { "@/lib/stl/preview-media": media, "@/lib/stl/preview-cycle": cycle });
const card = load("src/components/stl/StlModelCard.tsx", {
  "next/link": { __esModule: true, default: (p) => React.createElement("a", { href: p.href, className: p.className }, p.children) },
  "@/components/ui/card": load("src/components/ui/card.tsx"),
  "@/components/stl/ModelPreviewCardMedia": cardMedia,
  "@/components/stl/StlDifficultyBadge": load("src/components/stl/StlDifficultyBadge.tsx"),
});

const GENERATED = "https://x.supabase.co/storage/v1/object/public/stl-thumbnails/m1/thumbnail.webp?v=2";
const render = (model, groupLabel) =>
  renderToStaticMarkup(
    React.createElement(card.StlModelCard, { href: "/x", groupLabel, model: { id: "m1", title: "Llavero Flexi Pantera Rosa", hasFile: true, ...model } }),
  );
/** Marco de media: el div con aspect-[4/3] hasta el pie. */
const frameOf = (html) => html.match(/<div class="[^"]*aspect-\[4\/3\][^"]*">([\s\S]*?)<div class="flex flex-1/)?.[1] ?? "";
const metaOf = (html) => html.match(/<p class="flex min-w-0[^>]*>[\s\S]*?<\/p>/)?.[0] ?? null;

test("1-3. thumbnail, WebM y placeholder viven en el MISMO marco 4:3 (sin altura fija h-48)", () => {
  const html = render({ thumbnail_url: GENERATED, preview_url: "https://x/p.webm" });
  assert.match(html, /relative aspect-\[4\/3\] w-full overflow-hidden/);
  assert.doesNotMatch(html, /\bh-48\b/);
  const frame = frameOf(html);
  assert.match(frame, /<img/);
  assert.match(frame, /<video/);
  assert.match(frame, /<div class="absolute inset-0">/);
  assert.match(frame, /<img[^>]*class="h-full w-full /);
  assert.match(frame, /<video[^>]*class="[^"]*absolute inset-0 h-full w-full/);
  const placeholder = frameOf(render({ thumbnail_url: null }));
  assert.match(placeholder, /<div class="absolute inset-0"><div class="flex h-full w-full items-center justify-center">/);
  assert.doesNotMatch(placeholder, /<img|<video/);
});

test("el preview activo no cambia el tamaño: el video es absolute dentro del marco", () => {
  const src = read("src/components/stl/ModelPreviewCardMedia.tsx");
  assert.match(src, /pointer-events-none absolute inset-0 h-full w-full object-contain/);
  assert.doesNotMatch(src, /aspect-|min-h|\bh-\d/, "el tamaño lo fija solo el padre 4:3");
});

test("assets generados -> contain (sin recorte); portadas manuales -> cover", () => {
  assert.match(frameOf(render({ thumbnail_url: GENERATED })), /<img[^>]*class="[^"]*object-contain/);
  assert.match(frameOf(render({ thumbnail_url: "https://cdn.x/portada.jpg" })), /<img[^>]*class="[^"]*object-cover/);
  assert.match(frameOf(render({ thumbnail_url: GENERATED, preview_url: "https://x/p.webm" })), /<video[^>]*class="[^"]*object-contain/);
});

test("4-5. nombre corto y largo: line-clamp-2, sin forzar altura", () => {
  const long = "Soporte articulado para auriculares con base de carga inalámbrica y organizador de cables XL edición especial ".repeat(2);
  for (const title of ["Pikachu", long]) {
    const html = render({ title });
    assert.match(html, /<h3 class="line-clamp-2 break-words text-\[15px\] font-bold leading-snug text-white">/);
    assert.ok(html.includes(title));
  }
  assert.doesNotMatch(read("src/components/stl/StlModelCard.tsx"), /min-h-|\bh-\[/);
});

test("pie compacto: padding 12-14 px, sin las dos cajas grandes ni CTA centrado en fila propia", () => {
  const html = render({ material_type: "PLA", estimated_print_time: "2 h" });
  assert.match(html, /flex flex-1 flex-col gap-2 px-3\.5 py-3/);
  assert.doesNotMatch(html, /\bp-5\b|mt-4|grid-cols-2|Tiempo Imp\./);
});

test("material + tiempo en una sola línea; con ambos aparece el separador", () => {
  const meta = metaOf(render({ material_type: "PLA", estimated_print_time: "2 h" }));
  assert.ok(meta);
  assert.match(meta, />PLA</);
  assert.match(meta, />2 h</);
  assert.match(meta, /·/);
});

test("6-7. sin material o sin tiempo: se oculta el dato ausente, sin huecos ni guion inventado", () => {
  const onlyMaterial = metaOf(render({ material_type: "PETG" }));
  assert.match(onlyMaterial, />PETG</);
  assert.doesNotMatch(onlyMaterial, /·|Tiempo/);
  const onlyTime = metaOf(render({ estimated_print_time: "3 h" }));
  assert.match(onlyTime, />3 h</);
  assert.doesNotMatch(onlyTime, /·|Material/);
  for (const empty of [{}, { material_type: "  ", estimated_print_time: "" }, { material_type: null, estimated_print_time: null }]) {
    const html = render(empty);
    assert.equal(metaOf(html), null);
    assert.doesNotMatch(html, />-</);
    assert.match(html, /Ver modelo 3D/, "el CTA sigue alineado a la derecha");
  }
});

test("CTA compacto a la derecha en la misma fila; 'Ver detalle' si no hay archivo", () => {
  const html = render({ material_type: "PLA" });
  assert.match(html, /ml-auto py-0\.5 text-xs font-bold text-stampa-orange">Ver modelo 3D <span aria-hidden="true">→<\/span>/);
  assert.match(render({ hasFile: false }), /Ver detalle/);
  assert.match(html, /<a [^>]*class="group block h-full/, "toda la card es el área clickeable");
});

test("8-9. badge 360 y dificultad dentro del marco 4:3 y sin bloquear clics", () => {
  const html = render({ thumbnail_url: GENERATED, preview_url: "https://x/p.webm", difficulty: "hard" });
  const frame = frameOf(html);
  assert.match(frame, /data-testid="preview-360-badge"[^>]*>360°/);
  assert.match(frame, /pointer-events-none absolute right-2 top-2 z-10/);
  assert.match(frame, /Difícil/);
  assert.match(frame, /absolute bottom-2 left-2/);
  assert.doesNotMatch(frameOf(render({ thumbnail_url: GENERATED })), /360°/);
});

test("10. cards de una fila: grid responsive intacto, card h-full y pie con mt-auto", () => {
  const html = render({ material_type: "PLA" });
  assert.match(html, /flex h-full flex-col overflow-hidden/);
  assert.match(html, /mt-auto flex flex-wrap items-center justify-between/);
  for (const page of ["src/app/libreria-stl/page.tsx", "src/app/libreria-stl/[group]/page.tsx"]) {
    assert.match(read(page), /grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4/);
  }
});

test("alcance: la lógica de preview 360 y el aislamiento de Three.js no cambiaron", () => {
  const mediaSrc = read("src/components/stl/ModelPreviewCardMedia.tsx");
  assert.match(mediaSrc, /getPreviewCycle\(\)\.register/);
  assert.match(mediaSrc, /AMBIENT_TIMING\.visibleThreshold/);
  assert.match(mediaSrc, /preload="none"/);
  assert.doesNotMatch(mediaSrc + read("src/components/stl/StlModelCard.tsx"), /from "three|Model3DViewer|WebGLRenderer/);
});
