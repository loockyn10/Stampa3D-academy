// Análisis ESTÁTICO de supabase/migrations/20261027120000_stampy_knowledge_course_visibility.sql.
// No ejecuta SQL: no hay PostgreSQL de prueba en este entorno (ver tests/beta-access-db.test.mjs para el patrón opt-in).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/20261027120000_stampy_knowledge_course_visibility.sql");
const code = sql.replace(/--.*$/gm, "");

function block(tag) {
  const marker = "$" + tag + "$";
  const start = code.indexOf(marker);
  const end = code.indexOf(marker, start + marker.length);
  assert.ok(start >= 0 && end > start, `bloque ${tag}`);
  return code.slice(start + marker.length, end);
}

test("orden: posterior a las dos migrations anteriores y depende de sus helpers", () => {
  const files = fs.readdirSync(path.join(process.cwd(), "supabase/migrations")).sort();
  const index = (name) => files.findIndex((f) => f.startsWith(name));
  assert.ok(index("20261027120000") > index("20261026120000"));
  assert.ok(index("20261026120000") > index("20261024120000"));
  assert.match(block("stampy_visibility_dependencies"), /academy_course_is_open[\s\S]*academy_lesson_is_open/);
});

test("regla de visibilidad: cursos publicados y solo ellos; sin vínculo solo tipos no académicos", () => {
  const rule = code.match(/function public\.academy_chunk_is_visible[\s\S]*?\$\$;/)[0];
  assert.match(rule, /in \('stampy_context', 'knowledge_document'\)/, "sin curso verificable: solo no académicos");
  assert.doesNotMatch(rule, /'course'|'lesson'|'lesson_transcript'|'module'|'workshop'/, "los tipos académicos no son comodín");
  assert.equal((rule.match(/c\.status::text = 'published'/g) ?? []).length, 2, "lección y módulo verifican published");
  assert.match(rule, /academy_course_is_open\(p_course_id\)/);
  // coherencia entre ids vinculados
  assert.match(rule, /p_module_id is null or m\.id = p_module_id/);
  assert.match(rule, /p_course_id is null or c\.id = p_course_id/);
  assert.doesNotMatch(rule, /coming_soon|hidden|draft|archived/, "bloquea por lista blanca published, no por lista negra");
  assert.match(rule, /security definer\s+set search_path = ''/);
});

test("sobrecarga de 5 argumentos: firma, defaults, retorno y filtros opcionales conservados", () => {
  const fn = block("stampy_visibility_match5");
  assert.match(fn, /query_embedding vector,\s+match_count integer default 8,\s+filter_source_type text default null,\s+filter_course_id uuid default null,\s+filter_lesson_id uuid default null/);
  const returns = fn.match(/returns table \(([\s\S]*?)\)\s+language sql/)[1].replace(/\s+/g, " ").trim();
  assert.equal(
    returns,
    "id uuid, source_type text, source_id uuid, source_key text, title text, content text, route text, category text, tags text[], course_id uuid, module_id uuid, lesson_id uuid, metadata jsonb, similarity double precision",
  );
  assert.match(fn, /stable\s+security definer\s+set search_path to 'public'/);
  assert.match(fn, /skc\.is_active = true/);
  assert.match(fn, /skc\.embedding is not null/);
  assert.match(fn, /filter_source_type is null or skc\.source_type = filter_source_type/);
  assert.match(fn, /filter_course_id is null or skc\.course_id = filter_course_id/);
  assert.match(fn, /filter_lesson_id is null or skc\.lesson_id = filter_lesson_id/);
  assert.match(fn, /1 - \(skc\.embedding <=> query_embedding\) as similarity/);
  assert.match(fn, /order by skc\.embedding <=> query_embedding/);
  assert.match(fn, /limit coalesce\(match_count, 8\)/);
  // visibilidad: usuario común → regla; admin y service_role → todo; anónimo → nada
  assert.match(fn, /caller\.is_service or caller\.is_admin or caller\.has_access/);
  assert.match(fn, /caller\.is_service\s+or caller\.is_admin\s+or public\.academy_chunk_is_visible\(skc\.source_type, skc\.course_id, skc\.module_id, skc\.lesson_id\)/);
  assert.match(fn, /auth\.uid\(\) is not null and coalesce\(public\.has_platform_access/);
});

test("permisos: se revoca PUBLIC y anon de la de 5 argumentos; no se concede nada nuevo", () => {
  const fn = block("stampy_visibility_match5");
  assert.match(fn, /revoke all on function %s from public, anon'/);
  assert.match(fn, /grant execute on function %s to authenticated, service_role'/);
  assert.doesNotMatch(code, /grant [^;]*\bto [^;]*\banon\b/i, "ningún grant a anon");
  assert.doesNotMatch(code, /grant execute on function public\.(is_admin|has_platform_access)/);
  assert.match(code, /revoke all on function public\.academy_chunk_is_visible\(text, uuid, uuid, uuid\) from public, anon/);
});

test("sobrecarga de 3 argumentos: misma regla, sin cambiar firma ni permisos", () => {
  const fn = block("stampy_visibility_match3");
  assert.match(fn, /public\.academy_chunk_is_visible\(chunk\.source_type, chunk\.course_id, chunk\.module_id, chunk\.lesson_id\)/);
  assert.match(fn, /match_threshold double precision,\s+match_count integer/);
  assert.match(fn, /auth\.uid\(\) is not null\s+and public\.has_platform_access\(auth\.uid\(\)\)/);
  assert.match(fn, /revoke all on function %s from public, anon, authenticated/);
  assert.match(fn, /grant execute on function %s to authenticated, service_role/);
});

test("sin ambigüedad de resolución: las dos sobrecargas se distinguen por nombres de parámetros y se buscan por ellos", () => {
  assert.match(code, /proargnames\[1:3\] = array\['query_embedding', 'match_threshold', 'match_count'\]/);
  assert.match(code, /proargnames\[1:5\] = array\['query_embedding', 'match_count', 'filter_source_type', 'filter_course_id', 'filter_lesson_id'\]/);
  // retrieval.ts llama por nombre con match_threshold: solo coincide con la de 3 argumentos.
  const retrieval = read("src/lib/stampy/retrieval.ts");
  assert.match(retrieval, /rpc\("match_stampy_knowledge_chunks", \{\s+query_embedding: embedding,\s+match_threshold: minSimilarity,\s+match_count: candidateCount,/);
  assert.doesNotMatch(read("src/lib/stampy/retrieval.ts"), /filter_course_id|filter_lesson_id/);
});

test("policy de chunks y datos: aditivo, sin tocar chunks, embeddings, cursos ni clases", () => {
  assert.match(code, /stampy_knowledge_chunks_open_course_restrict_select on public\.stampy_knowledge_chunks as restrictive for select to authenticated/);
  assert.match(code, /academy_chunk_is_visible\(source_type, course_id, module_id, lesson_id\)/);
  assert.doesNotMatch(code, /\b(update|delete\s+from|insert\s+into|truncate|drop\s+table|alter\s+table)\b/i);
  assert.doesNotMatch(code, /drop function/i);
  assert.match(code, /notify pgrst, 'reload schema'/);
});
