import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const learning = loadTs("src/lib/academy/continue-learning.ts");
const row = (courseId, completedAt, title = courseId) => ({
  completed_at: completedAt,
  lessons: { course_modules: { courses: { id: courseId, title, slug: `${courseId}-slug`, thumbnail_url: null } } },
});

test("continuar aprendiendo: elige el curso con actividad más reciente, no el primero", () => {
  const picked = learning.pickContinueLearningCourse([
    row("a", "2026-10-01T10:00:00Z"),
    row("a", "2026-10-02T10:00:00Z"),
    row("b", "2026-10-20T10:00:00Z"),
  ]);
  assert.equal(picked.courseId, "b");
  assert.equal(picked.routeId, "b-slug");
  assert.equal(picked.completedLessons, 1);
  assert.equal(picked.startedCourses, 2);
  assert.equal(learning.pickContinueLearningCourse([]), null);
  assert.equal(learning.pickContinueLearningCourse([{ completed_at: null, lessons: null }]), null);
});

test("progreso de curso acotado y sin división por cero", () => {
  assert.equal(learning.courseProgressPercent(3, 0), 0);
  assert.equal(learning.courseProgressPercent(3, 12), 25);
  assert.equal(learning.courseProgressPercent(20, 12), 100);
});

test("Inicio: accesos rápidos requeridos, bloques independientes y datos reales reutilizados", () => {
  const home = read("src/components/home/home-dashboard.tsx");
  for (const href of ["/stampy", "/calculadora", "/explorar-modelos", "/academia", "/mi-taller", "/mi-negocio"]) {
    assert.ok(home.includes(`href: "${href}"`), href);
  }
  assert.match(home, /loadWorkshopSummary\(supabase, user\.id\)/, "reusa el resumen de Mi Taller");
  assert.match(home, /loadBusinessMetricsAction\("month"\)/, "reusa las métricas comerciales");
  assert.match(home, /getVisibleRaffles\(supabase\)/, "reusa la visibilidad pública de sorteos");
  assert.doesNotMatch(home, /\.(insert|update|upsert|delete)\(|\.rpc\(/, "Inicio es solo lectura");
  assert.doesNotMatch(home, /p-8 sm:p-10|text-4xl/, "sin hero gigante");
  assert.match(read("src/app/page.tsx"), /<HomeDashboard \/>/);
});
