import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    throw new Error(`Unexpected dependency ${specifier} while loading ${relativePath}`);
  };
  new Function("require", "module", "exports", outputText)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const courseKind = loadTypeScriptModule("src/lib/academy/course-kind.ts");

function loadDeleteAction({ admin = true, deleteError = null, deleted = true } = {}) {
  const calls = [];
  const revalidated = [];
  const supabase = {
    from(table) {
      assert.equal(table, "courses");
      let deleting = false;
      let selected = "";
      let id = "";
      return {
        select(fields) {
          selected = fields;
          return this;
        },
        delete() {
          deleting = true;
          calls.push({ operation: "delete" });
          return this;
        },
        eq(column, value) {
          assert.equal(column, "id");
          id = value;
          return this;
        },
        async maybeSingle() {
          calls.push({ operation: deleting ? "delete-result" : "lookup", id, selected });
          if (deleting) {
            return deleteError
              ? { data: null, error: { message: deleteError } }
              : { data: deleted ? { id } : null, error: null };
          }
          return { data: { id, course_kind: "workshop" }, error: null };
        },
      };
    },
  };

  const actions = loadTypeScriptModule("src/app/admin/cursos/actions.ts", {
    "next/cache": { revalidatePath: (route) => revalidated.push(route) },
    "@/lib/auth/user-access": {
      getCurrentUserAccess: async () => ({
        access: {
          userId: admin ? "admin-1" : "user-1",
          capabilities: { accessAdmin: admin },
        },
        error: null,
      }),
    },
    "@/lib/academy/course-kind": courseKind,
    "@/utils/supabase/server": { createClient: async () => supabase },
  });

  return { actions, calls, revalidated };
}

test("course kind determines the public back destination", () => {
  assert.deepEqual(courseKind.getCourseKindUi("course"), {
    kind: "course",
    isWorkshop: false,
    singular: "curso",
    singularTitle: "Curso",
    plural: "cursos",
    publicListHref: "/cursos",
  });
  assert.equal(courseKind.getCourseKindUi("workshop").publicListHref, "/talleres");
  assert.equal(courseKind.getCourseKindUi("workshop").plural, "talleres");
});

test("shared detail derives its back link from course_kind", () => {
  const source = fs.readFileSync(path.join(root, "src/app/cursos/[id]/page.tsx"), "utf8");
  assert.match(source, /getCourseKindUi\(course\.course_kind\)/);
  assert.match(source, /href=\{courseKindUi\.publicListHref\}/);
  assert.match(source, /Volver a \{courseKindUi\.plural\}/);
  assert.doesNotMatch(source, /href="\/cursos"[\s\S]{0,200}Volver a cursos/);
});

test("only an admin can reach the course delete statement", async () => {
  const { actions, calls } = loadDeleteAction({ admin: false });
  const result = await actions.deleteCourseAction("9f39a4e8-8c16-4f17-9b84-63d14eb24042");
  assert.equal(result.success, false);
  assert.match(result.error, /permiso/);
  assert.deepEqual(calls, []);
});

test("admin deletion is one atomic course delete and revalidates every listing", async () => {
  const { actions, calls, revalidated } = loadDeleteAction();
  const courseId = "9f39a4e8-8c16-4f17-9b84-63d14eb24042";
  const result = await actions.deleteCourseAction(courseId);

  assert.deepEqual(result, { success: true, courseId, courseKind: "workshop" });
  assert.equal(calls.filter((call) => call.operation === "delete").length, 1);
  assert.deepEqual(revalidated, ["/admin/cursos", "/cursos", "/talleres", "/academia", "/"]);
});

test("a restrictive foreign key fails closed without manual partial cleanup", async () => {
  const { actions, calls, revalidated } = loadDeleteAction({ deleteError: "foreign key violation" });
  const result = await actions.deleteCourseAction("9f39a4e8-8c16-4f17-9b84-63d14eb24042");

  assert.equal(result.success, false);
  assert.match(result.error, /base de datos.*forma segura/i);
  assert.equal(calls.filter((call) => call.operation === "delete").length, 1);
  assert.deepEqual(revalidated, []);
});

test("admin UI uses Stampa confirmation with course/workshop-specific destructive copy", () => {
  const source = fs.readFileSync(path.join(root, "src/components/admin/course-form.tsx"), "utf8");
  assert.match(source, /confirmAction\(\{/);
  assert.match(source, /title: `¿Eliminar \$\{courseKindUi\.singular\}\?`/);
  assert.match(source, /Se eliminará el \$\{courseKindUi\.singular\} y su contenido asociado/);
  assert.match(source, /destructive: true/);
  assert.match(source, /deleteCourseAction\(courseId\)/);
  assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/);
});
