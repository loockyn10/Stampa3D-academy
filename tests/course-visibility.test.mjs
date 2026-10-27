import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const h = React.createElement;

const visibility = loadTs("src/lib/academy/visibility.ts");
const catalog = loadTs("src/lib/academy/catalog.ts");
const continueLearning = loadTs("src/lib/academy/continue-learning.ts");

const COURSE_ID = "9f39a4e8-8c16-4f17-9b84-63d14eb24042";
const LESSON_ID = "0b6d8c1e-2f7a-4d58-9d0e-1f2a3b4c5d6e";

const course = (status, extra = {}) => ({
  id: extra.id ?? COURSE_ID,
  slug: "fundamentos",
  title: "Fundamentos",
  description: "Aprendé a imprimir en 3D",
  thumbnailUrl: "https://cdn.test/cover.png",
  courseKind: "course",
  level: "beginner",
  status,
});

function accessSnapshot({ authenticated = true, admin = false, platform = true } = {}) {
  return {
    authenticated,
    userId: authenticated ? "user-1" : null,
    capabilities: { accessAdmin: admin, accessPlatform: admin || platform },
  };
}

function loadAccess({ access, academiaAvailable = true, row = null, lessonRow = null }) {
  const queries = [];
  const supabase = {
    from(table) {
      const state = { table, filters: [] };
      const builder = {
        select() { return builder; },
        eq(column, value) { state.filters.push([column, value]); return builder; },
        async maybeSingle() {
          queries.push(state);
          return table === "lessons" ? { data: lessonRow, error: null } : { data: row, error: null };
        },
      };
      return builder;
    },
  };
  const mod = loadTs("src/lib/academy/access.ts", {
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access, error: null }) },
    "@/lib/features/server": { isFeatureAvailable: async () => academiaAvailable },
  });
  return { mod, supabase, queries };
}

// ---------------------------------------------------------------------------------------------------------------
// Estados y normalización
// ---------------------------------------------------------------------------------------------------------------

test("los tres estados canónicos y los valores históricos se normalizan sin publicar nada por error", () => {
  assert.deepEqual([...visibility.COURSE_VISIBILITIES], ["published", "coming_soon", "hidden"]);
  assert.equal(visibility.normalizeCourseVisibility("published"), "published");
  assert.equal(visibility.normalizeCourseVisibility("coming_soon"), "coming_soon");
  for (const legacy of ["hidden", "draft", "archived", "", null, undefined, "Published", "algo"]) {
    assert.equal(visibility.normalizeCourseVisibility(legacy), "hidden", String(legacy));
  }
  assert.equal(visibility.isCourseVisibility("draft"), false);
  assert.equal(visibility.isCourseVisibility("hidden"), true);
});

// 1 + 3 + 5: visibilidad en el catálogo -------------------------------------------------------------------------------

test("catálogo: publicado visible, en preparación visible aparte, oculto ausente, sin duplicados", () => {
  const rows = [
    { id: "a", status: "published" },
    { id: "b", status: "coming_soon" },
    { id: "c", status: "hidden" },
    { id: "d", status: "draft" },
    { id: "e", status: "archived" },
    { id: "a", status: "published" },
  ];
  const { published, comingSoon } = catalog.splitCatalogCourses(rows);
  assert.deepEqual(published.map((c) => c.id), ["a"]);
  assert.deepEqual(comingSoon.map((c) => c.id), ["b"]);
  assert.deepEqual(catalog.filterRecommendableCourses(rows).map((c) => c.id), ["a", "a"]);
  assert.deepEqual([...catalog.CATALOG_STATUSES], ["published", "coming_soon"]);
});

test("las páginas del catálogo solo piden published y coming_soon y separan las secciones", () => {
  for (const file of ["src/app/cursos/page.tsx", "src/app/talleres/page.tsx", "src/app/academia/page.tsx"]) {
    const source = read(file);
    assert.match(source, /\.in\("status", \[\.\.\.CATALOG_STATUSES\]\)/, file);
    assert.match(source, /splitCatalogCourses\(courses\)/, file);
    assert.match(source, /ComingSoonSection/, file);
    assert.doesNotMatch(source, /\.eq\("status", "hidden"\)|draft|archived/, file);
  }
  // Academia solo recomienda rutas con cursos publicados.
  const academia = read("src/app/academia/page.tsx");
  assert.match(academia, /resolveRecommendedPathView\(profile, learningPaths, catalog\.published\)/);
  assert.match(academia, /courses=\{catalog\.published\}/);
});

// ---------------------------------------------------------------------------------------------------------------
// Acceso por servidor (2, 4, 6, 7, 11, 12)
// ---------------------------------------------------------------------------------------------------------------

test("decisión de acceso: publicado entra, en preparación no entra, oculto no existe, admin conserva todo", () => {
  const student = { isAdmin: false };
  const admin = { isAdmin: true };

  assert.deepEqual(visibility.resolveCourseAccess("published", student), {
    visibility: "published", canView: true, canEnter: true, canWriteProgress: true, canRecommend: true, listed: true, adminPreview: false,
  });
  assert.deepEqual(visibility.resolveCourseAccess("coming_soon", student), {
    visibility: "coming_soon", canView: true, canEnter: false, canWriteProgress: false, canRecommend: false, listed: true, adminPreview: false,
  });
  assert.deepEqual(visibility.resolveCourseAccess("hidden", student), {
    visibility: "hidden", canView: false, canEnter: false, canWriteProgress: false, canRecommend: false, listed: false, adminPreview: false,
  });
  for (const status of ["published", "coming_soon", "hidden", "draft", "archived"]) {
    const decision = visibility.resolveCourseAccess(status, admin);
    assert.equal(decision.canView && decision.canEnter && decision.canWriteProgress, true, status);
    assert.equal(decision.adminPreview, status !== "published", status);
  }
});

test("loadCourseGate: curso publicado accesible para un alumno con membresía", async () => {
  const { mod, supabase } = loadAccess({ access: accessSnapshot(), row: { id: COURSE_ID, slug: "fundamentos", title: "Fundamentos", description: "d", thumbnail_url: null, course_kind: "course", level: "beginner", status: "published" } });
  const gate = await mod.loadCourseGate(supabase, COURSE_ID);
  assert.equal(gate.kind, "open");
  assert.equal(gate.decision.adminPreview, false);
});

test("loadCourseGate: en preparación bloquea el contenido y no entrega datos de clases", async () => {
  const { mod, supabase } = loadAccess({ access: accessSnapshot(), row: { id: COURSE_ID, slug: "fundamentos", title: "Fundamentos", description: "d", thumbnail_url: null, course_kind: "course", level: "beginner", status: "coming_soon" } });
  const gate = await mod.loadCourseGate(supabase, "fundamentos");
  assert.equal(gate.kind, "coming_soon");
  assert.deepEqual(Object.keys(gate.course).sort(), ["courseKind", "description", "id", "level", "slug", "status", "thumbnailUrl", "title"]);
});

test("loadCourseGate: oculto, borrador y archivado responden como inexistentes por URL directa", async () => {
  for (const status of ["hidden", "draft", "archived", null]) {
    const { mod, supabase } = loadAccess({ access: accessSnapshot(), row: { id: COURSE_ID, slug: "x", title: "X", description: null, thumbnail_url: null, course_kind: "course", level: null, status } });
    assert.equal((await mod.loadCourseGate(supabase, COURSE_ID)).kind, "not_found", String(status));
  }
  const { mod, supabase } = loadAccess({ access: accessSnapshot(), row: null });
  assert.equal((await mod.loadCourseGate(supabase, "no-existe")).kind, "not_found");
});

test("loadCourseGate: el administrador accede a cursos de cualquier estado (vista previa)", async () => {
  for (const status of ["published", "coming_soon", "hidden", "draft", "archived"]) {
    const { mod, supabase } = loadAccess({ access: accessSnapshot({ admin: true }), row: { id: COURSE_ID, slug: "x", title: "X", description: null, thumbnail_url: null, course_kind: "course", level: null, status } });
    const gate = await mod.loadCourseGate(supabase, COURSE_ID);
    assert.equal(gate.kind, "open", status);
    assert.equal(gate.decision.adminPreview, status !== "published", status);
  }
});

test("membresías: authenticated != paid; sin membresía no se accede ni a la ficha en preparación", async () => {
  for (const status of ["published", "coming_soon"]) {
    const { mod, supabase, queries } = loadAccess({ access: accessSnapshot({ platform: false }), row: { id: COURSE_ID, slug: "x", title: "X", description: null, thumbnail_url: null, course_kind: "course", level: null, status } });
    assert.equal((await mod.loadCourseGate(supabase, COURSE_ID)).kind, "no_membership", status);
    assert.equal(queries.length, 0, "no consulta el curso antes de validar la membresía");
  }
  const anon = loadAccess({ access: accessSnapshot({ authenticated: false }), row: null });
  assert.equal((await anon.mod.loadCourseGate(anon.supabase, COURSE_ID)).kind, "unauthenticated");
});

test("feature flags: con Academia deshabilitada un curso publicado tampoco es accesible (admin sí)", async () => {
  const row = { id: COURSE_ID, slug: "x", title: "X", description: null, thumbnail_url: null, course_kind: "course", level: null, status: "published" };
  const blocked = loadAccess({ access: accessSnapshot(), academiaAvailable: false, row });
  assert.equal((await blocked.mod.loadCourseGate(blocked.supabase, COURSE_ID)).kind, "feature_unavailable");
  assert.equal(blocked.queries.length, 0);

  // El mapa de decisión pura también prioriza la funcionalidad sobre la visibilidad del curso.
  const pure = blocked.mod.decideCourseGate({ authenticated: true, isAdmin: false, accessPlatform: true, academiaAvailable: false, course: course("published") });
  assert.equal(pure.kind, "feature_unavailable");
  const adminPure = blocked.mod.decideCourseGate({ authenticated: true, isAdmin: true, accessPlatform: true, academiaAvailable: true, course: course("hidden") });
  assert.equal(adminPure.kind, "open");
});

test("/cursos/[id] es una página de servidor que decide antes de montar el cliente", () => {
  const page = read("src/app/cursos/[id]/page.tsx");
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /loadCourseGate\(supabase, id\)/);
  assert.match(page, /case "not_found":\s*notFound\(\)/);
  assert.match(page, /case "coming_soon":\s*return <CourseComingSoonScreen/);
  assert.match(page, /force-dynamic/);
  const client = read("src/app/cursos/[id]/course-detail-client.tsx");
  assert.match(client, /^"use client"/);
  assert.match(client, /if \(!previewVisibility\) query = query\.eq\("status", "published"\)/);
  assert.doesNotMatch(client, /from\("lesson_progress"\)\s*\.(upsert|delete)/);
  assert.match(client, /setLessonProgressAction/);
});

// ---------------------------------------------------------------------------------------------------------------
// Progreso (4, 10)
// ---------------------------------------------------------------------------------------------------------------

function loadProgressAction({ access, lessonCourseStatus = "published", academiaAvailable = true }) {
  const writes = [];
  const supabase = {
    from(table) {
      const state = { table };
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() {
          return { data: { id: LESSON_ID, is_active: true, course_modules: { is_active: true, courses: { id: COURSE_ID, status: lessonCourseStatus } } }, error: null };
        },
        upsert(row) { writes.push({ table, op: "upsert", row }); return Promise.resolve({ error: null }); },
        delete() { writes.push({ table, op: "delete" }); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; },
      };
      return builder;
    },
  };
  const accessModule = loadTs("src/lib/academy/access.ts", {
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access, error: null }) },
    "@/lib/features/server": { isFeatureAvailable: async () => academiaAvailable },
  });
  const actions = loadTs("src/app/cursos/actions.ts", {
    "@/lib/academy/access": accessModule,
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access, error: null }) },
    "@/utils/supabase/server": { createClient: async () => supabase },
  });
  return { actions, writes };
}

test("progreso: se registra en cursos publicados con el user_id de la sesión", async () => {
  const { actions, writes } = loadProgressAction({ access: accessSnapshot() });
  const result = await actions.setLessonProgressAction(LESSON_ID, true);
  assert.deepEqual(result, { success: true, completed: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].row.user_id, "user-1");
});

test("progreso: un curso en preparación, oculto o con Academia apagada no registra nada nuevo", async () => {
  for (const status of ["coming_soon", "hidden", "draft"]) {
    const { actions, writes } = loadProgressAction({ access: accessSnapshot(), lessonCourseStatus: status });
    const result = await actions.setLessonProgressAction(LESSON_ID, true);
    assert.equal(result.success, false, status);
    assert.deepEqual(writes, [], status);
    const undo = await actions.setLessonProgressAction(LESSON_ID, false);
    assert.equal(undo.success, false, status);
    assert.deepEqual(writes, [], `${status} no borra progreso histórico`);
  }
  const off = loadProgressAction({ access: accessSnapshot(), academiaAvailable: false });
  assert.equal((await off.actions.setLessonProgressAction(LESSON_ID, true)).success, false);
  assert.deepEqual(off.writes, []);
  const free = loadProgressAction({ access: accessSnapshot({ platform: false }) });
  assert.equal((await free.actions.setLessonProgressAction(LESSON_ID, true)).success, false);
  assert.deepEqual(free.writes, []);
});

test("progreso: el administrador puede registrar en cualquier estado", async () => {
  const { actions, writes } = loadProgressAction({ access: accessSnapshot({ admin: true }), lessonCourseStatus: "coming_soon" });
  assert.equal((await actions.setLessonProgressAction(LESSON_ID, true)).success, true);
  assert.equal(writes.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Administración (8, 9, 10)
// ---------------------------------------------------------------------------------------------------------------

function loadVisibilityAction({ admin = true, currentStatus = "published", updateError = null, learners = 3 } = {}) {
  const calls = [];
  const revalidated = [];
  const supabase = {
    from(table) {
      const state = { table, mode: "select" };
      const builder = {
        select() { return builder; },
        update(values) { state.mode = "update"; calls.push({ table, op: "update", values }); return builder; },
        delete() { calls.push({ table, op: "delete" }); return builder; },
        eq() { return builder; },
        limit() {
          return Promise.resolve({ data: Array.from({ length: learners }, (_, i) => ({ user_id: `u${i}` })), error: null });
        },
        async maybeSingle() {
          if (state.mode === "update") return updateError ? { data: null, error: { message: updateError } } : { data: { id: COURSE_ID, status: calls.at(-1).values.status }, error: null };
          return { data: { id: COURSE_ID, status: currentStatus, course_kind: "course" }, error: null };
        },
      };
      return builder;
    },
  };
  const actions = loadTs("src/app/admin/cursos/actions.ts", {
    "next/cache": { revalidatePath: (route, type) => revalidated.push(type ? `${route}:${type}` : route) },
    "@supabase/supabase-js": { createClient: () => { throw new Error("sin service role en tests"); } },
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access: { userId: admin ? "admin-1" : "user-1", capabilities: { accessAdmin: admin } }, error: null }) },
    "@/utils/supabase/server": { createClient: async () => supabase },
  });
  return { actions, calls, revalidated };
}

test("admin: cambia la visibilidad, informa alumnos afectados e invalida las cachés del catálogo", async () => {
  const { actions, calls, revalidated } = loadVisibilityAction();
  const result = await actions.updateCourseVisibilityAction(COURSE_ID, "coming_soon");
  assert.equal(result.success, true);
  assert.equal(result.visibility, "coming_soon");
  assert.equal(result.label, "En preparación");
  assert.equal(result.learnerCount, 3);
  assert.deepEqual(calls.filter((c) => c.op === "update").map((c) => [c.table, c.values]), [["courses", { status: "coming_soon" }]]);
  for (const route of ["/admin/cursos", "/cursos:layout", "/talleres", "/academia", "/"]) {
    assert.ok(revalidated.includes(route), `revalida ${route}`);
  }
});

test("admin: publicar y ocultar persisten únicamente la columna status", async () => {
  for (const next of ["published", "hidden"]) {
    const { actions, calls } = loadVisibilityAction({ currentStatus: next === "published" ? "hidden" : "published" });
    assert.equal((await actions.updateCourseVisibilityAction(COURSE_ID, next)).success, true);
    const updates = calls.filter((c) => c.op === "update");
    assert.equal(updates.length, 1);
    assert.deepEqual(Object.keys(updates[0].values), ["status"]);
  }
});

test("un usuario común no puede modificar la visibilidad ni consultar el impacto", async () => {
  const { actions, calls, revalidated } = loadVisibilityAction({ admin: false });
  const result = await actions.updateCourseVisibilityAction(COURSE_ID, "published");
  assert.equal(result.success, false);
  assert.match(result.error, /permiso/);
  const impact = await actions.getCourseVisibilityImpactAction(COURSE_ID);
  assert.equal(impact.success, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(revalidated, []);
});

test("entradas inválidas se rechazan antes de tocar la base", async () => {
  const { actions, calls } = loadVisibilityAction();
  assert.equal((await actions.updateCourseVisibilityAction("no-es-uuid", "published")).success, false);
  assert.equal((await actions.updateCourseVisibilityAction(COURSE_ID, "draft")).success, false);
  assert.equal((await actions.updateCourseVisibilityAction(COURSE_ID, "'; drop table courses; --")).success, false);
  assert.deepEqual(calls, []);
});

test("inscripciones y progreso se conservan: la acción nunca borra ni modifica lesson_progress", async () => {
  const { actions, calls } = loadVisibilityAction();
  await actions.updateCourseVisibilityAction(COURSE_ID, "hidden");
  assert.equal(calls.some((c) => c.table === "lesson_progress"), false);
  assert.equal(calls.some((c) => c.op === "delete"), false);
  const source = read("src/app/admin/cursos/actions.ts");
  const visibilityBlock = source.slice(source.indexOf("export async function updateCourseVisibilityAction"), source.indexOf("export async function deleteCourseAction"));
  assert.doesNotMatch(visibilityBlock, /\.delete\(|lesson_progress"\)\s*\.(delete|update)/);
});

test("advertencia de alumnos: solo al bloquear, con alumnos, y aclara que no se borra nada", () => {
  const text = visibility.describeVisibilityImpact(12, "coming_soon");
  assert.match(text, /12 alumnos/);
  assert.match(text, /temporalmente/);
  assert.match(text, /no se borran/);
  assert.equal(visibility.describeVisibilityImpact(1, "hidden").startsWith("1 alumno ya tiene"), true);
  assert.equal(visibility.describeVisibilityImpact(0, "hidden"), null);
  assert.equal(visibility.describeVisibilityImpact(5, "published"), null);
});

test("el formulario guarda la visibilidad por Server Action y el listado muestra la insignia", () => {
  const form = read("src/components/admin/course-form.tsx");
  assert.match(form, /updateCourseVisibilityAction\(finalId, visibility\)/);
  assert.match(form, /getCourseVisibilityImpactAction/);
  assert.match(form, /const \{ visibility, \.\.\.courseFields \} = formData/);
  assert.doesNotMatch(form, /status: formData/);
  assert.match(form, /insert\(\[\{ \.\.\.payload, status: "hidden" \}\]\)/, "un curso nuevo nace oculto");
  assert.match(form, /CourseVisibilitySelector/);
  const table = read("src/components/admin/courses-table.tsx");
  assert.match(table, /CourseVisibilityBadge status=\{course\.status\}/);

  const selector = renderToStaticMarkup(h(loadTs("src/components/admin/course-visibility.tsx").CourseVisibilitySelector, { value: "coming_soon", onChange() {} }));
  for (const label of ["Publicado", "En preparación", "Oculto"]) assert.match(selector, new RegExp(label));
  assert.match(selector, /type="radio"/);
  const badge = (status) => renderToStaticMarkup(h(loadTs("src/components/admin/course-visibility.tsx").CourseVisibilityBadge, { status }));
  assert.match(badge("published"), /Publicado/);
  assert.match(badge("coming_soon"), /En preparación/);
  assert.match(badge("draft"), /Oculto/);
  assert.match(badge("archived"), /Oculto/);
});

// ---------------------------------------------------------------------------------------------------------------
// Inicio, buscador, recomendaciones (13)
// ---------------------------------------------------------------------------------------------------------------

test("Inicio: «continuar aprendiendo» ignora cursos no publicados pero no pierde su progreso", () => {
  const row = (id, status, at) => ({ completed_at: at, lessons: { course_modules: { courses: { id, title: id, slug: id, thumbnail_url: null, status } } } });
  const picked = continueLearning.pickContinueLearningCourse([
    row("viejo", "published", "2026-10-01T00:00:00Z"),
    row("pronto", "coming_soon", "2026-10-20T00:00:00Z"),
    row("oculto", "hidden", "2026-10-21T00:00:00Z"),
    row("borrador", "draft", "2026-10-22T00:00:00Z"),
  ]);
  assert.equal(picked.courseId, "viejo");
  assert.equal(picked.startedCourses, 1);
  assert.equal(continueLearning.pickContinueLearningCourse([row("pronto", "coming_soon", "2026-10-20T00:00:00Z")]), null);
  assert.equal(continueLearning.pickContinueLearningCourse([row("sin-estado", undefined, "2026-10-20T00:00:00Z")]), null);

  const home = read("src/components/home/home-dashboard.tsx");
  assert.match(home, /courses \( id, title, thumbnail_url, slug, status \)/);
  assert.match(home, /\.from\("courses"\)[\s\S]{0,200}\.eq\("status", "published"\)/);
});

test("buscador y recomendaciones solo ofrecen cursos publicados", () => {
  const search = read("src/components/search/GlobalSearch.tsx");
  assert.match(search, /\.from\("courses"\)[\s\S]{0,200}\.eq\("status", "published"\)/);
  assert.doesNotMatch(search, /coming_soon|"status", "hidden"/);

  const roadmap = read("src/components/admin/RoadmapForm.tsx");
  assert.match(roadmap, /\.eq\("status", "published"\)/);

  const stampy = read("src/lib/stampy/lesson-recommendations.ts");
  assert.match(stampy, /courseStatus !== "published"/);
  assert.match(stampy, /\.eq\("course_modules\.courses\.status", "published"\)/);
  const indexer = read("src/lib/stampy/knowledge-indexer.ts");
  assert.match(indexer, /\.from\("courses"\)[\s\S]{0,120}\.eq\("status", "published"\)/);

  const actions = read("src/app/stampy/actions.ts");
  assert.match(actions, /loadLessonGate\(supabase, lessonId\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// Presentación y responsive (3, 14)
// ---------------------------------------------------------------------------------------------------------------

test("tarjeta en preparación: portada, candado, insignia, título, descripción y «Próximamente»", () => {
  const { ComingSoonCourseCard, ComingSoonSection, CourseComingSoonScreen } = loadTs("src/components/academy/coming-soon.tsx", {
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => h("a", { href, ...rest }, children) },
  });
  const html = renderToStaticMarkup(h(ComingSoonCourseCard, { course: { id: "c1", title: "Resina avanzada", description: "Todo sobre impresión en resina", thumbnail_url: "https://cdn.test/r.png", course_kind: "course" } }));
  assert.match(html, /Resina avanzada/);
  assert.match(html, /Todo sobre impresión en resina/);
  assert.match(html, /src="https:\/\/cdn\.test\/r\.png"/);
  assert.match(html, /En preparación/);
  assert.match(html, /Próximamente/);
  assert.match(html, /<svg[^>]*lucide-lock/);
  assert.doesNotMatch(html, /<a /, "no es un enlace: no hay contenido al que entrar");
  assert.doesNotMatch(html, /blur|grayscale|opacity-50/, "sin desenfoque ni tarjeta gris");
  assert.match(html, /stampa-orange/);

  const section = renderToStaticMarkup(h(ComingSoonSection, { courses: [{ id: "c1", title: "A" }, { id: "c2", title: "B" }] }));
  assert.match(section, /Próximamente en Academia/);
  assert.match(section, /grid-cols-1[^"]*sm:grid-cols-2[^"]*lg:grid-cols-3/);
  assert.equal(renderToStaticMarkup(h(ComingSoonSection, { courses: [] })), "");

  const screen = renderToStaticMarkup(h(CourseComingSoonScreen, { course: { title: "Resina avanzada", description: "d", courseKind: "workshop" } }));
  assert.match(screen, /en preparación/);
  assert.match(screen, /href="\/talleres"/);
  assert.match(screen, /href="\/academia"/);
  assert.doesNotMatch(screen, /lecci|módulo|video/i);
});

test("responsive: sin ancho fijo, áreas táctiles ≥ 44 px en acciones y grillas que colapsan a una columna", () => {
  const source = read("src/components/academy/coming-soon.tsx");
  assert.doesNotMatch(source, /\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/);
  assert.match(source, /min-h-11/);
  assert.match(source, /grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(source, /max-w-3xl/);
  const selector = read("src/components/admin/course-visibility.tsx");
  assert.match(selector, /grid-cols-1 gap-3 sm:grid-cols-3/);
  assert.match(selector, /min-h-11/);
});

// ---------------------------------------------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------------------------------------------

test("migration de visibilidad: aditiva, restrictiva, sin tocar datos ni debilitar RLS", () => {
  const sql = read("supabase/migrations/20261026120000_academy_course_visibility.sql").replace(/\r\n/g, "\n");
  const code = sql.replace(/--.*$/gm, "");

  assert.doesNotMatch(code, /\bupdate\s+public\.courses\b|\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b|\balter\s+table\s+public\.\w+\s+(drop\s+column|disable)/i);
  assert.doesNotMatch(code, /add column/i, "reutiliza courses.status: sin columnas nuevas");
  assert.match(code, /not valid/i, "el CHECK no revalida filas existentes");
  assert.match(code, /'draft', 'published', 'archived', 'coming_soon', 'hidden'/);
  assert.match(code, /status::text/);

  for (const table of ["courses", "course_modules", "lessons"]) {
    assert.match(code, new RegExp(`on public\\.${table} as restrictive for select`), table);
  }
  for (const op of ["insert", "update", "delete"]) {
    assert.match(code, new RegExp(`on public\\.lesson_progress as restrictive for ${op}`), op);
  }
  assert.doesNotMatch(code, /on public\.lesson_progress as restrictive for select/, "el historial de progreso no se restringe");
  assert.match(code, /lesson_resources_open_course_restrict_select/);
  assert.match(code, /lesson_transcripts_open_course_restrict_select/);
  assert.match(code, /stampy_knowledge_chunks_open_course_restrict_select/);
  assert.match(code, /academy_chunk_is_open\(chunk\.course_id, chunk\.lesson_id\)/);

  const permissive = [...code.matchAll(/create policy (\w+)\s+on public\.(\w+) for (\w+)/g)].map((m) => `${m[2]}.${m[1]}`);
  assert.deepEqual(permissive, ["courses.courses_coming_soon_catalog_select"], "la única policy permissive nueva es la ficha «Próximamente»");
  assert.match(code, /courses_coming_soon_catalog_select[\s\S]{0,200}has_platform_access\(auth\.uid\(\)\)/);

  assert.match(code, /academy_chunk_is_open|academy_course_is_open/);
  assert.equal((code.match(/security definer\s+set search_path = ''/g) ?? []).length >= 4, true);
  assert.match(code, /courses_status_admin_guard/);
  assert.match(code, /Missing dependency/);
  assert.match(code, /notify pgrst, 'reload schema'/);
  // Idempotente: todo create es "or replace", "if not exists" o va precedido de drop ... if exists.
  assert.equal((code.match(/create policy/g) ?? []).length <= (code.match(/drop policy if exists/g) ?? []).length + 6, true);
  assert.match(code, /drop trigger if exists courses_status_admin_guard/);
});

test("migration de visibilidad: CHECK acotado a status, helpers ejecutables por anon solo donde las policies lo exigen", () => {
  const sql = read("supabase/migrations/20261026120000_academy_course_visibility.sql").replace(/\r\n/g, "\n");
  const code = sql.replace(/--.*$/gm, "");

  // Solo reemplaza CHECK de la columna status (no course_kind, level ni CHECK multi-columna).
  assert.match(code, /con\.conkey = array\[att\.attnum\]/);
  assert.doesNotMatch(code, /ilike\s+'%status%'/);

  // Las policies que aplican a anon usan helpers con EXECUTE para anon; el de chunks (policy solo authenticated) no.
  for (const helper of ["academy_course_is_open(uuid)", "academy_module_is_open(uuid)", "academy_lesson_is_open(uuid)"]) {
    const escaped = helper.replace(/[()]/g, "\\$&");
    assert.match(code, new RegExp(`grant execute on function public\\.${escaped} to anon, authenticated, service_role`), helper);
  }
  assert.match(code, /grant execute on function public\.academy_chunk_is_open\(uuid, uuid\) to authenticated, service_role/);
  assert.match(code, /revoke all on function public\.academy_chunk_is_open\(uuid, uuid\) from public, anon/);
  assert.doesNotMatch(code, /grant execute on function public\.is_admin|grant execute on function public\.has_platform_access/);

  // No elimina ni renombra sobrecargas de Stampy; las no cubiertas se avisan.
  assert.doesNotMatch(code, /drop function[^;]*match_stampy_knowledge_chunks/i);
  assert.match(code, /p\.pronargs <> 3/);
});

test("feature flags: la migration original sigue sin insertar filas ni restringir nada", () => {
  const sql = read("supabase/migrations/20261024120000_platform_feature_flags.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\binsert\s+into\b/i);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /public\.is_admin\(auth\.uid\(\)\)/);
  assert.doesNotMatch(sql, /grant (all|delete)[^;]+to (anon|authenticated)/i);
  assert.match(sql, /grant select on table public\.platform_feature_flags to anon, authenticated/);
});
