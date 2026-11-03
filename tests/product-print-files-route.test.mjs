// Ruta pública /api/print-files/open/{ticket}/{nombre}.3mf: lo que ve un laminador de escritorio (sin sesión).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const KEY = Buffer.alloc(32, 9);

const tokens = loadTs("src/lib/print-files/link-token.ts", { "node:crypto": crypto });

function loadRoute({ row = { storage_path: `${USER_ID}/p/${FILE_ID}.3mf`, file_name: "Pantalla Ñandú.3mf", file_size: 7 }, signed = "https://storage.test/signed" } = {}) {
  const calls = { filters: [], signed: [] };
  const admin = {
    from(table) {
      calls.table = table;
      const chain = {
        select: () => chain,
        eq(column, value) { calls.filters.push([column, value]); return chain; },
        maybeSingle: async () => {
          const owner = calls.filters.find(([c]) => c === "user_id")?.[1];
          const status = calls.filters.find(([c]) => c === "status")?.[1];
          const id = calls.filters.find(([c]) => c === "id")?.[1];
          const visible = row && owner === USER_ID && status === "ready" && id === FILE_ID;
          return { data: visible ? row : null, error: null };
        },
      };
      return chain;
    },
  };
  const mod = loadTs("src/app/api/print-files/open/[ticket]/[filename]/route.ts", {
    "node:crypto": crypto,
    "next/server": { NextRequest: class {}, NextResponse: Response },
    "@/lib/print-files/server": {
      createPrintFilesAdminClient: () => admin,
      createSignedDownload: async (_admin, storagePath, ttl) => { calls.signed.push([storagePath, ttl]); return signed; },
      getPrintFileLinkKey: () => KEY,
    },
  });
  return { mod, calls };
}

const ctx = (ticket) => ({ params: Promise.resolve({ ticket, filename: "pantalla.3mf" }) });
const request = () => ({ signal: new AbortController().signal });
const ticketFor = (overrides = {}, ttl = 600) => tokens.createOpenTicket({ fileId: FILE_ID, userId: USER_ID, ...overrides }, KEY, ttl);

function stubFetch(handler) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push([String(url), init?.method ?? "GET"]); return handler(url, init); };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("ticket válido: sirve el 3MF con cabeceras seguras, sin redirigir y sin exponer la ruta de almacenamiento", async () => {
  const { mod, calls } = loadRoute();
  const fetchStub = stubFetch(() => new Response("ZIPDATA", { status: 200, headers: { "content-length": "7" } }));
  try {
    const response = await mod.GET(request(), ctx(ticketFor()));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ZIPDATA");
    assert.equal(response.headers.get("content-type"), "model/3mf");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-length"), "7");
    assert.match(response.headers.get("content-disposition"), /^attachment; filename="Pantalla _and_\.3mf";/, "nombre ASCII de respaldo");
    assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''Pantalla%20%C3%91and%C3%BA\.3mf/);
    for (const [, value] of response.headers) assert.equal(value.includes("storage.test") || value.includes(USER_ID), false, "ninguna cabecera filtra la URL de almacenamiento ni el dueño");
    assert.deepEqual(calls.signed, [[`${USER_ID}/p/${FILE_ID}.3mf`, 60]], "URL firmada de 60 s, solo al instante de servir");
    assert.deepEqual(fetchStub.requests, [["https://storage.test/signed", "GET"]]);
    assert.ok(calls.filters.some(([c, v]) => c === "user_id" && v === USER_ID) && calls.filters.some(([c, v]) => c === "status" && v === "ready"));
  } finally { fetchStub.restore(); }
});

test("HEAD responde con las cabeceras y sin cuerpo", async () => {
  const { mod } = loadRoute();
  const fetchStub = stubFetch(() => new Response(null, { status: 200, headers: { "content-length": "7" } }));
  try {
    const response = await mod.HEAD(request(), ctx(ticketFor()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), "7");
    assert.equal(await response.text(), "");
    assert.equal(fetchStub.requests[0][1], "HEAD");
  } finally { fetchStub.restore(); }
});

test("ticket vencido → 410; manipulado, de otra clave o basura → 403; nada llega a la base ni al almacenamiento", async () => {
  const { mod, calls } = loadRoute();
  const fetchStub = stubFetch(() => { throw new Error("no debe consultarse el almacenamiento"); });
  try {
    assert.equal((await mod.GET(request(), ctx(ticketFor({}, -5)))).status, 410);
    const good = ticketFor();
    const [body, signature] = good.split(".");
    const forged = Buffer.from(JSON.stringify(["v1", FILE_ID, OTHER_USER, 4_000_000_000])).toString("base64url");
    assert.equal((await mod.GET(request(), ctx(`${forged}.${signature}`))).status, 403);
    assert.equal((await mod.GET(request(), ctx(`${body}.AAAA`))).status, 403);
    const foreignKey = tokens.createOpenTicket({ fileId: FILE_ID, userId: USER_ID }, Buffer.alloc(32, 1), 600);
    assert.equal((await mod.GET(request(), ctx(foreignKey))).status, 403);
    assert.equal((await mod.GET(request(), ctx("basura"))).status, 403);
    assert.equal(calls.signed.length, 0);
    assert.equal(calls.table, undefined, "ni siquiera se consultó la tabla");
  } finally { fetchStub.restore(); }
});

test("un ticket de un usuario no abre el archivo de otro, ni un archivo pendiente o inexistente (404)", async () => {
  const { mod, calls } = loadRoute();
  const fetchStub = stubFetch(() => { throw new Error("no debe consultarse el almacenamiento"); });
  try {
    const foreignOwner = await mod.GET(request(), ctx(ticketFor({ userId: OTHER_USER })));
    assert.equal(foreignOwner.status, 404);
    const missingRow = loadRoute({ row: null });
    assert.equal((await missingRow.mod.GET(request(), ctx(ticketFor()))).status, 404);
    assert.equal(calls.signed.length, 0);
  } finally { fetchStub.restore(); }
});

test("errores del almacenamiento: objeto inexistente → 404; cualquier otro fallo → 502 sin detalles internos", async () => {
  const { mod } = loadRoute();
  for (const [upstreamStatus, expected] of [[404, 404], [500, 502], [403, 502]]) {
    const fetchStub = stubFetch(() => new Response("detalle interno secreto", { status: upstreamStatus }));
    try {
      const response = await mod.GET(request(), ctx(ticketFor()));
      assert.equal(response.status, expected);
      assert.doesNotMatch(await response.text(), /secreto|storage\.test|signed/);
    } finally { fetchStub.restore(); }
  }
  const noSignedUrl = loadRoute({ signed: null });
  assert.equal((await noSignedUrl.mod.GET(request(), ctx(ticketFor()))).status, 502);
});
