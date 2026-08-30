import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadPublicRafflesModule() {
  const filename = path.join(root, "src/lib/raffles/public-raffles.ts");
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
    () => {
      throw new Error("Public raffle helper must not have runtime dependencies");
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const { isPublicRaffleVisible, PUBLIC_RAFFLE_STATUS } = loadPublicRafflesModule();

test("draft raffles are never publicly visible even when is_active stayed true", () => {
  assert.equal(isPublicRaffleVisible({ status: "draft", is_active: true }), false);
});

test("an active raffle is public only when both real state fields allow it", () => {
  assert.equal(PUBLIC_RAFFLE_STATUS, "active");
  assert.equal(isPublicRaffleVisible({ status: "active", is_active: true }), true);
  assert.equal(isPublicRaffleVisible({ status: "active", is_active: false }), false);
});

test("multiple active raffles remain visible without an artificial single-result limit", () => {
  const raffles = [
    { id: "active-1", status: "active", is_active: true },
    { id: "draft", status: "draft", is_active: true },
    { id: "active-2", status: "active", is_active: true },
  ];

  assert.deepEqual(
    raffles.filter(isPublicRaffleVisible).map((raffle) => raffle.id),
    ["active-1", "active-2"],
  );
});

test("moving a previously active raffle back to draft hides it immediately", () => {
  const raffle = { status: "active", is_active: true };
  assert.equal(isPublicRaffleVisible(raffle), true);
  raffle.status = "draft";
  assert.equal(isPublicRaffleVisible(raffle), false);
});

test("draw date does not invent visibility rules absent from the real schema", () => {
  assert.equal(isPublicRaffleVisible({ status: "active", is_active: true, draw_date: "2020-01-01" }), true);
  assert.equal(isPublicRaffleVisible({ status: "active", is_active: true, draw_date: "2030-01-01" }), true);
});

test("public query filters both fields, has no limit, and the page renders every result", () => {
  const helperSource = fs.readFileSync(
    path.join(root, "src/lib/raffles/public-raffles.ts"),
    "utf8",
  );
  const pageSource = fs.readFileSync(
    path.join(root, "src/app/sorteos/page.tsx"),
    "utf8",
  );

  assert.match(helperSource, /\.eq\("status", PUBLIC_RAFFLE_STATUS\)/);
  assert.match(helperSource, /\.eq\("is_active", true\)/);
  assert.doesNotMatch(helperSource, /\.limit\(/);
  assert.doesNotMatch(helperSource, /\.single\(/);
  assert.match(pageSource, /activeRaffles\.map\(\(activeRaffle\)/);
  assert.match(pageSource, /Todavía no hay sorteos activos\./);
  assert.match(pageSource, /!error && \(activeRaffles\.length > 0/);
});

test("admin keeps its unfiltered list and continues to show draft state", () => {
  const adminSource = fs.readFileSync(
    path.join(root, "src/app/admin/sorteos/page.tsx"),
    "utf8",
  );

  assert.match(adminSource, /\.from\("raffles"\)/);
  assert.match(adminSource, /status === "draft"/);
  assert.doesNotMatch(adminSource, /getVisibleRaffles/);
});
