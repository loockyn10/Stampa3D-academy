import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(relativePath) {
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

  new Function("require", "module", "exports", outputText)(
    (specifier) => {
      throw new Error(`Unexpected dependency ${specifier} while loading ${relativePath}`);
    },
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}

const userMemory = loadTypeScriptModule("src/lib/stampy/user-memory.ts");

function makeMemory(overrides = {}) {
  return {
    id: "memory-1",
    user_id: "user-1",
    category: "printing",
    memory_key: "preferred_material",
    memory_value: "PLA",
    confidence: 0.9,
    source_message_id: null,
    created_at: "2026-08-25T12:00:00.000Z",
    updated_at: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

test('"Siempre uso Orca" extracts only a software memory', () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Siempre uso Orca"), [
    {
      category: "software",
      memoryKey: "slicer",
      memoryValue: "Orca",
      confidence: 0.95,
    },
  ]);
});

test('"Siempre imprimo PLA" extracts a printing memory', () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Siempre imprimo PLA"), [
    {
      category: "printing",
      memoryKey: "preferred_material",
      memoryValue: "PLA",
      confidence: 0.95,
    },
  ]);
});

test('"Vendo mates" extracts a business memory', () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Vendo mates"), [
    {
      category: "business",
      memoryKey: "product",
      memoryValue: "mates",
      confidence: 0.9,
    },
  ]);
});

test("casual or irrelevant personal details are not remembered", () => {
  assert.deepEqual(userMemory.extractUsefulMemory("No dormí bien"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("Mi perro se llama Moro"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("Hoy estoy cansado"), []);
});

test("questions and negated facts are not remembered", () => {
  assert.deepEqual(userMemory.extractUsefulMemory("¿Usás Orca?"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("No uso Orca"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("Nunca imprimo PLA"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("No vendo mates"), []);
});

test("hardware and workflow rules normalize useful values", () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Tengo nozzle 0,6"), [
    {
      category: "hardware",
      memoryKey: "nozzle_diameter",
      memoryValue: "0.6 mm",
      confidence: 0.95,
    },
  ]);
  assert.deepEqual(userMemory.extractUsefulMemory("Siempre uso brim"), [
    {
      category: "workflow",
      memoryKey: "bed_adhesion",
      memoryValue: "Brim",
      confidence: 0.95,
    },
  ]);
});

test("saving an identical fact twice converges on one row and refreshes only updated_at", async () => {
  const rows = new Map();
  let clock = 0;
  const supabase = {
    async rpc(name, params) {
      assert.equal(name, "save_stampy_user_memory");
      const key = [
        params.p_user_id,
        params.p_category,
        params.p_memory_key,
        params.p_memory_value,
      ].join("|");
      const existing = rows.get(key);
      clock += 1;

      if (existing) {
        rows.set(key, { ...existing, updated_at: `time-${clock}` });
      } else {
        rows.set(key, {
          ...params,
          created_at: `time-${clock}`,
          updated_at: `time-${clock}`,
        });
      }

      return { data: rows.get(key), error: null };
    },
  };

  const first = await userMemory.saveUserMemory({
    supabase,
    userId: "user-1",
    message: "Siempre imprimo PLA",
    sourceMessageId: "message-1",
  });
  const original = structuredClone([...rows.values()][0]);
  const second = await userMemory.saveUserMemory({
    supabase,
    userId: "user-1",
    message: "Siempre imprimo PLA",
    sourceMessageId: "message-2",
  });
  const updated = [...rows.values()][0];

  assert.equal(rows.size, 1);
  assert.equal(first.savedCount, 1);
  assert.equal(second.savedCount, 1);
  assert.equal(updated.p_source_message_id, original.p_source_message_id);
  assert.equal(updated.p_confidence, original.p_confidence);
  assert.equal(updated.created_at, original.created_at);
  assert.notEqual(updated.updated_at, original.updated_at);
});

test("warping loads only hardware, printing and workflow memories", async () => {
  let queriedCategories = [];
  const rows = [
    makeMemory(),
    makeMemory({
      id: "memory-2",
      category: "hardware",
      memory_key: "nozzle_diameter",
      memory_value: "0.6 mm",
    }),
    makeMemory({
      id: "memory-3",
      category: "workflow",
      memory_key: "bed_adhesion",
      memory_value: "Brim",
    }),
  ];
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in(column, categories) {
      assert.equal(column, "category");
      queriedCategories = categories;
      return this;
    },
    order() {
      return this;
    },
    async limit() {
      return { data: rows, error: null };
    },
  };
  const supabase = {
    from(table) {
      assert.equal(table, "stampy_user_memory");
      return query;
    },
  };

  const result = await userMemory.loadRelevantMemory({
    supabase,
    userId: "user-1",
    message: "Tengo warping en las esquinas",
  });

  assert.deepEqual(queriedCategories, ["hardware", "printing", "workflow"]);
  assert.equal(queriedCategories.includes("business"), false);
  assert.equal(result.memories.length, 3);
  assert.match(result.promptText, /^Memorias útiles del usuario:/);
});

test("unrelated messages do not query persistent memory", async () => {
  let queryCount = 0;
  const supabase = {
    from() {
      queryCount += 1;
      throw new Error("No query expected");
    },
  };

  const result = await userMemory.loadRelevantMemory({
    supabase,
    userId: "user-1",
    message: "Hola, ¿cómo estás?",
  });

  assert.equal(queryCount, 0);
  assert.deepEqual(result, { memories: [], promptText: "", error: null });
});

test("ranking returns at most ten relevant memories and prompt formatting is explicit", () => {
  const memories = Array.from({ length: 12 }, (_, index) =>
    makeMemory({
      id: `printing-${index}`,
      memory_key: `printing_key_${index}`,
      memory_value: `printing value ${index}`,
      updated_at: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    })
  );
  memories.push(
    makeMemory({
      id: "business-1",
      category: "business",
      memory_key: "product",
      memory_value: "mates",
    })
  );

  const ranked = userMemory.rankRelevantMemory({
    message: "¿Cómo mejoro esta impresión en PLA?",
    memories,
    maxResults: 50,
  });

  assert.equal(ranked.length, 10);
  assert.equal(ranked.some((memory) => memory.category === "business"), false);

  const prompt = userMemory.formatRelevantMemoryForPrompt([
    makeMemory({
      id: "software-1",
      category: "software",
      memory_key: "slicer",
      memory_value: "Orca",
    }),
    makeMemory(),
    makeMemory({
      id: "hardware-1",
      category: "hardware",
      memory_key: "nozzle_diameter",
      memory_value: "0.6 mm",
    }),
  ]);
  assert.equal(
    prompt,
    "Memorias útiles del usuario:\n- Usa Orca.\n- Prefiere PLA.\n- Tiene nozzle 0.6 mm."
  );
});

test("the migration enforces atomic duplicate handling without changing stored facts", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260826182313_stampy_user_memory.sql"),
    "utf8"
  );

  assert.match(sql, /unique \(user_id, category, memory_key, memory_value\)/i);
  assert.match(
    sql,
    /on conflict \(user_id, category, memory_key, memory_value\)\s+do update set updated_at = now\(\)/i
  );
  assert.doesNotMatch(sql, /do update set[^;]*(memory_value|confidence|source_message_id)\s*=/i);
});
