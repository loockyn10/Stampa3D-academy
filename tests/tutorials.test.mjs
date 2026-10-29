import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");

// --- módulos bajo prueba ---------------------------------------------------------------------------------------
const registry = loadTs("src/lib/tutorials/registry.ts");
const types = loadTs("src/lib/tutorials/types.ts");
const progress = loadTs("src/lib/tutorials/progress.ts");
const state = loadTs("src/lib/tutorials/state.ts");
const videoLib = loadTs("src/lib/tutorials/video.ts");

// El panel se llama como función (sin DOM): los hooks se reemplazan por equivalentes inertes y se recorre el árbol
// de elementos para disparar los onClick reales. renderToStaticMarkup valida el HTML final con los hooks reales.
const inertReact = {
  ...React,
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useId: () => "t-id",
};
const linkMock = { __esModule: true, default: (p) => React.createElement("a", { href: p.href, className: p.className }, p.children) };
const panelModule = (reactImpl) =>
  loadTs("src/components/tutorials/TutorialPanel.tsx", { "next/link": linkMock, react: reactImpl });
const { TutorialPanel } = panelModule(React);
const { TutorialPanel: InertPanel } = panelModule(inertReact);

const FIXTURE = {
  id: "fixture",
  toolName: "Herramienta",
  title: "Título del tutorial",
  description: "Descripción corta.",
  version: 1,
  steps: [
    { id: "a", title: "Paso A", text: "Texto A", illustration: { kind: "flow", nodes: [{ icon: "printer", label: "Uno" }, { icon: "package", label: "Dos" }] } },
    { id: "b", title: "Paso B", text: "Texto B", illustration: { kind: "cards", items: [{ icon: "layers", title: "Tarjeta" }] } },
    { id: "c", title: "Paso C", text: "Texto C", illustration: { kind: "breakdown", rows: ["Fila"], subtotal: "Subtotal", result: "Resultado" } },
  ],
};
const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ";

function renderPanel({ step = 0, mode = "guide", video = null, tutorial = FIXTURE } = {}) {
  return renderToStaticMarkup(
    React.createElement(TutorialPanel, {
      tutorial,
      state: { step, mode },
      video,
      dispatch: () => {},
      onClose: () => {},
      titleId: "t-id",
    }),
  );
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}
function textOf(node) {
  let out = "";
  const collect = (value) => {
    if (typeof value === "string" || typeof value === "number") out += value;
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") collect(value.props?.children);
  };
  collect(node);
  return out;
}
function interactive(props) {
  const panel = InertPanel(props);
  const found = [];
  walk(panel, (n) => {
    if (n.props?.onClick) found.push(n);
  });
  return {
    click(label) {
      const target = found.find((n) => n.props["aria-label"] === label || textOf(n).trim().startsWith(label));
      assert.ok(target, `No hay un botón "${label}"`);
      target.props.onClick();
    },
    has: (label) => found.some((n) => n.props["aria-label"] === label || textOf(n).trim().startsWith(label)),
    root: panel,
  };
}
function panelHarness({ step = 0, mode = "guide", video = null } = {}) {
  const dispatched = [];
  const closed = [];
  return {
    dispatched,
    closed,
    ui: interactive({
      tutorial: FIXTURE,
      state: { step, mode },
      video,
      dispatch: (action) => dispatched.push(action),
      onClose: (reason) => closed.push(reason),
      titleId: "t-id",
    }),
  };
}

// --- registro y contenido --------------------------------------------------------------------------------------
test("registro: ids únicos, 3 a 5 pasos y versión entera ≥ 1", () => {
  const ids = registry.TUTORIAL_LIST.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 15);
  for (const tutorial of registry.TUTORIAL_LIST) {
    assert.ok(tutorial.steps.length >= 3 && tutorial.steps.length <= 5, `${tutorial.id}: ${tutorial.steps.length} pasos`);
    assert.ok(Number.isInteger(tutorial.version) && tutorial.version >= 1, `${tutorial.id}: versión`);
    assert.ok(tutorial.title && tutorial.description && tutorial.toolName, `${tutorial.id}: textos`);
    const stepIds = tutorial.steps.map((s) => s.id);
    assert.equal(new Set(stepIds).size, stepIds.length, `${tutorial.id}: ids de paso repetidos`);
    for (const step of tutorial.steps) assert.ok(step.title.trim() && step.text.trim(), `${tutorial.id}/${step.id}`);
  }
});

test("registro: los ids que ya existían en user_tool_tutorial_views se conservan (nadie reinicia su estado)", () => {
  for (const legacy of ["dashboard", "stampy", "courses", "calculator", "budgets", "products", "stock", "printers", "stl_library", "raffles", "settings"]) {
    assert.ok(registry.TUTORIALS[legacy], `falta ${legacy}`);
  }
});

test("registro: todas las ilustraciones usan iconos válidos y datos completos", () => {
  const valid = new Set(types.TUTORIAL_ICON_NAMES);
  for (const tutorial of registry.TUTORIAL_LIST) {
    for (const step of tutorial.steps) {
      const { illustration } = step;
      const icons = [];
      if (illustration.kind === "flow") {
        assert.ok(illustration.nodes.length >= 2, `${tutorial.id}/${step.id}: flow con menos de 2 nodos`);
        icons.push(...illustration.nodes.map((n) => n.icon));
      } else if (illustration.kind === "cards") {
        assert.ok(illustration.items.length >= 1);
        icons.push(...illustration.items.map((n) => n.icon));
      } else if (illustration.kind === "breakdown") {
        assert.ok(illustration.rows.length > 0 && illustration.subtotal && illustration.result);
      } else if (illustration.kind === "chat") {
        assert.ok(illustration.messages.length >= 2);
      } else {
        assert.equal(illustration.kind, "filters");
      }
      for (const icon of icons) assert.ok(valid.has(icon), `${tutorial.id}/${step.id}: icono ${icon}`);
    }
  }
});

test("registro: ningún tutorial trae un video inventado; si existe uno, tiene que ser reproducible", () => {
  for (const tutorial of registry.TUTORIAL_LIST) {
    if (tutorial.video === undefined) continue;
    assert.ok(videoLib.resolveTutorialVideo(tutorial.video.url), `${tutorial.id}: video no reproducible`);
  }
});

test("rutas: cada ruta apunta a un tutorial existente y las exclusiones no tienen tutorial", () => {
  for (const route of registry.TUTORIAL_ROUTES) assert.ok(registry.TUTORIALS[route.tutorialId], route.match);
  const id = registry.resolveTutorialId;
  assert.equal(id("/"), "dashboard");
  assert.equal(id("/academia"), "courses");
  assert.equal(id("/cursos/abc"), "courses");
  assert.equal(id("/mi-taller"), "workshop");
  assert.equal(id("/mi-taller/filamentos"), "stock");
  assert.equal(id("/mi-taller/inventario"), "stock");
  assert.equal(id("/mi-taller/impresoras"), "printers");
  assert.equal(id("/mi-taller/productos"), "products");
  assert.equal(id("/mi-negocio"), "business");
  assert.equal(id("/presupuestos"), "budgets");
  assert.equal(id("/libreria-stl/grupo/modelo"), "stl_library");
  assert.equal(id("/stampa-maker"), "maker");
  assert.equal(id("/explorar-modelos"), "model_search");
  assert.equal(id("/sorteos"), "raffles");
  assert.equal(id("/configuracion"), "settings");
  // Pantallas de trabajo pesado y rutas sin tutorial.
  assert.equal(id("/mi-negocio/venta-rapida"), null);
  assert.equal(id("/stampa-maker/neon"), null);
  assert.equal(id("/perfil"), null);
  // Acceso, landing y administración nunca.
  for (const excluded of ["/login", "/registro", "/sin-acceso", "/landing", "/admin", "/admin/sorteos/1"]) {
    assert.equal(id(excluded), null, excluded);
  }
  assert.equal(id(null), null);
});

// --- video -----------------------------------------------------------------------------------------------------
test("video: sin URL, marcador PENDIENTE_, URL inválida o no https → no hay video", () => {
  for (const value of [undefined, null, "", "   ", "PENDIENTE_VIDEO", "not a url", "http://youtu.be/dQw4w9WgXcQ", "javascript:alert(1)", "data:text/html,x"]) {
    assert.equal(videoLib.resolveTutorialVideo(value), null, String(value));
  }
});

test("video: YouTube, Bunny y externo se resuelven sin autoplay", () => {
  const yt = videoLib.resolveTutorialVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.deepEqual(yt, { kind: "youtube", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
  assert.equal(videoLib.resolveTutorialVideo(YOUTUBE).kind, "youtube");
  assert.equal(videoLib.resolveTutorialVideo("https://www.youtube.com/embed/dQw4w9WgXcQ").kind, "youtube");

  const bunny = videoLib.resolveTutorialVideo("https://player.mediadelivery.net/embed/123/abc?autoplay=true");
  assert.equal(bunny.kind, "bunny");
  assert.match(bunny.embedUrl, /autoplay=false/);
  assert.doesNotMatch(bunny.embedUrl, /autoplay=true/);

  assert.deepEqual(videoLib.resolveTutorialVideo("https://example.com/video.mp4"), { kind: "external", href: "https://example.com/video.mp4" });
  // Un host parecido no se hace pasar por Bunny.
  assert.equal(videoLib.resolveTutorialVideo("https://player.mediadelivery.net.evil.com/x").kind, "external");
});

test("video: el override de la base solo se usa si el tutorial no define uno", () => {
  const withVideo = { video: { url: YOUTUBE } };
  assert.equal(state.getTutorialVideo(withVideo, "https://example.com/otro").kind, "youtube");
  assert.equal(state.getTutorialVideo({}, "https://example.com/otro").kind, "external");
  assert.equal(state.getTutorialVideo({}, "PENDIENTE_X"), null);
  assert.equal(state.getTutorialVideo({}, null), null);
});

// --- navegación ------------------------------------------------------------------------------------------------
test("navegación: siguiente / anterior respetan los límites y goto se acota", () => {
  const reduce = (s, a, hasVideo = false) => state.tutorialViewReducer(FIXTURE, s, a, hasVideo);
  let s = state.initialViewState();
  assert.deepEqual(s, { step: 0, mode: "guide" });
  s = reduce(s, { type: "previous" });
  assert.equal(s.step, 0);
  s = reduce(reduce(s, { type: "next" }), { type: "next" });
  assert.equal(s.step, 2);
  assert.equal(state.isLastStep(FIXTURE, s), true);
  s = reduce(s, { type: "next" });
  assert.equal(s.step, 2);
  assert.equal(reduce(s, { type: "goto", step: -4 }).step, 0);
  assert.equal(reduce(s, { type: "goto", step: 99 }).step, 2);
  assert.equal(reduce(s, { type: "previous" }).step, 1);
});

test("modalidad: sin video no se puede pasar a video; con video se alterna y conserva el paso", () => {
  const reduce = (s, a, hasVideo) => state.tutorialViewReducer(FIXTURE, s, a, hasVideo);
  const base = { step: 1, mode: "guide" };
  assert.deepEqual(reduce(base, { type: "mode", mode: "video" }, false), base);
  const inVideo = reduce(base, { type: "mode", mode: "video" }, true);
  assert.deepEqual(inVideo, { step: 1, mode: "video" });
  assert.deepEqual(reduce(inVideo, { type: "mode", mode: "guide" }, true), base);
});

// --- panel: render ---------------------------------------------------------------------------------------------
test("panel sin video: solo guía visual, sin reproductor, sin toggle ni botones de video", () => {
  const html = renderPanel({ video: null });
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /Ver video/);
  assert.doesNotMatch(html, /Guía visual/);
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /Herramienta/);
  assert.match(html, /Título del tutorial/);
  assert.match(html, /Paso A/);
});

test("panel sin video aunque el modo pida video: se muestra la guía (nunca un estado vacío)", () => {
  const html = renderPanel({ mode: "video", video: null });
  assert.match(html, /Paso A/);
  assert.doesNotMatch(html, /<iframe/);
});

test("panel con video: ofrece Ver video, pero NO carga el reproductor hasta elegirlo y nunca autoplay", () => {
  const video = videoLib.resolveTutorialVideo(YOUTUBE);
  const guide = renderPanel({ video });
  assert.match(guide, /Ver video/);
  assert.match(guide, /Guía visual/);
  assert.match(guide, /Paso A/);
  assert.doesNotMatch(guide, /<iframe/);

  const playing = renderPanel({ mode: "video", video });
  assert.match(playing, /<iframe/);
  assert.match(playing, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.doesNotMatch(playing, /autoplay/i);
  assert.match(playing, /loading="lazy"/);
  assert.match(playing, /Volver a la guía/);
  assert.doesNotMatch(playing, /Paso A/);
});

test("panel con video externo: enlace seguro en lugar de iframe", () => {
  const html = renderPanel({ mode: "video", video: videoLib.resolveTutorialVideo("https://example.com/v") });
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /href="https:\/\/example\.com\/v"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("panel: botones por paso (Siguiente / Omitir / Anterior / Finalizar) y progreso accesible", () => {
  const first = renderPanel({ step: 0 });
  assert.match(first, /Siguiente/);
  assert.match(first, /Omitir/);
  assert.doesNotMatch(first, /Anterior/);
  assert.doesNotMatch(first, /Finalizar/);
  assert.match(first, /Paso 1 de 3/);
  assert.match(first, /role="progressbar"[^>]*aria-valuemin="1"[^>]*aria-valuemax="3"[^>]*aria-valuenow="1"/);

  const middle = renderPanel({ step: 1 });
  assert.match(middle, /Anterior/);
  assert.match(middle, /Siguiente/);
  assert.match(middle, /Paso 2 de 3/);

  const last = renderPanel({ step: 2 });
  assert.match(last, /Finalizar/);
  assert.match(last, /Anterior/);
  assert.doesNotMatch(last, /Siguiente/);
  assert.doesNotMatch(last, /Omitir/);
  assert.match(last, /Paso 3 de 3/);
  assert.match(last, /aria-valuenow="3"/);
});

test("panel: accesibilidad — título enlazado al diálogo, cerrar etiquetado, región en vivo y movimiento reducido", () => {
  const html = renderPanel();
  assert.match(html, /<h2 id="t-id"/);
  assert.match(html, /aria-label="Cerrar tutorial"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /motion-reduce:animate-none/);
  assert.match(html, /min-h-11/);

  const modal = read("src/components/tutorials/TutorialModal.tsx");
  assert.match(modal, /labelledBy=\{titleId\}/);
  assert.match(modal, /from "@\/components\/ui\/dialog"/); // Escape, restauración de foco y bloqueo de scroll del Dialog compartido
});

// --- panel: interacción ----------------------------------------------------------------------------------------
test("interacción: Siguiente/Anterior despachan navegación; el último paso finaliza", () => {
  const first = panelHarness({ step: 0 });
  first.ui.click("Siguiente");
  assert.deepEqual(first.dispatched, [{ type: "next" }]);

  const middle = panelHarness({ step: 1 });
  middle.ui.click("Anterior");
  assert.deepEqual(middle.dispatched, [{ type: "previous" }]);

  const last = panelHarness({ step: 2 });
  last.ui.click("Finalizar");
  assert.deepEqual(last.closed, ["finish"]);
});

test("interacción: cerrar (X) cierra y Omitir omite", () => {
  const close = panelHarness({ step: 1 });
  close.ui.click("Cerrar tutorial");
  assert.deepEqual(close.closed, ["close"]);

  const skip = panelHarness({ step: 0 });
  skip.ui.click("Omitir");
  assert.deepEqual(skip.closed, ["skip"]);
});

test("interacción: cambio de modalidad despacha el modo y en video se vuelve a la guía", () => {
  const video = videoLib.resolveTutorialVideo(YOUTUBE);
  const guide = panelHarness({ video });
  guide.ui.click("Ver video");
  assert.deepEqual(guide.dispatched, [{ type: "mode", mode: "video" }]);

  const playing = panelHarness({ mode: "video", video });
  playing.ui.click("Volver a la guía");
  assert.deepEqual(playing.dispatched, [{ type: "mode", mode: "guide" }]);
  assert.equal(playing.ui.has("Omitir"), false);
});

test("interacción: las flechas navegan en la guía y no hacen nada en el video; Tab queda dentro del panel", () => {
  const arrows = (mode, key) => {
    const dispatched = [];
    const panel = InertPanel({
      tutorial: FIXTURE,
      state: { step: 1, mode },
      video: mode === "video" ? videoLib.resolveTutorialVideo(YOUTUBE) : null,
      dispatch: (a) => dispatched.push(a),
      onClose: () => {},
      titleId: "t",
    });
    panel.props.onKeyDown({ key, preventDefault() {}, shiftKey: false });
    return dispatched;
  };
  assert.deepEqual(arrows("guide", "ArrowRight"), [{ type: "next" }]);
  assert.deepEqual(arrows("guide", "ArrowLeft"), [{ type: "previous" }]);
  assert.deepEqual(arrows("video", "ArrowRight"), []);
  assert.match(read("src/components/tutorials/TutorialPanel.tsx"), /event\.key === "Tab"/);
});

// --- ilustraciones ---------------------------------------------------------------------------------------------
test("ilustraciones: cada tipo renderiza su contenido como lista accesible", () => {
  const { TutorialIllustration } = loadTs("src/components/tutorials/TutorialIllustration.tsx");
  const render = (illustration) => renderToStaticMarkup(React.createElement(TutorialIllustration, { illustration }));
  assert.match(render({ kind: "flow", nodes: [{ icon: "printer", label: "Uno" }, { icon: "package", label: "Dos", hint: "pista" }] }), /<ol[\s\S]*Uno[\s\S]*Dos[\s\S]*pista/);
  assert.match(render({ kind: "cards", items: [{ icon: "layers", title: "T", text: "X", tone: "accent" }] }), /<ul[\s\S]*T[\s\S]*X/);
  assert.match(render({ kind: "breakdown", rows: ["A", "B"], subtotal: "Sub", result: "Res", note: "Nota" }), /A[\s\S]*B[\s\S]*Sub[\s\S]*Res[\s\S]*Nota/);
  assert.match(render({ kind: "chat", messages: [{ from: "user", text: "Hola" }, { from: "stampy", text: "Chau" }] }), /Hola[\s\S]*Stampy[\s\S]*Chau/);
  assert.match(render({ kind: "filters", search: "buscar", groups: [{ label: "Precio", options: ["Gratis"], active: "Gratis" }] }), /buscar[\s\S]*Precio[\s\S]*Gratis/);
});

test("ilustraciones: todos los tutoriales reales renderizan completos", () => {
  for (const tutorial of registry.TUTORIAL_LIST) {
    for (let step = 0; step < tutorial.steps.length; step += 1) {
      const html = renderPanel({ tutorial, step });
      assert.match(html, new RegExp(tutorial.steps[step].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${tutorial.id}/${step}`);
    }
  }
});

// --- tema ------------------------------------------------------------------------------------------------------
test("tema: los componentes usan tokens semánticos (sin hex, rgba, colores neutros literales ni dark:)", () => {
  for (const file of [
    "src/components/tutorials/TutorialPanel.tsx",
    "src/components/tutorials/TutorialModal.tsx",
    "src/components/tutorials/TutorialIllustration.tsx",
    "src/components/tutorials/GlobalToolTutorial.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${file}: hex`);
    assert.doesNotMatch(source, /rgba?\(/, `${file}: rgba`);
    assert.doesNotMatch(source, /\b(?:text|bg|border)-(?:white|black)\b/, `${file}: blanco/negro literal`);
    assert.doesNotMatch(source, /\bdark:/, `${file}: variante dark:`);
    assert.doesNotMatch(source, /theme-force/, `${file}: no fuerza un tema`);
  }
  assert.match(read("src/components/tutorials/TutorialPanel.tsx"), /bg-stampa-bg|text-fg|border-stampa-border/);
  assert.match(read("src/components/tutorials/TutorialModal.tsx"), /bg-stampa-bg/);
});

// --- primer acceso, visto y versionado -------------------------------------------------------------------------
const baseOpen = { version: 1, checked: true, alreadyAutoOpened: false, blocked: false };

test("primer acceso: sin registro previo se abre sola, una vez, y no mientras el menú móvil está abierto", () => {
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, seenVersion: null }), true);
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, seenVersion: null, checked: false }), false);
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, seenVersion: null, alreadyAutoOpened: true }), false);
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, seenVersion: null, blocked: true }), false);
});

test("tutorial ya visto: no se abre sola", () => {
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, seenVersion: 1 }), false);
  assert.equal(progress.hasSeenTutorial(1, 1), true);
  assert.equal(progress.hasSeenTutorial(null, 1), false);
});

test("versionado: subir la versión reabre solo a quien vio una anterior; el resto no se ve afectado", () => {
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, version: 2, seenVersion: 1 }), true);
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, version: 2, seenVersion: 2 }), false);
  assert.equal(progress.shouldAutoOpenTutorial({ ...baseOpen, version: 2, seenVersion: 3 }), false);
  // Un cambio de versión en un tutorial no toca a los demás: cada uno se guarda por su propio id.
  const storage = memoryStorage();
  progress.writeLocalSeenVersion("u1", "calculator", 1, storage);
  assert.equal(progress.readLocalSeenVersion("u1", "calculator", storage), 1);
  assert.equal(progress.readLocalSeenVersion("u1", "products", storage), null);
});

// --- persistencia ----------------------------------------------------------------------------------------------
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), map };
}

/** Cliente de Supabase mínimo. `hasSeenVersion=false` simula la base sin la migration. */
function fakeSupabase({ rows = [], hasSeenVersion = true, readError = false, writeError = false, overrides = {} } = {}) {
  const log = { upserts: [], selects: [] };
  const table = (name) => {
    const filters = {};
    const builder = {
      select(columns) {
        builder.columns = columns;
        log.selects.push({ table: name, columns });
        return builder;
      },
      eq(column, value) {
        filters[column] = value;
        return builder;
      },
      async maybeSingle() {
        if (name === "tool_tutorials") {
          const row = overrides[filters.tool_key] ?? null;
          return { data: row, error: null };
        }
        if (readError) return { data: null, error: { message: "boom" } };
        if (!hasSeenVersion && String(builder.columns).includes("seen_version")) return { data: null, error: { message: "column does not exist" } };
        const row = rows.find((r) => r.user_id === filters.user_id && r.tool_key === filters.tool_key) ?? null;
        if (!row) return { data: null, error: null };
        return { data: hasSeenVersion ? row : { ...row, seen_version: undefined }, error: null };
      },
      async upsert(payloads) {
        log.upserts.push(payloads[0]);
        if (writeError) return { error: { message: "denied" } };
        if (!hasSeenVersion && "seen_version" in payloads[0]) return { error: { message: "column does not exist" } };
        const [payload] = payloads;
        const index = rows.findIndex((r) => r.user_id === payload.user_id && r.tool_key === payload.tool_key);
        if (index >= 0) rows[index] = { ...rows[index], ...payload };
        else rows.push({ ...payload });
        return { error: null };
      },
    };
    return builder;
  };
  return { from: table, log, rows };
}

test("persistencia: sin registro devuelve null; con registro devuelve la versión guardada", async () => {
  const supabase = fakeSupabase({ rows: [{ user_id: "u1", tool_key: "calculator", dismissed_at: "x", seen_version: 2 }] });
  assert.deepEqual(await progress.fetchSeenVersion(supabase, "u1", "calculator"), { ok: true, version: 2 });
  assert.deepEqual(await progress.fetchSeenVersion(supabase, "u1", "products"), { ok: true, version: null });
});

test("persistencia: una fila anterior a la migration cuenta como versión 1 (no se reinician tutoriales ya vistos)", async () => {
  const legacy = fakeSupabase({ hasSeenVersion: false, rows: [{ user_id: "u1", tool_key: "calculator", viewed_at: "x", dismissed_at: "x" }] });
  assert.deepEqual(await progress.fetchSeenVersion(legacy, "u1", "calculator"), { ok: true, version: 1 });
  const migrated = fakeSupabase({ rows: [{ user_id: "u1", tool_key: "calculator", viewed_at: "x", dismissed_at: "x", seen_version: 1 }] });
  assert.equal((await progress.fetchSeenVersion(migrated, "u1", "calculator")).version, 1);
  assert.equal(
    progress.shouldAutoOpenTutorial({ ...baseOpen, seenVersion: (await progress.fetchSeenVersion(legacy, "u1", "calculator")).version }),
    false,
  );
});

test("persistencia: guardar escribe versión + espejo local; sin la columna reintenta sin ella", async () => {
  const storage = memoryStorage();
  const supabase = fakeSupabase();
  assert.equal(await progress.markTutorialSeen(supabase, "u1", "calculator", 2, storage), true);
  assert.equal(supabase.log.upserts.length, 1);
  assert.equal(supabase.log.upserts[0].seen_version, 2);
  assert.equal(supabase.log.upserts[0].user_id, "u1");
  assert.equal(supabase.log.upserts[0].tool_key, "calculator");
  assert.ok(supabase.log.upserts[0].dismissed_at && supabase.log.upserts[0].viewed_at);
  assert.equal(storage.getItem("stampa-tutorial-seen:u1:calculator"), "2");

  const noColumn = fakeSupabase({ hasSeenVersion: false });
  assert.equal(await progress.markTutorialSeen(noColumn, "u1", "calculator", 1, storage), true);
  assert.equal(noColumn.log.upserts.length, 2);
  assert.equal("seen_version" in noColumn.log.upserts[1], false);
  assert.equal(noColumn.rows.length, 1);
});

test("persistencia: si la base falla igual queda el espejo local y no se vuelve a mostrar", async () => {
  const storage = memoryStorage();
  const failing = fakeSupabase({ writeError: true, readError: true });
  assert.equal(await progress.markTutorialSeen(failing, "u1", "calculator", 1, storage), false);
  assert.equal(await progress.loadSeenVersion(failing, "u1", "calculator", storage), 1);
  const throwing = { from() { throw new Error("offline"); } };
  assert.equal(await progress.markTutorialSeen(throwing, "u1", "calculator", 1, storage), false);
  assert.equal(await progress.loadSeenVersion(throwing, "u1", "calculator", storage), 1);
});

test("persistencia: gana la versión mayor entre base y espejo local", async () => {
  const storage = memoryStorage({ "stampa-tutorial-seen:u1:calculator": "3" });
  const supabase = fakeSupabase({ rows: [{ user_id: "u1", tool_key: "calculator", seen_version: 2 }] });
  assert.equal(await progress.loadSeenVersion(supabase, "u1", "calculator", storage), 3);
  assert.equal(await progress.loadSeenVersion(supabase, "u1", "products", memoryStorage()), null);
});

test("usuarios distintos en el mismo navegador: el estado nunca se mezcla", async () => {
  const storage = memoryStorage();
  const supabase = fakeSupabase();
  await progress.markTutorialSeen(supabase, "ana", "calculator", 1, storage);
  assert.equal(await progress.loadSeenVersion(supabase, "ana", "calculator", storage), 1);
  assert.equal(await progress.loadSeenVersion(supabase, "bruno", "calculator", storage), null);
  assert.notEqual(progress.localSeenKey("ana", "calculator"), progress.localSeenKey("bruno", "calculator"));
  assert.equal(
    progress.shouldAutoOpenTutorial({ ...baseOpen, seenVersion: await progress.loadSeenVersion(supabase, "bruno", "calculator", storage) }),
    true,
  );
});

test("persistencia: storage bloqueado no rompe nada", () => {
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(progress.readLocalSeenVersion("u1", "calculator", blocked), null);
  assert.doesNotThrow(() => progress.writeLocalSeenVersion("u1", "calculator", 1, blocked));
  assert.equal(progress.readLocalSeenVersion("u1", "calculator", null), null);
});

test("tool_tutorials: la fila inactiva apaga la guía; sin fila o con error no desactiva nada; el video se hereda", async () => {
  const supabase = fakeSupabase({
    overrides: {
      calculator: { is_active: false, video_url: "PENDIENTE_X" },
      products: { is_active: true, video_url: "https://example.com/p" },
    },
  });
  assert.deepEqual(await progress.fetchTutorialOverride(supabase, "calculator"), { disabled: true, videoUrl: "PENDIENTE_X" });
  assert.deepEqual(await progress.fetchTutorialOverride(supabase, "products"), { disabled: false, videoUrl: "https://example.com/p" });
  assert.deepEqual(await progress.fetchTutorialOverride(supabase, "stock"), { disabled: false, videoUrl: null });
  assert.deepEqual(await progress.fetchTutorialOverride({ from() { throw new Error("x"); } }, "stock"), { disabled: false, videoUrl: null });
});

// --- integración ----------------------------------------------------------------------------------------------
test("integración: main-layout monta GlobalToolTutorial y éste usa el registro, el espejo y el botón ¿Cómo funciona?", () => {
  assert.match(read("src/app/main-layout.tsx"), /<GlobalToolTutorial/);
  const global = read("src/components/tutorials/GlobalToolTutorial.tsx");
  assert.match(global, /resolveTutorialId\(pathname\)/);
  assert.match(global, /shouldAutoOpenTutorial/);
  assert.match(global, /markTutorialSeen/);
  assert.match(global, /¿Cómo funciona\?/);
  assert.match(global, /onClick=\{\(\) => setOpenKey\(key\)\}/); // apertura manual
  // La apertura automática exige haber leído el estado de la cuenta (no se abre antes de saber si ya lo vio).
  assert.match(global, /const current = status && status\.key === key/);
  // Un solo sistema: no queda el modal anterior ni helpers duplicados.
  assert.equal(
    (() => {
      try {
        read("src/components/tutorials/ToolTutorial.tsx");
        return true;
      } catch {
        return false;
      }
    })(),
    false,
  );
});
