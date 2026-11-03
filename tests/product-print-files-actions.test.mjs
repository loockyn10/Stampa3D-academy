// Flujos completos de las Server Actions de archivos de impresión sobre un "mundo" en memoria.
// El mundo hace cumplir los privilegios por columna (GRANT insert/update) leídos de la MIGRATION REAL: si una acción
// intentara escribir una columna que la base no permite al usuario (status, file_size, storage_path…), el test falla.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { loadTs } from "./helpers/load-ts.mjs";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261102130000_product_print_files.sql"), "utf8");
const grantList = (kind) => /grant\s+KIND\s*\(([^)]*)\)/i.exec(migration.replace(/KIND/g, kind).replace(new RegExp(`grant ${kind}`, "i"), `grant ${kind}`))
  ?? null;
const columnsOf = (kind) => new RegExp(`grant ${kind} \\(([^)]*)\\)`, "i").exec(migration)[1].split(",").map((c) => c.trim());
const INSERT_COLUMNS = columnsOf("insert");
const UPDATE_COLUMNS = columnsOf("update");

const config = loadTs("src/lib/print-files/config.ts");
const types = loadTs("src/lib/print-files/types.ts");
const container = loadTs("src/lib/print-files/three-mf-container.ts");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPONENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FOREIGN_COMPONENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRINTER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const FOREIGN_PRINTER = "99999999-9999-4999-8999-999999999999";

async function valid3mf() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships/>');
  zip.file("3D/3dmodel.model", `<?xml version="1.0"?><model unit="millimeter"><resources/><build/></model>${" ".repeat(200)}`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** `rls: false` simula una base SIN políticas de fila: el aislamiento debe sostenerse con los filtros de dueño del código. */
function createWorld({ uid = A, rls = true } = {}) {
  const tables = {
    products: [
      { id: PRODUCT, user_id: A, name: "Lámpara", base_cost: 3000, sale_price: 9000, print_time_minutes: 300, is_active: true },
      { id: OTHER_PRODUCT, user_id: A, name: "Otro", base_cost: 1, sale_price: 2, print_time_minutes: 3, is_active: true },
      { id: PRODUCT_B, user_id: B, name: "Maceta de B", base_cost: 5, sale_price: 6, print_time_minutes: 7, is_active: true },
    ],
    product_components: [
      { id: COMPONENT, user_id: A, product_id: PRODUCT, name: "Pantalla", is_active: true },
      { id: FOREIGN_COMPONENT, user_id: A, product_id: OTHER_PRODUCT, name: "De otro producto", is_active: true },
    ],
    printers: [
      { id: PRINTER, user_id: A, name: "A1" },
      { id: FOREIGN_PRINTER, user_id: B, name: "De B" },
    ],
    product_print_files: [],
  };
  const world = { tables, objects: new Map(), removed: [], failRemove: false, remoteFailure: null, writes: [] };

  const trigger = (row) => {
    const product = tables.products.find((p) => p.id === row.product_id && p.user_id === row.user_id);
    if (!product) return { code: "23503", message: "el producto no pertenece al usuario" };
    if (row.component_id && !tables.product_components.some((c) => c.id === row.component_id && c.product_id === row.product_id && c.user_id === row.user_id)) {
      return { code: "23503", message: "la pieza no pertenece a este producto" };
    }
    if (row.printer_id && !tables.printers.some((p) => p.id === row.printer_id && p.user_id === row.user_id)) {
      return { code: "23503", message: "la impresora no pertenece al usuario" };
    }
    return null;
  };

  const client = (actor) => ({
    from(table) {
      const st = { op: "select", filters: [], payload: null, columns: null, head: false, returning: false };
      const matches = () => tables[table].filter((row) =>
        st.filters.every(([kind, column, value]) => (kind === "eq" ? row[column] === value : kind === "lt" ? row[column] < value : kind === "in" ? value.includes(row[column]) : true))
        && (actor === "admin" || !rls || row.user_id === uid));
      const project = (row) => {
        if (!st.columns || st.columns === "*") return { ...row };
        return Object.fromEntries(st.columns.split(",").map((c) => c.trim()).map((c) => [c, row[c] ?? null]));
      };
      const run = () => {
        if (table !== "product_print_files" && st.op !== "select") throw new Error(`escritura inesperada en ${table}`);
        if (st.op === "select") {
          const rows = matches();
          return { rows: rows.map(project), count: rows.length, error: null };
        }
        if (st.op === "insert") {
          const payload = st.payload;
          if (actor === "user") {
            const illegal = Object.keys(payload).filter((key) => !INSERT_COLUMNS.includes(key));
            if (illegal.length) return { rows: [], count: 0, error: { code: "42501", message: `permission denied for columns ${illegal.join(",")}` } };
            if (payload.user_id !== uid) return { rows: [], count: 0, error: { code: "42501", message: "row-level security" } };
          }
          const row = {
            status: "pending", file_size: null, replaces_id: null, component_id: null, printer_id: null, printer_name: null,
            est_minutes: null, est_grams: null, material: null, created_at: new Date().toISOString(), ...payload,
          };
          const failure = trigger(row);
          if (failure) return { rows: [], count: 0, error: failure };
          tables.product_print_files.push(row);
          world.writes.push({ actor, op: "insert", keys: Object.keys(payload) });
          return { rows: [project(row)], count: 1, error: null };
        }
        if (st.op === "update") {
          if (actor === "user") {
            const illegal = Object.keys(st.payload).filter((key) => !UPDATE_COLUMNS.includes(key));
            if (illegal.length) return { rows: [], count: 0, error: { code: "42501", message: `permission denied for columns ${illegal.join(",")}` } };
          }
          const rows = matches();
          for (const row of rows) {
            const next = { ...row, ...st.payload };
            const failure = trigger(next);
            if (failure) return { rows: [], count: 0, error: failure };
            if (next.status === "ready" && !(next.file_size > 0)) return { rows: [], count: 0, error: { code: "23514", message: "ready_has_size" } };
            Object.assign(row, st.payload);
          }
          world.writes.push({ actor, op: "update", keys: Object.keys(st.payload) });
          return { rows: rows.map(project), count: rows.length, error: null };
        }
        const rows = matches();
        tables[table] = tables[table].filter((row) => !rows.includes(row));
        world.writes.push({ actor, op: "delete" });
        return { rows: rows.map(project), count: rows.length, error: null };
      };
      const finish = (mode) => {
        const result = run();
        if (result.error) return { data: null, error: result.error, count: null };
        if (mode === "one") return { data: result.rows[0] ?? null, error: null, count: result.count };
        if (mode === "single") return result.rows[0] ? { data: result.rows[0], error: null, count: 1 } : { data: null, error: { code: "PGRST116", message: "no rows" }, count: 0 };
        return { data: st.head ? null : result.rows, error: null, count: result.count };
      };
      const chain = {
        select(columns, options) { if (st.op === "select") st.columns = columns; else { st.returning = true; st.columns = columns; } st.head = Boolean(options?.head); return chain; },
        insert(payload) { st.op = "insert"; st.payload = payload; return chain; },
        update(payload) { st.op = "update"; st.payload = payload; return chain; },
        delete() { st.op = "delete"; return chain; },
        eq(column, value) { st.filters.push(["eq", column, value]); return chain; },
        lt(column, value) { st.filters.push(["lt", column, value]); return chain; },
        in(column, value) { st.filters.push(["in", column, value]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle: async () => finish("one"),
        single: async () => finish("single"),
        then: (resolve, reject) => Promise.resolve(finish("many")).then(resolve, reject),
      };
      return chain;
    },
  });

  const userClient = client("user");
  const adminClient = client("admin");

  const mod = loadTs("src/app/productos/print-file-actions.ts", {
    "node:crypto": crypto,
    "next/headers": { headers: async () => new Headers({ host: "app.test" }) },
    "@/utils/supabase/server": { createClient: async () => userClient },
    "@/lib/auth/user-access": {
      getCurrentUserAccess: async () => ({ error: null, access: { userId: uid, capabilities: { accessPlatform: true } } }),
    },
    "@/lib/features/server": { FEATURE_UNAVAILABLE_MESSAGE: "no disponible", isFeatureAvailable: async () => true },
    "@/lib/print-files/server": {
      RemoteObjectError: class RemoteObjectError extends Error {},
      buildPrintFileStoragePath: (userId, productId, fileId) => `${userId}/${productId}/${fileId}.3mf`,
      createPrintFilesAdminClient: () => adminClient,
      createSignedUpload: async (_admin, storagePath) => ({ path: storagePath, token: "token-de-subida" }),
      createSignedDownload: async (_admin, storagePath, ttl, name) =>
        world.objects.has(storagePath) ? `https://storage.test/${storagePath}?ttl=${ttl}${name ? `&download=${encodeURIComponent(name)}` : ""}` : null,
      getPrintFileLinkKey: () => Buffer.alloc(32, 7),
      remoteRangeSource: (url) => {
        const objectPath = new URL(url).pathname.slice(1);
        const bytes = world.objects.get(objectPath);
        if (world.remoteFailure) throw world.remoteFailure;
        return container.blobRangeSource(new Blob([bytes]));
      },
      removeStorageObjects: async (_admin, paths) => {
        if (world.failRemove) return false;
        for (const p of paths) {
          world.objects.delete(p);
          world.removed.push(p);
        }
        return true;
      },
    },
  });

  const addFile = (overrides = {}) => {
    const id = overrides.id ?? crypto.randomUUID();
    const userId = overrides.user_id ?? A;
    const productId = overrides.product_id ?? PRODUCT;
    const row = {
      id, user_id: userId, product_id: productId, component_id: null, name: "Existente", slicer: "orcaslicer", printer_id: null,
      printer_name: "Prusa", file_name: "existente.3mf", storage_path: `${userId}/${productId}/${id}.3mf`, file_size: 1000, status: "ready",
      replaces_id: null, est_minutes: null, est_grams: null, material: null, created_at: new Date().toISOString(), ...overrides,
    };
    tables.product_print_files.push(row);
    world.objects.set(row.storage_path, new Uint8Array([1, 2, 3]));
    return row;
  };
  return { world, mod, addFile };
}

const metadata = { name: "Pantalla A1", slicer: "bambu_studio", componentId: COMPONENT, printerId: PRINTER, printerName: "A1" };
const prepareInput = (bytes, extra = {}) => ({ productId: PRODUCT, fileName: "pantalla.3mf", size: bytes.length, metadata, ...extra });
const rowsOf = (world) => world.tables.product_print_files;
const productsSnapshot = (world) => JSON.stringify(world.tables.products);

// ------------------------------------------------------------------------------------------------- subir

test("subir: prepara la fila pending con ruta del dueño y producto, verifica el objeto y recién entonces queda ready", async () => {
  const { world, mod } = createWorld();
  const before = productsSnapshot(world);
  const bytes = await valid3mf();

  const prepared = await mod.prepareProductPrintFileUploadAction(prepareInput(bytes));
  assert.equal(prepared.success, true);
  assert.equal(prepared.path, `${A}/${PRODUCT}/${prepared.fileId}.3mf`);
  assert.equal(prepared.token, "token-de-subida");
  const [pending] = rowsOf(world);
  assert.equal(pending.status, "pending");
  assert.equal(pending.file_size, null);
  assert.equal(pending.user_id, A, "el dueño sale de la sesión del servidor");

  // El archivo todavía no existe en el almacenamiento: no se puede confirmar.
  world.objects.clear();
  const missing = await mod.completeProductPrintFileUploadAction(prepared.fileId);
  assert.equal(missing.success, false);
  assert.equal(rowsOf(world).length, 0, "una subida que no llegó no deja filas huérfanas");

  const again = await mod.prepareProductPrintFileUploadAction(prepareInput(bytes));
  world.objects.set(again.path, bytes);
  const done = await mod.completeProductPrintFileUploadAction(again.fileId);
  assert.equal(done.success, true);
  assert.equal(rowsOf(world)[0].status, "ready");
  assert.equal(rowsOf(world)[0].file_size, bytes.length);
  // El cliente solo recibe las columnas públicas: ni ruta de almacenamiento ni dueño ni estado interno.
  assert.deepEqual(Object.keys(done.file).sort(), types.PRINT_FILE_COLUMNS.split(",").map((c) => c.trim()).sort());
  assert.equal(done.file.component_id, COMPONENT);
  assert.equal(done.file.printer_id, PRINTER);
  assert.equal(productsSnapshot(world), before, "el producto (costos, precio, tiempo) no se toca");
});

test("subir: todo lo que escriben las acciones está permitido por los GRANT de la migration", async () => {
  const { world, mod } = createWorld();
  const bytes = await valid3mf();
  const prepared = await mod.prepareProductPrintFileUploadAction(prepareInput(bytes));
  world.objects.set(prepared.path, bytes);
  await mod.completeProductPrintFileUploadAction(prepared.fileId);
  await mod.updateProductPrintFileAction(prepared.fileId, { ...metadata, name: "Renombrado", estMinutes: 220, estGrams: 125 });

  for (const write of world.writes.filter((w) => w.actor === "user" && w.op === "insert")) {
    assert.ok(write.keys.every((k) => INSERT_COLUMNS.includes(k)), `insert: ${write.keys}`);
  }
  for (const write of world.writes.filter((w) => w.actor === "user" && w.op === "update")) {
    assert.ok(write.keys.every((k) => UPDATE_COLUMNS.includes(k)), `update: ${write.keys}`);
  }
  // status / file_size / storage_path solo los escribe el cliente de servicio.
  const privileged = world.writes.filter((w) => w.actor === "admin" && w.op === "update");
  assert.ok(privileged.length >= 1 && privileged.some((w) => w.keys.includes("status") && w.keys.includes("file_size")));
  for (const column of ["status", "file_size", "storage_path", "user_id", "replaces_id"]) {
    assert.equal(UPDATE_COLUMNS.includes(column), false, `${column} no es actualizable por el usuario`);
  }
});

test("subir: un archivo que no es un 3MF se descarta (objeto y fila) y el usuario recibe un motivo claro", async () => {
  const { world, mod } = createWorld();
  const fake = new TextEncoder().encode("solid cubo ".repeat(40));
  const prepared = await mod.prepareProductPrintFileUploadAction(prepareInput(fake));
  world.objects.set(prepared.path, fake);

  const result = await mod.completeProductPrintFileUploadAction(prepared.fileId);
  assert.equal(result.success, false);
  assert.match(result.error, /3MF/);
  assert.equal(rowsOf(world).length, 0);
  assert.deepEqual(world.removed, [prepared.path], "el objeto subido se elimina");
});

test("subir: si el almacenamiento falla al verificar, se descarta sin dejar nada", async () => {
  const { world, mod } = createWorld();
  const bytes = await valid3mf();
  const prepared = await mod.prepareProductPrintFileUploadAction(prepareInput(bytes));
  world.objects.set(prepared.path, bytes);
  world.remoteFailure = new Error("boom");
  const result = await mod.completeProductPrintFileUploadAction(prepared.fileId);
  assert.equal(result.success, false);
  assert.equal(rowsOf(world).length, 0);
});

test("subir: confirmar dos veces es idempotente", async () => {
  const { world, mod } = createWorld();
  const bytes = await valid3mf();
  const prepared = await mod.prepareProductPrintFileUploadAction(prepareInput(bytes));
  world.objects.set(prepared.path, bytes);
  assert.equal((await mod.completeProductPrintFileUploadAction(prepared.fileId)).success, true);
  assert.equal((await mod.completeProductPrintFileUploadAction(prepared.fileId)).success, true);
  assert.equal(rowsOf(world).length, 1);
});

test("subir: pieza de otro producto, impresora ajena y producto ajeno se rechazan sin crear filas", async () => {
  const { world, mod } = createWorld();
  const bytes = await valid3mf();
  const bad = [
    prepareInput(bytes, { metadata: { ...metadata, componentId: FOREIGN_COMPONENT } }),
    prepareInput(bytes, { metadata: { ...metadata, printerId: FOREIGN_PRINTER } }),
    prepareInput(bytes, { productId: PRODUCT_B }),
  ];
  for (const input of bad) assert.equal((await mod.prepareProductPrintFileUploadAction(input)).success, false);
  assert.equal(rowsOf(world).length, 0);
});

test("subir: varios proyectos del mismo laminador y de distintas impresoras conviven en un producto", async () => {
  const { world, mod } = createWorld();
  const bytes = await valid3mf();
  for (const [name, slicer] of [["A1", "bambu_studio"], ["P1S", "bambu_studio"], ["Flash", "flash_studio"], ["Orca", "orcaslicer"]]) {
    const prepared = await mod.prepareProductPrintFileUploadAction(prepareInput(bytes, { metadata: { name, slicer, printerName: name } }));
    assert.equal(prepared.success, true, name);
    world.objects.set(prepared.path, bytes);
    assert.equal((await mod.completeProductPrintFileUploadAction(prepared.fileId)).success, true);
  }
  assert.deepEqual(rowsOf(world).map((r) => `${r.slicer}:${r.name}`).sort(), ["bambu_studio:A1", "bambu_studio:P1S", "flash_studio:Flash", "orcaslicer:Orca"]);
});

test("topes: 30 archivos por producto y por usuario; el reemplazo no los consume", async () => {
  const { world, mod, addFile } = createWorld();
  const bytes = await valid3mf();
  for (let i = 0; i < config.MAX_PRINT_FILES_PER_PRODUCT; i += 1) addFile({ name: `P${i}` });
  const denied = await mod.prepareProductPrintFileUploadAction(prepareInput(bytes));
  assert.equal(denied.success, false);
  assert.match(denied.error, /30 archivos/);
  const replaceTarget = rowsOf(world)[0];
  assert.equal((await mod.prepareProductPrintFileUploadAction({ productId: PRODUCT, fileName: "nuevo.3mf", size: bytes.length, replaceFileId: replaceTarget.id })).success, true);

  const second = createWorld();
  for (let i = 0; i < config.MAX_PRINT_FILES_PER_USER; i += 1) second.addFile({ product_id: i % 2 ? PRODUCT : OTHER_PRODUCT, name: `U${i}` });
  const userCap = await second.mod.prepareProductPrintFileUploadAction({ productId: PRODUCT, fileName: "x.3mf", size: bytes.length, metadata });
  assert.equal(userCap.success, false);
});

test("subir: las subidas abandonadas (pending de más de 1 h) se limpian junto con su objeto", async () => {
  const { world, mod, addFile } = createWorld();
  const bytes = await valid3mf();
  const stale = addFile({ status: "pending", file_size: null, created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() });
  const recent = addFile({ status: "pending", file_size: null });
  const kept = addFile({ name: "Listo" });
  assert.equal((await mod.prepareProductPrintFileUploadAction(prepareInput(bytes))).success, true);
  const ids = rowsOf(world).map((r) => r.id);
  assert.equal(ids.includes(stale.id), false);
  assert.ok(world.removed.includes(stale.storage_path));
  assert.equal(ids.includes(recent.id), true, "una subida en curso no se toca");
  assert.equal(ids.includes(kept.id), true);
});

// --------------------------------------------------------------------------------------------- reemplazar

test("reemplazar: el archivo nuevo hereda los datos y recién al verificarse se elimina el anterior", async () => {
  const { world, mod, addFile } = createWorld();
  const old = addFile({ name: "Original", slicer: "orcaslicer", printer_name: "Prusa", est_minutes: 90, material: "PLA", component_id: COMPONENT });
  const bytes = await valid3mf();

  const prepared = await mod.prepareProductPrintFileUploadAction({ productId: PRODUCT, fileName: "v2.3mf", size: bytes.length, replaceFileId: old.id, metadata: { name: "IGNORADO", slicer: "bambu_studio" } });
  assert.equal(prepared.success, true);
  const pending = rowsOf(world).find((r) => r.id === prepared.fileId);
  assert.equal(pending.name, "Original", "los datos vienen del archivo anterior, no del formulario");
  assert.equal(pending.slicer, "orcaslicer");
  assert.equal(pending.replaces_id, old.id);
  assert.ok(rowsOf(world).some((r) => r.id === old.id), "el anterior sigue ahí mientras el nuevo no se verificó");

  world.objects.set(prepared.path, bytes);
  const done = await mod.completeProductPrintFileUploadAction(prepared.fileId);
  assert.equal(done.success, true);
  assert.equal(done.warning, undefined);
  assert.equal(rowsOf(world).some((r) => r.id === old.id), false);
  assert.ok(world.removed.includes(old.storage_path));
  const current = rowsOf(world).find((r) => r.id === prepared.fileId);
  assert.equal(current.status, "ready");
  assert.equal(current.replaces_id, null);
  assert.equal(current.component_id, COMPONENT);
  assert.equal(rowsOf(world).length, 1);
});

test("reemplazar: si el archivo nuevo es inválido, el anterior queda intacto", async () => {
  const { world, mod, addFile } = createWorld();
  const old = addFile({ name: "Original" });
  const junk = new TextEncoder().encode("no soy un zip ".repeat(30));
  const prepared = await mod.prepareProductPrintFileUploadAction({ productId: PRODUCT, fileName: "v2.3mf", size: junk.length, replaceFileId: old.id });
  world.objects.set(prepared.path, junk);
  assert.equal((await mod.completeProductPrintFileUploadAction(prepared.fileId)).success, false);
  assert.deepEqual(rowsOf(world).map((r) => r.id), [old.id]);
  assert.ok(world.objects.has(old.storage_path));
});

test("reemplazar: si no se puede borrar la versión anterior se avisa y no se pierde nada", async () => {
  const { world, mod, addFile } = createWorld();
  const old = addFile({ name: "Original" });
  const bytes = await valid3mf();
  const prepared = await mod.prepareProductPrintFileUploadAction({ productId: PRODUCT, fileName: "v2.3mf", size: bytes.length, replaceFileId: old.id });
  world.objects.set(prepared.path, bytes);
  world.failRemove = true;
  const done = await mod.completeProductPrintFileUploadAction(prepared.fileId);
  assert.equal(done.success, true);
  assert.match(done.warning, /versión anterior/);
  assert.equal(rowsOf(world).length, 2);
  // reintentar la confirmación completa la limpieza pendiente
  world.failRemove = false;
  const retry = await mod.completeProductPrintFileUploadAction(prepared.fileId);
  assert.equal(retry.success, true);
  assert.equal(rowsOf(world).some((r) => r.id === old.id), false);
});

test("reemplazar un archivo ajeno o inexistente se rechaza", async () => {
  const { world, mod, addFile } = createWorld();
  const foreign = addFile({ user_id: B, product_id: PRODUCT_B });
  const bytes = await valid3mf();
  const result = await mod.prepareProductPrintFileUploadAction({ productId: PRODUCT, fileName: "v2.3mf", size: bytes.length, replaceFileId: foreign.id });
  assert.equal(result.success, false);
  assert.equal(rowsOf(world).length, 1);
});

// ----------------------------------------------------------------------------------------------- eliminar

test("eliminar: primero el objeto, después la fila; no afecta a otros proyectos ni al producto", async () => {
  const { world, mod, addFile } = createWorld();
  const before = productsSnapshot(world);
  const target = addFile({ name: "Se va" });
  const other = addFile({ name: "Se queda" });
  const result = await mod.deleteProductPrintFileAction(target.id);
  assert.equal(result.success, true);
  assert.deepEqual(world.removed, [target.storage_path]);
  assert.deepEqual(rowsOf(world).map((r) => r.id), [other.id]);
  assert.ok(world.objects.has(other.storage_path));
  assert.equal(productsSnapshot(world), before);
});

test("eliminar: si el almacenamiento falla no se borra la fila (no queda un objeto huérfano e invisible)", async () => {
  const { world, mod, addFile } = createWorld();
  const target = addFile();
  world.failRemove = true;
  const result = await mod.deleteProductPrintFileAction(target.id);
  assert.equal(result.success, false);
  assert.equal(rowsOf(world).length, 1);
  assert.ok(world.objects.has(target.storage_path));
});

// ----------------------------------------------------------------------------------------------- editar

test("editar: guarda los datos del proyecto y valida pieza e impresora; no toca el producto", async () => {
  const { world, mod, addFile } = createWorld();
  const before = productsSnapshot(world);
  const file = addFile({ name: "Viejo" });
  const ok = await mod.updateProductPrintFileAction(file.id, { name: "Nuevo", slicer: "flash_studio", componentId: COMPONENT, printerId: PRINTER, printerName: "A1", estMinutes: 220, estGrams: "125,5", material: "PLA Translúcido" });
  assert.equal(ok.success, true);
  assert.equal(ok.file.name, "Nuevo");
  assert.equal(ok.file.est_grams, 125.5);
  assert.equal(ok.file.slicer, "flash_studio");
  assert.equal(rowsOf(world)[0].storage_path, file.storage_path, "la ruta no cambia");
  assert.equal(productsSnapshot(world), before);

  assert.equal((await mod.updateProductPrintFileAction(file.id, { name: "x", slicer: "orcaslicer", componentId: FOREIGN_COMPONENT })).success, false);
  assert.equal((await mod.updateProductPrintFileAction(file.id, { name: "x", slicer: "orcaslicer", printerId: FOREIGN_PRINTER })).success, false);
  assert.equal(rowsOf(world)[0].name, "Nuevo");
});

// ------------------------------------------------------------------------------------ aislamiento / acceso

for (const rls of [true, false]) test(`aislamiento (${rls ? "con RLS" : "SIN RLS: solo los filtros de dueño del código"}): un usuario no puede confirmar, editar, eliminar ni pedir acceso a archivos de otro`, async () => {
  const { world, mod, addFile } = createWorld({ uid: A, rls });
  const theirs = addFile({ user_id: B, product_id: PRODUCT_B, name: "De B" });
  const pending = addFile({ user_id: B, product_id: PRODUCT_B, status: "pending", file_size: null });
  const snapshot = JSON.stringify(rowsOf(world));

  const results = [
    await mod.completeProductPrintFileUploadAction(pending.id),
    await mod.updateProductPrintFileAction(theirs.id, { name: "hack", slicer: "orcaslicer" }),
    await mod.deleteProductPrintFileAction(theirs.id),
    await mod.createPrintFileAccessAction(theirs.id, "download"),
    await mod.createPrintFileAccessAction(theirs.id, "open"),
  ];
  for (const result of results) assert.equal(result.success, false);
  assert.equal(JSON.stringify(rowsOf(world)), snapshot, "nada cambió");
  assert.deepEqual(world.removed, [], "ningún objeto ajeno fue eliminado");
});

test("acceso: la descarga entrega una URL firmada corta y un archivo pendiente no se puede descargar ni abrir", async () => {
  const { mod, addFile } = createWorld();
  const ready = addFile({ file_name: "Pantalla Ñandú.3mf" });
  const pending = addFile({ status: "pending", file_size: null });

  const download = await mod.createPrintFileAccessAction(ready.id, "download");
  assert.equal(download.success, true);
  assert.match(download.url, /ttl=60/);
  assert.match(download.url, /download=/);
  assert.equal((await mod.createPrintFileAccessAction(pending.id, "download")).success, false);
  assert.equal((await mod.createPrintFileAccessAction(pending.id, "open")).success, false);

  const open = await mod.createPrintFileAccessAction(ready.id, "open");
  assert.equal(open.success, true);
  const url = new URL(open.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.search, "");
  assert.match(url.pathname, /\/pantalla-nandu\.3mf$/);
  assert.equal(open.url.includes(ready.storage_path), false, "la ruta de almacenamiento nunca sale al cliente");
});
