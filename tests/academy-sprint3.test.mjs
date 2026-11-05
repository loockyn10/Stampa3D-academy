// Sprint 3 — Academia: catálogo, acceso, reproducción (Bunny firmado), progreso, continuar, navegación, recursos,
// cursos despublicados, clases sin contenido, errores de carga y permisos de administración. Sin red ni base real.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const video = loadTs("src/lib/academy/video.ts");
const bunny = loadTs("src/lib/academy/bunny-token.ts");
const nav = loadTs("src/lib/academy/lesson-navigation.ts");
const stats = loadTs("src/lib/academy/course-stats.ts");
const catalog = loadTs("src/lib/academy/catalog.ts");
const routes = loadTs("src/lib/auth/route-policy.ts");

const COURSE_ID = "c0000000-0000-4000-8000-000000000001";
const LESSON_ID = "10000000-0000-4000-8000-000000000001";

function accessSnapshot({ platform = true, admin = false, authenticated = true } = {}) {
  return { authenticated, userId: authenticated ? "user-1" : null, capabilities: { accessPlatform: platform || admin, accessAdmin: admin } };
}

/** Server action with in-memory Supabase: lesson row (gate) and its video_url. */
function loadPlayback({ access = accessSnapshot(), status = "published", lessonActive = true, moduleActive = true, videoUrl = null, env = {} } = {}) {
  const supabase = {
    from(table) {
      const builder = {
        select(columns) { builder.columns = columns; return builder; },
        eq() { return builder; },
        async maybeSingle() {
          if (table === "lessons" && builder.columns === "video_url") return { data: { video_url: videoUrl }, error: null };
          return { data: { id: LESSON_ID, is_active: lessonActive, course_modules: { is_active: moduleActive, courses: { id: COURSE_ID, status } } }, error: null };
        },
      };
      return builder;
    },
  };
  const accessModule = loadTs("src/lib/academy/access.ts", {
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access, error: null }) },
    "@/lib/features/server": { isFeatureAvailable: async () => true },
  });
  const previous = { ...process.env };
  Object.assign(process.env, env);
  const actions = loadTs("src/app/cursos/actions.ts", {
    "@/lib/academy/access": accessModule,
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access, error: null }) },
    "@/utils/supabase/server": { createClient: async () => supabase },
  });
  return {
    run: async () => {
      try {
        return await actions.getLessonPlaybackAction(LESSON_ID);
      } finally {
        for (const key of Object.keys(env)) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
      }
    },
  };
}

const client = read("src/app/cursos/[id]/course-detail-client.tsx");

// 1. Catálogo ------------------------------------------------------------------------------------------------------

test("1. catálogo: solo publicados y próximamente; los conteos ignoran módulos y clases inactivos", () => {
  assert.deepEqual([...catalog.CATALOG_STATUSES], ["published", "coming_soon"]);
  const modules = [
    { is_active: true, lessons: [{ duration_minutes: 10, is_active: true }, { duration_minutes: 99, is_active: false }] },
    { is_active: false, lessons: [{ duration_minutes: 50, is_active: true }] },
    { lessons: [{ duration_minutes: 5 }] },
  ];
  assert.deepEqual(stats.catalogCourseStats(modules), { lessons: 2, minutes: 15 });
  assert.deepEqual(stats.catalogCourseStats(null), { lessons: 0, minutes: 0 });
  for (const file of ["src/app/cursos/page.tsx", "src/app/talleres/page.tsx", "src/app/academia/page.tsx"]) {
    const source = read(file);
    assert.match(source, /is_active,\s*lessons \( id, duration_minutes, is_active \)/, file);
    assert.doesNotMatch(source, /setError\(fetchErr\.message\)/, `${file}: no raw Supabase text`);
  }
  assert.match(read("src/components/cards/course-card.tsx"), /"Clases en preparación"/);
});

// 2–3. Acceso a cursos y Free/Premium --------------------------------------------------------------------------------

test("2/3. acceso: sin sesión → login con returnTo; Free → pantalla de acceso; Premium entra", () => {
  assert.deepEqual(routes.anonymousRoute("/cursos/mi-curso", ""), { redirect: "/login?returnTo=%2Fcursos%2Fmi-curso" });
  assert.deepEqual(routes.authenticatedRoute({ pathname: "/cursos/mi-curso", search: "", returnToParam: null, hasAccess: false, needsOnboarding: false }), { redirect: "/sin-acceso" });
  assert.equal(routes.authenticatedRoute({ pathname: "/cursos/mi-curso", search: "", returnToParam: null, hasAccess: true, needsOnboarding: false }), null);
  const page = read("src/app/cursos/[id]/page.tsx");
  assert.match(page, /redirect\(loginPathFor\(`\/cursos\/\$\{encodeURIComponent\(id\)\}`\)\)/);
  assert.match(page, /case "no_membership":\s*redirect\("\/sin-acceso"\)/);
});

// 4. Reproducción ----------------------------------------------------------------------------------------------------

test("4a. video: Bunny, YouTube, Vimeo y archivo se normalizan; lo demás nunca llega a un iframe", () => {
  const ok = (raw, provider, embedUrl) => {
    const result = video.resolveLessonVideo(raw);
    assert.equal(result.provider, provider, raw);
    if (embedUrl) assert.equal(result.embedUrl, embedUrl, raw);
    return result;
  };
  const b = ok("https://iframe.mediadelivery.net/embed/123456/aa11-bb22?autoplay=false&token=OLD&expires=1", "bunny", "https://iframe.mediadelivery.net/embed/123456/aa11-bb22?autoplay=false");
  assert.equal(b.videoId, "aa11-bb22");
  ok("https://iframe.mediadelivery.net/play/123456/aa11-bb22", "bunny", "https://iframe.mediadelivery.net/embed/123456/aa11-bb22");
  ok('<iframe src="https://player.mediadelivery.net/embed/9/vid-1?autoplay=true&amp;loop=false" allowfullscreen></iframe>', "bunny", "https://player.mediadelivery.net/embed/9/vid-1?autoplay=true&loop=false");
  ok("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&start=42");
  ok("https://youtu.be/dQw4w9WgXcQ", "youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
  ok("https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
  ok("https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
  ok("https://vimeo.com/123456789/abcdef1234", "vimeo", "https://player.vimeo.com/video/123456789?h=abcdef1234");
  ok("https://player.vimeo.com/video/123456789?h=ff00", "vimeo", "https://player.vimeo.com/video/123456789?h=ff00");
  ok("https://cdn.example.com/clase.mp4", "file", "https://cdn.example.com/clase.mp4");
  assert.equal(video.resolveLessonVideo("").provider, "none");
  assert.equal(video.resolveLessonVideo(null).provider, "none");
  for (const bad of ["javascript:alert(1)", "http://iframe.mediadelivery.net/embed/1/x", "https://evil.example/embed", "https://iframe.mediadelivery.net/embed/abc/x", "https://www.youtube.com/watch?v=short", "no es un link", '<iframe src="javascript:alert(1)">']) {
    assert.equal(video.resolveLessonVideo(bad).provider, "invalid", bad);
  }
});

test("4b. Bunny firmado: SHA256_HEX(clave + videoId + expires), expires en segundos, solo en el servidor", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const signed = new URL(bunny.signBunnyEmbedUrl({ embedUrl: "https://iframe.mediadelivery.net/embed/1/vid?autoplay=false", videoId: "vid", tokenKey: "k3y", now, ttlSeconds: 3600 }));
  const expires = String(Math.floor(now.getTime() / 1000) + 3600);
  assert.equal(signed.searchParams.get("expires"), expires);
  assert.equal(signed.searchParams.get("token"), crypto.createHash("sha256").update(`k3yvid${expires}`).digest("hex"));
  assert.equal(signed.searchParams.get("autoplay"), "false");
  assert.equal(bunny.BUNNY_EMBED_TOKEN_TTL_SECONDS, 4 * 60 * 60);
  // The key never reaches client code.
  assert.doesNotMatch(client, /BUNNY_STREAM_TOKEN_KEY|bunny-token/);
  assert.doesNotMatch(client, /src=\{url\}|activeLesson\.video_url/, "the iframe never uses the raw database value");
});

test("4c. la URL de reproducción la decide el servidor con la misma barrera que el progreso", async () => {
  const bunnyUrl = "https://iframe.mediadelivery.net/embed/123/vid-1";
  const plain = await loadPlayback({ videoUrl: bunnyUrl }).run();
  assert.deepEqual(plain, { ok: true, provider: "bunny", src: bunnyUrl });

  const signed = await loadPlayback({ videoUrl: bunnyUrl, env: { BUNNY_STREAM_TOKEN_KEY: "secret" } }).run();
  assert.equal(signed.ok, true);
  assert.match(signed.src, /^https:\/\/iframe\.mediadelivery\.net\/embed\/123\/vid-1\?token=[0-9a-f]{64}&expires=\d+$/);

  const youtube = await loadPlayback({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", env: { BUNNY_STREAM_TOKEN_KEY: "secret" } }).run();
  assert.deepEqual(youtube, { ok: true, provider: "youtube", src: "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0" });

  // 3. Free never receives a playback URL.
  const free = await loadPlayback({ access: accessSnapshot({ platform: false }), videoUrl: bunnyUrl }).run();
  assert.equal(free.ok, false);
  const anon = await loadPlayback({ access: accessSnapshot({ authenticated: false }), videoUrl: bunnyUrl }).run();
  assert.equal(anon.ok, false);
});

// 5. Progreso --------------------------------------------------------------------------------------------------------

test("5. progreso: lo escribe el servidor y un fallo se muestra al alumno (no solo en la consola)", () => {
  assert.match(client, /setLessonProgressAction\(activeLesson\.id, true\)/);
  assert.match(client, /setProgressError\(result\.error\)/);
  assert.match(client, /role="alert"[^>]*>\s*<AlertCircle[^>]*\/> \{progressError\}/);
  assert.doesNotMatch(client, /console\.error\("Error al (guardar|borrar) progreso/);
  // The % only counts lessons that exist in the course.
  assert.match(client, /const completedCount = allLessons\.filter\(\(lesson\) => progress\[lesson\.id\]\)\.length;/);
});

// 6. Continuar -------------------------------------------------------------------------------------------------------

const modules = [{ id: "m2", sort_order: 2 }, { id: "m1", sort_order: 1 }, { id: "m0", sort_order: 0 }];
const lessonsByModule = {
  m0: [],
  m1: [{ id: "l2", module_id: "m1", sort_order: 2 }, { id: "l1", module_id: "m1", sort_order: 1 }],
  m2: [{ id: "l3", module_id: "m2", sort_order: 1 }],
};

test("6. continuar: abre la clase pedida, si no la primera pendiente, si no la primera", () => {
  const ordered = nav.orderLessons(modules, lessonsByModule);
  assert.deepEqual(ordered.map((l) => l.id), ["l1", "l2", "l3"], "module order, then lesson order; empty module skipped");
  assert.equal(nav.pickStartLesson(ordered, new Set()).id, "l1");
  assert.equal(nav.pickStartLesson(ordered, new Set(["l1"])).id, "l2", "resume");
  assert.equal(nav.pickStartLesson(ordered, new Set(["l1", "l2", "l3"])).id, "l1", "finished course restarts");
  assert.equal(nav.pickStartLesson(ordered, new Set(["l1"]), "l3").id, "l3", "?clase= wins");
  assert.equal(nav.pickStartLesson(ordered, new Set(), "otra").id, "l1", "a lesson of another course is ignored");
  assert.match(client, /get\("clase"\)/);
  assert.match(client, /url\.searchParams\.set\("clase", activeLessonId\)/);
  assert.match(client, /window\.history\.replaceState/);
  // Home % uses the same lessons the course shows.
  const home = read("src/components/home/home-dashboard.tsx");
  assert.match(home, /\.eq\("course_modules\.is_active", true\)\s*\.eq\("is_active", true\)/);
  assert.doesNotMatch(home, /from\("lessons"\)[\s\S]{0,200}is_published/);
});

// 7. Navegación ------------------------------------------------------------------------------------------------------

test("7. navegación: anterior/siguiente entre módulos, numeración por posición, temario accesible en mobile", () => {
  const ordered = nav.orderLessons(modules, lessonsByModule);
  assert.deepEqual(nav.lessonNeighbors(ordered, "l2").previous.id, "l1");
  assert.deepEqual(nav.lessonNeighbors(ordered, "l2").next.id, "l3", "crosses to the next module");
  assert.equal(nav.lessonNeighbors(ordered, "l1").previous, null);
  assert.equal(nav.lessonNeighbors(ordered, "l3").next, null);
  assert.equal(nav.lessonNeighbors(ordered, "l3").position, 3);
  assert.equal(nav.completedInCourse(ordered, new Set(["l1", "borrada"])), 1);
  assert.match(client, /Módulo \{moduleIndex \+ 1\}: \{m\.title\}/);
  assert.match(client, /\{lessonIndex \+ 1\}\. \{lesson\.title\}/);
  assert.match(client, /Anterior/);
  assert.match(client, /href="#contenido-del-curso"/);
  assert.match(client, /onClick=\{\(\) => openLesson\(lesson, true\)\}/, "choosing from the outline brings the player into view");
  assert.match(client, /aria-expanded=\{isOpen\}/);
});

// 8. Recursos --------------------------------------------------------------------------------------------------------

test("8. recursos: se abren dentro del clic (sin bloqueo de popups), con URL firmada y error visible", () => {
  assert.match(client, /const tab = window\.open\("", "_blank"\);/);
  assert.match(client, /tab\.opener = null;/);
  assert.match(client, /setResourceError\("No pudimos abrir el recurso/);
  const storage = read("src/lib/storage.ts");
  assert.match(storage, /createSignedUrl\(path, expiresIn\)/, "private buckets use expiring signed URLs");
});

// 9. Despublicados / inactivos ---------------------------------------------------------------------------------------

test("9. curso despublicado o clase inactiva: sin reproducción ni progreso para alumnos", async () => {
  for (const status of ["coming_soon", "hidden", "draft"]) {
    assert.equal((await loadPlayback({ status, videoUrl: "https://youtu.be/dQw4w9WgXcQ" }).run()).ok, false, status);
  }
  assert.equal((await loadPlayback({ lessonActive: false, videoUrl: "https://youtu.be/dQw4w9WgXcQ" }).run()).ok, false, "inactive lesson");
  assert.equal((await loadPlayback({ moduleActive: false, videoUrl: "https://youtu.be/dQw4w9WgXcQ" }).run()).ok, false, "inactive module");
  const admin = await loadPlayback({ access: accessSnapshot({ admin: true }), status: "coming_soon", lessonActive: false, videoUrl: "https://youtu.be/dQw4w9WgXcQ" }).run();
  assert.equal(admin.ok, true, "admin preview still plays");
});

// 10. Sin contenido ---------------------------------------------------------------------------------------------------

test("10. clases sin video y cursos sin clases tienen un mensaje propio", async () => {
  assert.deepEqual(await loadPlayback({ videoUrl: "" }).run(), { ok: true, provider: "none" });
  const broken = await loadPlayback({ videoUrl: "https://evil.example/x" }).run();
  assert.deepEqual(broken, { ok: false, error: "El video de esta clase no está disponible por ahora." });
  assert.equal(nav.pickStartLesson([], new Set()), null);
  assert.match(client, /Esta clase no tiene video\. Revisá la descripción y los recursos\./);
  assert.match(client, /Las clases de este curso se publican pronto\./);
  assert.match(client, /"Este curso todavía no tiene clases"/);
});

// 11. Errores de carga -------------------------------------------------------------------------------------------------

test("11. errores de carga: el curso muestra reintentar (no 'no encontrado') y el video tiene recarga", () => {
  assert.match(client, /if \(loadError\) \{/);
  assert.match(client, /No pudimos cargar el curso/);
  assert.match(client, /setReloadToken\(\(value\) => value \+ 1\)/);
  for (const name of ["modulesError", "lessonsError", "resourcesError", "progressLoadError"]) {
    assert.match(client, new RegExp(`if \\(failed\\(${name}\\)\\)`), name);
  }
  assert.match(client, /Recargar el video/);
  assert.match(client, /Cargando la clase…/);
});

// 12. Administración ---------------------------------------------------------------------------------------------------

test("12. administración: solo admins, y un enlace de video que no se puede reproducir no se guarda", () => {
  assert.deepEqual(routes.adminRoute("/admin/cursos/abc", false), { redirect: "/" });
  assert.equal(routes.adminRoute("/admin/cursos/abc", true), null);
  const actions = read("src/app/admin/cursos/actions.ts");
  assert.ok((actions.match(/!access\.capabilities\.accessAdmin/g) ?? []).length >= 3, "every admin action checks the role");
  assert.equal(video.describeVideoInput(""), null);
  assert.equal(video.describeVideoInput("https://iframe.mediadelivery.net/embed/1/x").ok, true);
  assert.equal(video.describeVideoInput("http://iframe.mediadelivery.net/embed/1/x").ok, false);
  assert.equal(video.describeVideoInput("https://drive.google.com/file/x").ok, false);
  const manager = read("src/components/admin/modules-manager.tsx");
  assert.match(manager, /const videoCheck = describeVideoInput\(lessonFormData\.video_url\);\s*if \(videoCheck && !videoCheck\.ok\) \{\s*setError\(videoCheck\.message\);\s*return;/);
  assert.equal((manager.match(/<VideoInputHint value=\{lessonFormData\.video_url\} \/>/g) ?? []).length, 2);
});
