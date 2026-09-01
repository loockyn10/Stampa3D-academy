import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadCourseStyleModule() {
  const filename = path.join(root, "src/lib/course-style.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    () => { throw new Error("The course style module must stay dependency-free"); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const courseStyle = loadCourseStyleModule();

test("real course levels resolve to distinct semantic accents", () => {
  const beginner = courseStyle.getCourseLevelStyle("beginner");
  const intermediate = courseStyle.getCourseLevelStyle("intermediate");
  const advanced = courseStyle.getCourseLevelStyle("advanced");

  assert.equal(beginner.label, "Principiante");
  assert.match(beginner.accentClassName, /emerald/);
  assert.match(beginner.badgeClassName, /emerald/);
  assert.equal(intermediate.label, "Intermedio");
  assert.match(intermediate.accentClassName, /amber/);
  assert.match(intermediate.badgeClassName, /amber/);
  assert.equal(advanced.label, "Avanzado");
  assert.match(advanced.accentClassName, /red/);
  assert.match(advanced.badgeClassName, /red/);
});

test("missing and unknown levels remain neutral instead of becoming beginner", () => {
  assert.equal(courseStyle.getCourseLevelStyle(null), null);
  assert.equal(courseStyle.getCourseLevelStyle(""), null);
  assert.equal(courseStyle.getCourseLevelStyle("expert"), null);
});

test("the shared course card uses a structural stripe and a matching level badge", () => {
  const card = fs.readFileSync(path.join(root, "src/components/cards/course-card.tsx"), "utf8");

  assert.match(card, /getCourseLevelStyle\(course\.level\)/);
  assert.match(card, /w-\[5px\]/);
  assert.match(card, /levelStyle\.accentClassName/);
  assert.match(card, /levelStyle\.badgeClassName/);
  assert.match(card, /course\.course_kind === "workshop"/);
});
