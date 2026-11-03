import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { loadTs } from "./helpers/load-ts.mjs";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const config = loadTs("src/lib/print-files/config.ts");
const slicers = loadTs("src/lib/print-files/slicers.ts");
const plan = loadTs("src/lib/print-files/open-plan.ts");
const validation = loadTs("src/lib/print-files/validation.ts");
const container = loadTs("src/lib/print-files/three-mf-container.ts");
const loadState = loadTs("src/lib/print-files/load-state.ts");
const tokens = loadTs("src/lib/print-files/link-token.ts", { "node:crypto": crypto });

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

// ------------------------------------------------------------------------------------------ límites

test("el límite de tamaño es configurable pero nunca supera el techo del bucket", () => {
  assert.equal(config.resolvePrintFileMaxBytes(undefined), config.PRINT_FILE_DEFAULT_MAX_BYTES);
  assert.equal(config.resolvePrintFileMaxBytes("abc"), config.PRINT_FILE_DEFAULT_MAX_BYTES);
  assert.equal(config.resolvePrintFileMaxBytes("0"), config.PRINT_FILE_DEFAULT_MAX_BYTES);
  assert.equal(config.resolvePrintFileMaxBytes("40"), 40 * 1024 * 1024);
  assert.equal(config.resolvePrintFileMaxBytes("9999"), config.PRINT_FILE_ABSOLUTE_MAX_BYTES);
  assert.ok(config.PRINT_FILE_DEFAULT_MAX_BYTES >= 50 * 1024 * 1024, "un 3MF con texturas no debe topearse en pocos MB");
});

// ------------------------------------------------------------------------------------------ registro

test("el registro de laminadores tiene los tres laminadores con su logo real en /public", () => {
  assert.deepEqual([...slicers.SLICER_IDS].sort(), ["bambu_studio", "flash_studio", "orcaslicer"]);
  for (const slicer of slicers.SLICERS) {
    assert.ok(fs.existsSync(path.join(root, "public", slicer.logo)), `falta el logo de ${slicer.label}`);
    const header = fs.readFileSync(path.join(root, "public", slicer.logo)).subarray(0, 8);
    assert.deepEqual([...header], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${slicer.logo} es un PNG`);
    assert.match(slicer.id, /^[a-z][a-z0-9_]{1,31}$/, "el id respeta el CHECK de la base");
  }
  assert.equal(slicers.isSlicerId("bambu_studio"), true);
  assert.equal(slicers.isSlicerId("cura"), false);
  assert.equal(slicers.isSlicerId(null), false);
});

// -------------------------------------------------------------------------------- apertura por laminador

const FILE_URL = "https://app.example.com/api/print-files/open/TICKET/lampara.3mf";

test("detecta el sistema del dispositivo, incluido iPadOS que se presenta como Mac", () => {
  const d = plan.detectClientPlatform;
  assert.equal(d({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140" }), "windows");
  assert.equal(d({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", platform: "MacIntel", maxTouchPoints: 0 }), "macos");
  assert.equal(d({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", platform: "MacIntel", maxTouchPoints: 5 }), "ios");
  assert.equal(d({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140 Mobile" }), "android");
  assert.equal(d({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }), "ios");
  assert.equal(d({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130" }), "linux");
  assert.equal(d({}), "unknown");
});

test("Bambu Studio: esquema verificado por sistema (Windows bambustudio://, macOS bambustudioopen://)", () => {
  assert.deepEqual(plan.buildOpenPlan("bambu_studio", "windows", FILE_URL), { method: "protocol", href: `bambustudio://open?file=${FILE_URL}` });
  assert.deepEqual(plan.buildOpenPlan("bambu_studio", "macos", FILE_URL), { method: "protocol", href: `bambustudioopen://${FILE_URL}` });
});

test("OrcaSlicer: orcaslicer://open?file= en Windows y macOS", () => {
  const expected = { method: "protocol", href: `orcaslicer://open?file=${FILE_URL}` };
  assert.deepEqual(plan.buildOpenPlan("orcaslicer", "windows", FILE_URL), expected);
  assert.deepEqual(plan.buildOpenPlan("orcaslicer", "macos", FILE_URL), expected);
});

test("Flash Studio no tiene esquema propio verificable: siempre descarga con explicación", () => {
  for (const platform of ["windows", "macos", "linux", "unknown"]) {
    assert.deepEqual(plan.buildOpenPlan("flash_studio", platform, FILE_URL), { method: "download", reason: "no_deep_link" });
  }
  assert.equal(plan.supportsDirectOpen("flash_studio", "windows"), false);
  // No se inventó ningún esquema: ni el propio ni el de otro laminador.
  assert.deepEqual(slicers.getSlicer("flash_studio").deepLink, {});
  const registry = read("src/lib/print-files/slicers.ts");
  assert.doesNotMatch(registry, /flashforge:\/\/|flashstudio:\/\/|orcaflashforge:\/\//i);
});

test("en celulares y tablets se prioriza la descarga para todos los laminadores", () => {
  for (const slicer of slicers.SLICER_IDS) {
    for (const platform of ["android", "ios"]) {
      assert.deepEqual(plan.buildOpenPlan(slicer, platform, FILE_URL), { method: "download", reason: "mobile" });
      assert.equal(plan.supportsDirectOpen(slicer, platform), false);
    }
  }
});

test("Linux y sistemas desconocidos no intentan un esquema que no está verificado allí", () => {
  assert.deepEqual(plan.buildOpenPlan("bambu_studio", "linux", FILE_URL), { method: "download", reason: "unsupported_platform" });
  assert.deepEqual(plan.buildOpenPlan("orcaslicer", "unknown", FILE_URL), { method: "download", reason: "unsupported_platform" });
  assert.deepEqual(plan.buildOpenPlan("desconocido", "windows", FILE_URL), { method: "download", reason: "no_deep_link" });
});

test("un enlace que no es http(s) jamás llega a un esquema externo", () => {
  assert.equal(plan.buildOpenPlan("bambu_studio", "windows", "javascript:alert(1)").method, "download");
  assert.equal(plan.buildOpenPlan("orcaslicer", "windows", "file:///C:/x.3mf").method, "download");
});

test("los mensajes de descarga nunca hablan de una apertura exitosa", () => {
  for (const reason of ["mobile", "no_deep_link", "unsupported_platform"]) {
    const message = plan.describeDownloadReason(reason, "Flash Studio");
    assert.match(message, /descarg/i);
    assert.doesNotMatch(message, /se abri[óo]|abierto con [eé]xito|abrimos/i);
  }
  const clientOpen = read("src/lib/print-files/client-open.ts");
  assert.match(clientOpen, /NO es una confirmación/);
  assert.match(clientOpen, /Si no se abrió, descargá el archivo/);
});

// ------------------------------------------------------------------------------------------ validación

test("solo se aceptan archivos .3mf con tamaño razonable", () => {
  const max = 100 * 1024 * 1024;
  assert.equal(validation.validatePrintFileUpload({ fileName: "lampara.3mf", size: 5_000_000 }, max).ok, true);
  assert.equal(validation.validatePrintFileUpload({ fileName: "LAMPARA.3MF", size: 5_000_000 }, max).ok, true);
  assert.equal(validation.validatePrintFileUpload({ fileName: "modelo.stl", size: 5_000_000 }, max).ok, false);
  assert.equal(validation.validatePrintFileUpload({ fileName: "malo.3mf.exe", size: 5_000_000 }, max).ok, false);
  assert.equal(validation.validatePrintFileUpload({ fileName: "vacio.3mf", size: 0 }, max).ok, false);
  const big = validation.validatePrintFileUpload({ fileName: "grande.3mf", size: max + 1 }, max);
  assert.equal(big.ok, false);
  assert.match(big.error, /100 MB/);
  assert.equal(validation.validatePrintFileUpload({ fileName: "x.3mf", size: "abc" }, max).ok, false);
});

test("el nombre original no conserva rutas ni caracteres de control", () => {
  assert.equal(validation.sanitizeOriginalFileName("C:\\Users\\yo\\..\\pantalla.3mf"), "pantalla.3mf");
  assert.equal(validation.sanitizeOriginalFileName("../../etc/passwd.3mf"), "passwd.3mf");
  assert.equal(validation.sanitizeOriginalFileName("a\u0000b\nc.3mf"), "a b c.3mf");
  assert.ok(validation.sanitizeOriginalFileName(`${"x".repeat(400)}.3mf`).endsWith(".3mf"));
  assert.ok(validation.sanitizeOriginalFileName(`${"x".repeat(400)}.3mf`).length <= 180);
});

test("el último segmento de la URL siempre termina en .3mf y no lleva caracteres peligrosos", () => {
  assert.equal(validation.toUrlFileName("Pantalla Ondulada Ñandú.3mf"), "pantalla-ondulada-nandu.3mf");
  assert.equal(validation.toUrlFileName("a?b=c#d&e.3mf"), "abcde.3mf");
  assert.equal(validation.toUrlFileName("../../x.3mf"), "x.3mf");
  assert.equal(validation.toUrlFileName("???.3mf"), "proyecto.3mf");
  assert.match(validation.toUrlFileName("lo que sea.3MF"), /^[a-z0-9._-]+\.3mf$/);
});

test("los metadatos: obligatorios mínimos, opcionales validados, nada de formularios largos", () => {
  const ok = validation.validatePrintFileMetadata({ name: "  Pantalla  A1 ", slicer: "bambu_studio" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, {
    name: "Pantalla A1", slicer: "bambu_studio", componentId: null, printerId: null, printerName: null, estMinutes: null, estGrams: null, material: null,
  });
  assert.equal(validation.validatePrintFileMetadata({ slicer: "orcaslicer" }, "lampara").value.name, "lampara", "el nombre propuesto es el del archivo");
  assert.equal(validation.validatePrintFileMetadata({ name: "x" }).ok, false, "el laminador es obligatorio");
  assert.equal(validation.validatePrintFileMetadata({ name: "x", slicer: "cura" }).ok, false, "solo laminadores registrados");
  assert.equal(validation.validatePrintFileMetadata({ name: "x".repeat(81), slicer: "orcaslicer" }).ok, false);
  assert.equal(validation.validatePrintFileMetadata({ name: "x", slicer: "orcaslicer", componentId: "no-uuid" }).ok, false);
  assert.equal(validation.validatePrintFileMetadata({ name: "x", slicer: "orcaslicer", printerId: "1; drop table" }).ok, false);
  assert.equal(validation.validatePrintFileMetadata({ name: "x", slicer: "orcaslicer", estMinutes: -5 }).ok, false);
  assert.equal(validation.validatePrintFileMetadata({ name: "x", slicer: "orcaslicer", estMinutes: 1.5 }).ok, false);
  assert.equal(validation.validatePrintFileMetadata({ name: "x", slicer: "orcaslicer", estGrams: "mucho" }).ok, false);

  const full = validation.validatePrintFileMetadata({
    name: "Pantalla", slicer: "flash_studio", componentId: UUID_A, printerId: UUID_B, printerName: " Adventurer 5M ", estMinutes: "220", estGrams: "125,5", material: "PLA Translúcido",
  });
  assert.equal(full.ok, true);
  assert.equal(full.value.estMinutes, 220);
  assert.equal(full.value.estGrams, 125.5);
  assert.equal(full.value.printerName, "Adventurer 5M");
});

test("el tiempo se muestra como en Mi Taller (h y min)", () => {
  assert.equal(validation.formatPrintMinutes(220), "3 h 40 min");
  assert.equal(validation.formatPrintMinutes(45), "45 min");
  assert.equal(validation.formatPrintMinutes(120), "2 h");
  assert.equal(validation.formatPrintMinutes(null), null);
});

// -------------------------------------------------------------------------- contenedor 3MF (sin descomprimir)

async function build3mf({ entries, comment } = {}) {
  const zip = new JSZip();
  const files = entries ?? {
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "_rels/.rels": '<?xml version="1.0"?><Relationships/>',
    "3D/3dmodel.model": '<?xml version="1.0"?><model unit="millimeter"><resources/><build/></model>',
  };
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", comment });
}

const sourceOf = (bytes) => container.blobRangeSource(new Blob([bytes]));

/** Ubica el directorio central y pisa un campo de la primera entrada. */
function patchFirstCentralEntry(bytes, offset, value, size = 4) {
  const copy = new Uint8Array(bytes);
  const dv = new DataView(copy.buffer);
  for (let i = 0; i < copy.length - 4; i += 1) {
    if (dv.getUint32(i, true) === 0x02014b50) {
      if (size === 4) dv.setUint32(i + offset, value, true);
      else dv.setUint16(i + offset, value, true);
      return copy;
    }
  }
  throw new Error("sin directorio central");
}

test("un 3MF válido pasa la verificación sin descomprimirse", async () => {
  const result = await container.inspectThreeMfContainer(sourceOf(await build3mf()));
  assert.equal(result.ok, true);
  assert.equal(result.entryCount, 5, "3 archivos + las carpetas _rels/ y 3D/ que agrega JSZip");
});

test("un archivo renombrado a .3mf que no es un ZIP se rechaza", async () => {
  const text = new TextEncoder().encode("solid cubo\nendsolid cubo\n".repeat(20));
  assert.equal((await container.inspectThreeMfContainer(sourceOf(text))).code, "not_zip");
  assert.equal((await container.inspectThreeMfContainer(sourceOf(new Uint8Array(10)))).code, "not_zip");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(200).fill(7)]);
  assert.equal((await container.inspectThreeMfContainer(sourceOf(png))).code, "not_zip");
});

test("un ZIP cualquiera (sin estructura 3MF) se rechaza", async () => {
  const zip = await build3mf({ entries: { "readme.txt": "hola", "foto.png": "x" } });
  assert.equal((await container.inspectThreeMfContainer(sourceOf(zip))).code, "not_3mf");
  const noModel = await build3mf({ entries: { "[Content_Types].xml": "<Types/>", "otro.txt": "x" } });
  assert.equal((await container.inspectThreeMfContainer(sourceOf(noModel))).code, "not_3mf");
});

test("un ZIP truncado se rechaza", async () => {
  const bytes = await build3mf();
  const truncated = bytes.subarray(0, bytes.length - 30);
  const result = await container.inspectThreeMfContainer(sourceOf(truncated));
  assert.equal(result.ok, false);
  assert.ok(["not_zip", "corrupt"].includes(result.code));
});

test("rutas internas con .. o absolutas se rechazan (zip-slip en el laminador)", async () => {
  const evil = await build3mf({
    entries: { "[Content_Types].xml": "<Types/>", "3D/3dmodel.model": "<model/>", "../../escape.txt": "x" },
  });
  assert.equal((await container.inspectThreeMfContainer(sourceOf(evil))).code, "unsafe_entry_name");
  assert.equal(container.isUnsafeEntryName("/etc/passwd"), true);
  assert.equal(container.isUnsafeEntryName("C:\\Windows\\x"), true);
  assert.equal(container.isUnsafeEntryName("a/../../b"), true);
  assert.equal(container.isUnsafeEntryName("3D/3dmodel.model"), false);
  assert.equal(container.isUnsafeEntryName("Metadata/plate_1.png"), false);
});

test("una bomba de compresión (tamaños declarados enormes) se rechaza sin descomprimir", async () => {
  const bytes = await build3mf();
  const bomb = patchFirstCentralEntry(bytes, 24, 0x7fffffff);
  assert.equal((await container.inspectThreeMfContainer(sourceOf(bomb))).code, "entry_too_large");
});

test("entradas cifradas y ZIP64 se rechazan", async () => {
  const bytes = await build3mf();
  assert.equal((await container.inspectThreeMfContainer(sourceOf(patchFirstCentralEntry(bytes, 8, 0x0001, 2)))).code, "encrypted");
  assert.equal((await container.inspectThreeMfContainer(sourceOf(patchFirstCentralEntry(bytes, 24, 0xffffffff)))).code, "unsupported_zip64");
});

test("demasiadas entradas internas se rechazan", async () => {
  const entries = { "[Content_Types].xml": "<Types/>", "3D/3dmodel.model": "<model/>" };
  for (let i = 0; i < 20_001; i += 1) entries[`Metadata/p${i}.txt`] = "";
  const zip = await build3mf({ entries });
  assert.equal((await container.inspectThreeMfContainer(sourceOf(zip))).code, "too_many_entries");
});

test("un comentario ZIP con la firma EOCD no engaña al lector", async () => {
  const bytes = await build3mf({ comment: "PK\u0005\u0006 falsa firma dentro del comentario" });
  assert.equal((await container.inspectThreeMfContainer(sourceOf(bytes))).ok, true);
});

test("con un directorio central grande solo se piden rangos (nunca el archivo entero)", async () => {
  const entries = { "[Content_Types].xml": "<Types/>", "3D/3dmodel.model": "<model/>" };
  for (let i = 0; i < 1500; i += 1) entries[`Metadata/${"d".repeat(60)}/pieza-${i}.config`] = "x";
  const bytes = await build3mf({ entries });
  const blob = new Blob([bytes]);
  const ranges = [];
  const source = {
    async readTail(length) {
      ranges.push(["tail", length]);
      return container.blobRangeSource(blob).readTail(length);
    },
    async readRange(start, end) {
      ranges.push([start, end]);
      return container.blobRangeSource(blob).readRange(start, end);
    },
  };
  const result = await container.inspectThreeMfContainer(source);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(ranges.length <= 3, `pocas lecturas: ${JSON.stringify(ranges)}`);
  for (const [start, end] of ranges.filter(([a]) => a !== "tail")) assert.ok(end - start < bytes.length, "ningún rango es el archivo completo");
});

// ----------------------------------------------------------------------------------------- ticket firmado

test("el ticket autoriza solo el archivo y el usuario firmados y vence", () => {
  const key = tokens.deriveLinkKey("clave-de-prueba");
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const ticket = tokens.createOpenTicket({ fileId: UUID_A, userId: UUID_B }, key, 600, now);

  const ok = tokens.verifyOpenTicket(ticket, key, now + 1000);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.payload, { fileId: UUID_A, userId: UUID_B });
  assert.equal(tokens.verifyOpenTicket(ticket, key, now + 601_000).reason, "expired");
  assert.equal(tokens.verifyOpenTicket(ticket, tokens.deriveLinkKey("otra-clave"), now).reason, "bad_signature");

  const [body, signature] = ticket.split(".");
  const forged = Buffer.from(JSON.stringify(["v1", UUID_B, UUID_B, 4_000_000_000])).toString("base64url");
  assert.equal(tokens.verifyOpenTicket(`${forged}.${signature}`, key, now).reason, "bad_signature", "cambiar el payload invalida la firma");
  assert.equal(tokens.verifyOpenTicket(`${body}.`, key, now).reason, "malformed");
  assert.equal(tokens.verifyOpenTicket("basura", key, now).reason, "malformed");
  assert.equal(tokens.verifyOpenTicket("x".repeat(600), key, now).reason, "malformed");
  assert.equal(ticket.includes("?"), false, "el ticket va en la ruta, no en la query");
  assert.match(ticket, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

// ------------------------------------------------------------------------------ Server Actions (con mocks)

function loadActions({ access = "paid", featureAvailable = true, rows = {} } = {}) {
  const calls = [];
  const builder = (table) => {
    const state = { table, filters: [], op: "select" };
    const result = () => {
      calls.push({ ...state });
      const data = rows[table] ?? null;
      return { data, error: null, count: Array.isArray(data) ? data.length : 0 };
    };
    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve) => resolve(result());
        if (["select", "insert", "update", "delete"].includes(prop)) return (...args) => { state.op = prop; state.args = args; return chain; };
        if (["eq", "lt", "in", "order", "limit"].includes(prop)) return (...args) => { state.filters.push([prop, ...args]); return chain; };
        if (prop === "maybeSingle" || prop === "single") return async () => result();
        return () => chain;
      },
    });
    return chain;
  };
  const supabase = { from: builder };
  const mod = loadTs("src/app/productos/print-file-actions.ts", {
    "node:crypto": crypto,
    "next/headers": { headers: async () => new Headers({ host: "localhost:3000" }) },
    "@/utils/supabase/server": { createClient: async () => supabase },
    "@/lib/auth/user-access": {
      getCurrentUserAccess: async () => ({
        error: null,
        access: { userId: access === "anon" ? null : UUID_A, capabilities: { accessPlatform: access === "paid" } },
      }),
    },
    "@/lib/features/server": {
      FEATURE_UNAVAILABLE_MESSAGE: "Esta herramienta todavía no está disponible.",
      isFeatureAvailable: async () => featureAvailable,
    },
    "@/lib/print-files/server": {
      RemoteObjectError: class extends Error {},
      buildPrintFileStoragePath: () => "x",
      createPrintFilesAdminClient: () => { throw new Error("no debe tocarse el almacenamiento"); },
      createSignedDownload: async () => null,
      createSignedUpload: async () => null,
      getPrintFileLinkKey: () => tokens.deriveLinkKey("k"),
      remoteRangeSource: () => ({}),
      removeStorageObjects: async () => true,
    },
  });
  return { mod, calls };
}

test("ninguna acción responde ni toca la base sin acceso a la plataforma (Free / anónimo)", async () => {
  for (const access of ["free", "anon"]) {
    const { mod, calls } = loadActions({ access });
    const results = [
      await mod.prepareProductPrintFileUploadAction({ productId: UUID_A, fileName: "a.3mf", size: 5_000_000, metadata: { name: "x", slicer: "orcaslicer" } }),
      await mod.completeProductPrintFileUploadAction(UUID_A),
      await mod.updateProductPrintFileAction(UUID_A, { name: "x", slicer: "orcaslicer" }),
      await mod.deleteProductPrintFileAction(UUID_A),
      await mod.createPrintFileAccessAction(UUID_A, "download"),
      await mod.createPrintFileAccessAction(UUID_A, "open"),
    ];
    for (const result of results) assert.equal(result.success, false, `acceso ${access}`);
    assert.equal(calls.length, 0, "no se consultó ninguna tabla");
  }
});

test("con la funcionalidad Mi Taller deshabilitada tampoco se opera", async () => {
  const { mod, calls } = loadActions({ featureAvailable: false });
  const result = await mod.deleteProductPrintFileAction(UUID_A);
  assert.equal(result.success, false);
  assert.match(result.error, /no está disponible/);
  assert.equal(calls.length, 0);
});

test("las acciones validan ids, extensión, tamaño y metadatos antes de consultar la base", async () => {
  const { mod, calls } = loadActions();
  assert.equal((await mod.prepareProductPrintFileUploadAction({ productId: "no-uuid", fileName: "a.3mf", size: 5_000_000 })).success, false);
  assert.equal((await mod.prepareProductPrintFileUploadAction({ productId: UUID_A, fileName: "a.stl", size: 5_000_000 })).success, false);
  assert.equal((await mod.prepareProductPrintFileUploadAction({ productId: UUID_A, fileName: "a.3mf", size: 900_000_000 })).success, false);
  assert.equal((await mod.prepareProductPrintFileUploadAction({ productId: UUID_A, fileName: "a.3mf", size: 5_000_000, replaceFileId: "x" })).success, false);
  assert.equal((await mod.completeProductPrintFileUploadAction("1; drop")).success, false);
  assert.equal((await mod.updateProductPrintFileAction(UUID_A, { name: "x", slicer: "cura" })).success, false);
  assert.equal((await mod.deleteProductPrintFileAction("../x")).success, false);
  assert.equal((await mod.createPrintFileAccessAction(UUID_A, "ver")).success, false);
  assert.equal(calls.length, 0);
});

test("un producto ajeno o inexistente no permite crear un proyecto", async () => {
  const { mod, calls } = loadActions({ rows: { products: null } });
  const result = await mod.prepareProductPrintFileUploadAction({
    productId: UUID_B, fileName: "a.3mf", size: 5_000_000, metadata: { name: "x", slicer: "bambu_studio" },
  });
  assert.equal(result.success, false);
  assert.match(result.error, /no se encontró el producto/i);
  const productQuery = calls.find((call) => call.table === "products");
  assert.deepEqual(productQuery.filters.find(([, column]) => column === "user_id"), ["eq", "user_id", UUID_A], "el dueño sale de la sesión del servidor");
  assert.equal(calls.some((call) => call.table === "product_print_files" && call.op === "insert"), false, "no se insertó nada");
});

test("el enlace de descarga/apertura de un archivo ajeno no se genera", async () => {
  const { mod, calls } = loadActions({ rows: { product_print_files: null } });
  assert.equal((await mod.createPrintFileAccessAction(UUID_B, "download")).success, false);
  assert.equal((await mod.createPrintFileAccessAction(UUID_B, "open")).success, false);
  const query = calls.find((call) => call.table === "product_print_files");
  assert.ok(query.filters.some(([, column, value]) => column === "user_id" && value === UUID_A));
  assert.ok(query.filters.some(([, column, value]) => column === "status" && value === "ready"), "solo archivos verificados");
});

test("el enlace de apertura termina en .3mf, no lleva query y usa el origen de la solicitud", async () => {
  const { mod } = loadActions({
    rows: { product_print_files: { id: UUID_A, file_name: "Pantalla Ondulada.3mf", storage_path: `${UUID_A}/${UUID_B}/${UUID_A}.3mf` } },
  });
  const result = await mod.createPrintFileAccessAction(UUID_A, "open");
  assert.equal(result.success, true);
  const url = new URL(result.url);
  assert.equal(url.origin, "http://localhost:3000");
  assert.equal(url.search, "");
  assert.match(url.pathname, /^\/api\/print-files\/open\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/pantalla-ondulada\.3mf$/);
});

// ------------------------------------------------------------------------------------ cableado estático

const migration = read("supabase/migrations/20261102130000_product_print_files.sql");

test("la migration es aditiva, valida dependencias y deja el bucket privado y sin policies para usuarios", () => {
  assert.match(migration, /Missing dependency: public\.products/);
  assert.match(migration, /create table if not exists public\.product_print_files/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from|alter table public\.products/i);
  // Estrictamente aditiva: no escribe ni altera datos de Mi Taller. Solo crea objetos propios y el bucket.
  assert.doesNotMatch(migration, /\bupdate\s+public\./i);
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\./i);
  assert.doesNotMatch(migration, /\balter\s+table\s+(?!public\.product_print_files)/i);
  assert.deepEqual([...migration.matchAll(/\binsert\s+into\s+([\w.]+)/gi)].map((m) => m[1]), ["storage.buckets"]);
  assert.match(migration, /requires uuid id\/user_id\/product_id columns/, "valida los tipos de las tablas de las que depende");
  assert.match(migration, /values \('product-print-files', 'product-print-files', false,/);
  assert.doesNotMatch(migration, /on storage\.objects/i, "sin policies sobre storage.objects: solo el servidor accede");
  assert.match(migration, /enable row level security/);
  for (const policy of ["select_own", "insert_own", "update_own", "delete_own", "admin_all"]) {
    assert.match(migration, new RegExp(`product_print_files_${policy}`));
  }
  assert.match(migration, /has_platform_access/);
  assert.match(migration, /grant update \(name, slicer, component_id, printer_id, printer_name, est_minutes, est_grams, material\)/);
  assert.doesNotMatch(migration, /grant update \([^)]*(status|storage_path|file_size|user_id)/, "el cliente no puede marcar ready ni mover la ruta");
});

test("el navegador nunca lee storage_path ni usa select(*) sobre los archivos", () => {
  const types = read("src/lib/print-files/types.ts");
  const columns = /PRINT_FILE_COLUMNS =\s*"([^"]+)"/.exec(types)[1];
  assert.doesNotMatch(columns, /storage_path|user_id|status|replaces_id/);
  for (const file of [
    "src/components/products/print-files/print-files-section.tsx",
    "src/components/products/print-files/print-file-form-dialog.tsx",
    "src/app/productos/print-file-actions.ts",
  ]) {
    assert.doesNotMatch(read(file), /select\("\*"\)|select\('\*'\)/, file);
  }
});

test("Server Actions: sesión del servidor, acceso, feature flag y propiedad; sin user_id del cliente", () => {
  const actions = read("src/app/productos/print-file-actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /accessPlatform/);
  assert.match(actions, /isFeatureAvailable\(supabase, "mi_taller"/);
  assert.match(actions, /user_id: auth\.userId/);
  assert.doesNotMatch(actions, /input\.userId|input\.user_id|metadata\.userId/);
  // Cada lectura/escritura de archivos se acota al dueño.
  const fromCalls = actions.match(/from\("product_print_files"\)/g)?.length ?? 0;
  const ownerScoped = actions.match(/\.eq\("user_id", auth\.userId\)/g)?.length ?? 0;
  assert.ok(fromCalls > 0 && ownerScoped >= fromCalls, `${ownerScoped} filtros de dueño para ${fromCalls} consultas`);
  // Verificación del contenido antes de publicar y objeto antes que fila al eliminar.
  assert.match(actions, /inspectThreeMfContainer\(remoteRangeSource/);
  assert.match(actions, /status: "ready"/);
  assert.ok(actions.indexOf("removeStorageObjects(createPrintFilesAdminClient(), [String(row.storage_path)])") < actions.indexOf('.delete().eq("id", fileId)', actions.indexOf("export async function deleteProductPrintFileAction")));
});

test("la ruta de apertura temporal es pública solo por ticket y sirve el archivo sin redirigir", () => {
  const middleware = read("src/utils/supabase/middleware.ts");
  assert.match(middleware, /"\/api\/print-files\/open"/);
  assert.doesNotMatch(middleware, /"\/api\/print-files"[,\]]/, "solo la subruta open es pública");
  const route = read("src/app/api/print-files/open/[ticket]/[filename]/route.ts");
  assert.match(route, /verifyOpenTicket/);
  assert.match(route, /force-dynamic/);
  assert.match(route, /no-store/);
  assert.doesNotMatch(route, /NextResponse\.redirect|Response\.redirect/);
  assert.match(route, /\.eq\("user_id", userId\)/);
  assert.match(route, /\.eq\("status", "ready"\)/);
});

test("el detalle del producto monta la sección y no toca costos ni tiempos", () => {
  const page = read("src/app/productos/page.tsx");
  assert.match(page, /<PrintFilesSection/);
  const section = read("src/components/products/print-files/print-files-section.tsx");
  for (const label of ["Archivos de impresión", "Agregar proyecto", "Abrir en"]) assert.match(section, new RegExp(label));
  for (const forbidden of ["base_cost", "sale_price", "print_time_minutes", "calculateProductPrice", "recalculate"]) {
    for (const file of [
      section,
      read("src/components/products/print-files/print-file-form-dialog.tsx"),
      read("src/app/productos/print-file-actions.ts"),
    ]) assert.doesNotMatch(file, new RegExp(forbidden), `los archivos de impresión no tocan ${forbidden}`);
  }
});

test("la UI no expone el laminador por iconos genéricos y muestra los tres logos reales", () => {
  const section = read("src/components/products/print-files/print-files-section.tsx");
  assert.match(section, /SLICERS\.map/);
  assert.match(read("src/components/products/print-files/slicer-logo.tsx"), /slicer\.logo/);
  assert.doesNotMatch(section, /Printer\b.*lucide|from "lucide-react"[^;]*\bPrinter\b/);
});

test("si la tabla todavía no existe (migration sin aplicar) la sección se oculta; otros errores se muestran con reintento", () => {
  const c = loadState.classifyPrintFilesLoadError;
  assert.equal(c({ code: "42P01", message: 'relation "public.product_print_files" does not exist' }), "unavailable");
  assert.equal(c({ code: "PGRST205", message: "Could not find the table 'public.product_print_files' in the schema cache" }), "unavailable");
  assert.equal(c({ message: "Could not find the table 'public.product_print_files' in the schema cache" }), "unavailable");
  assert.equal(c({ code: "PGRST301", message: "JWT expired" }), "error");
  assert.equal(c({ message: "Failed to fetch" }), "error");
  assert.equal(c({ code: "42501", message: "permission denied for table product_print_files" }), "error", "un permiso denegado no es 'tabla inexistente'");
  assert.equal(c(null), "error");

  const section = read("src/components/products/print-files/print-files-section.tsx");
  assert.match(section, /classifyPrintFilesLoadError\(error\)/);
  assert.match(section, /status === "unavailable"\) return null/, "la sección no renderiza nada sin la tabla");
});

test("los botones prometen solo lo que harán: 'Abrir en' únicamente si hay apertura directa verificada en ese sistema", () => {
  const section = read("src/components/products/print-files/print-files-section.tsx");
  assert.match(section, /supportsDirectOpen\(file\.slicer, platform\)/);
  assert.match(section, /direct \? `Abrir en/);
  assert.match(section, /se descarga/);
  // Ningún texto de la UI ni del cliente afirma que la apertura haya funcionado.
  for (const file of [section, read("src/lib/print-files/client-open.ts"), read("src/lib/print-files/slicers.ts")]) {
    assert.doesNotMatch(file, /se abri[óo] correctamente|abierto con [eé]xito|se abrió en/i);
  }
  assert.match(read("src/lib/print-files/slicers.ts"), /instancia única/, "limitación de Bambu Studio documentada en la UI");
});
