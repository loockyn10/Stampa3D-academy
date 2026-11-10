// Regresión: la consulta de clases recomendadas de Stampy filtraba por `lessons.is_published`, una columna que no existe
// ("column lessons.is_published does not exist"). El error se tragaba y Stampy nunca recomendaba ninguna clase.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const lessons = loadTs("src/lib/stampy/lesson-recommendations.ts");

/** Cliente de Supabase falso: registra el select y los filtros, y responde con las filas dadas (sin columna is_published). */
function fakeSupabase(rows, { lessonsError = null } = {}) {
  const calls = { select: "", eq: [], tables: [] };
  const from = (table) => {
    calls.tables.push(table);
    const builder = {
      select(columns) {
        if (table === "lessons") calls.select = columns;
        return builder;
      },
      eq(column, value) {
        if (table === "lessons") calls.eq.push([column, value]);
        return builder;
      },
      in: () => builder,
      limit: () => builder,
      then(resolve) {
        if (table === "lessons") return resolve({ data: lessonsError ? null : rows, error: lessonsError });
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  };
  return { client: { from }, calls };
}

const lessonRow = (overrides = {}) => ({
  id: "lesson-primera-capa",
  title: "Clase 5 - Primera Capa y Orientación",
  description: "Cómo lograr una primera capa perfecta y orientar la pieza para que no se despegue.",
  video_url: "https://iframe.mediadelivery.net/embed/1/abc",
  is_active: true,
  is_ai_recommendable: true,
  ai_summary: null,
  ai_topics: [],
  ai_problems: [],
  ai_level: null,
  lesson_transcripts: null,
  course_modules: { id: "module-1", is_active: true, courses: { id: "course-1", slug: "fundamentos", title: "Fundamentos Express", status: "published", course_kind: "course" } },
  ...overrides,
});

const INTENT = { type: "course_recommendation", confidence: 0.95, matchedTerms: ["que clase"], focus: [] };
const QUERY = "Se me despegan las esquinas de la pieza en la primera capa. ¿Qué clase de Academia me puede ayudar?";

test("la consulta usa solo columnas que existen: no selecciona ni filtra por is_published", async () => {
  const { client, calls } = fakeSupabase([lessonRow()]);
  await lessons.findStampyLessonRecommendations({ supabase: client, query: QUERY, intent: INTENT, limit: 2 });
  assert.doesNotMatch(calls.select, /is_published/);
  assert.ok(calls.eq.every(([column]) => !/is_published/.test(column)));
});

test("solo se piden clases disponibles para el alumno: clase y módulo activos, curso publicado y recomendable por la IA", async () => {
  const { client, calls } = fakeSupabase([lessonRow()]);
  await lessons.findStampyLessonRecommendations({ supabase: client, query: QUERY, intent: INTENT, limit: 2 });
  const filters = Object.fromEntries(calls.eq.map(([column, value]) => [column, value]));
  assert.equal(filters["is_active"], true);
  assert.equal(filters["is_ai_recommendable"], true);
  assert.equal(filters["course_modules.is_active"], true);
  assert.equal(filters["course_modules.courses.status"], "published");
});

test("con filas reales (sin columna is_published) recomienda la clase que coincide con el problema", async () => {
  const { client } = fakeSupabase([
    lessonRow(),
    lessonRow({ id: "lesson-otra", title: "Clase 6 - Qué slicer usar", description: "Comparativa de slicers para elegir según tu impresora." }),
  ]);
  const result = await lessons.findStampyLessonRecommendations({ supabase: client, query: QUERY, intent: INTENT, limit: 2 });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Clase 5 - Primera Capa y Orientación");
  assert.equal(result[0].href, "/cursos/fundamentos");
  assert.ok(result[0].score >= 5);
});

test("se respetan los filtros de disponibilidad también al ordenar: curso no publicado, módulo o clase inactivos o no recomendable no salen", async () => {
  const hiddenCourse = lessonRow({ course_modules: { id: "m", is_active: true, courses: { id: "c", slug: "oculto", title: "Oculto", status: "hidden", course_kind: "course" } } });
  const inactiveModule = lessonRow({ course_modules: { id: "m", is_active: false, courses: { id: "c", slug: "x", title: "X", status: "published", course_kind: "course" } } });
  const inactiveLesson = lessonRow({ is_active: false });
  const notRecommendable = lessonRow({ is_ai_recommendable: false });
  const { client } = fakeSupabase([hiddenCourse, inactiveModule, inactiveLesson, notRecommendable]);
  const result = await lessons.findStampyLessonRecommendations({ supabase: client, query: QUERY, intent: INTENT, limit: 2 });
  assert.deepEqual(result, []);
});

test("el umbral de relevancia sigue vigente: una clase que no se parece a la consulta no se recomienda", async () => {
  const { client } = fakeSupabase([lessonRow({ title: "Presupuestos para clientes", description: "Cómo armar un presupuesto profesional para tus clientes." })]);
  const result = await lessons.findStampyLessonRecommendations({ supabase: client, query: QUERY, intent: INTENT, limit: 2 });
  assert.deepEqual(result, []);
});

test("si la consulta falla por cualquier motivo, Stampy sigue respondiendo (lista vacía) en lugar de romperse", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    const { client } = fakeSupabase([], { lessonsError: { message: 'column lessons.x does not exist' } });
    const result = await lessons.findStampyLessonRecommendations({ supabase: client, query: QUERY, intent: INTENT, limit: 2 });
    assert.deepEqual(result, []);
  } finally {
    console.error = original;
  }
});

test("ningún archivo de Stampy vuelve a referirse a lessons.is_published", () => {
  const dir = path.join(process.cwd(), "src", "lib", "stampy");
  const offenders = fs
    .readdirSync(dir, { recursive: true })
    .filter((file) => String(file).endsWith(".ts"))
    .filter((file) => /is_published|isPublished/.test(fs.readFileSync(path.join(dir, String(file)), "utf8")));
  assert.deepEqual(offenders, []);
  // La visibilidad de Academia vive en courses.status (fuente única); no hay columna de publicación por clase.
  assert.match(fs.readFileSync(path.join(process.cwd(), "src/lib/academy/visibility.ts"), "utf8"), /courses\.status/);
});
