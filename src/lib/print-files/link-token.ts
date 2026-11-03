import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ticket firmado para que un laminador de escritorio (sin sesión del navegador) descargue UN archivo durante unos
 * minutos. Es una capacidad de portador: quien tenga el enlace puede descargar ese archivo hasta que venza, y nada
 * más. Va en la ruta (no en la query) porque OrcaSlicer deduce el nombre del archivo del último segmento de la URL.
 *
 * Solo servidor. La clave se deriva de SUPABASE_SERVICE_ROLE_KEY (o PRINT_FILES_LINK_SECRET si se define), de modo
 * que no hace falta una variable nueva para que funcione.
 */

const VERSION = "v1";

export interface OpenTicketPayload {
  fileId: string;
  userId: string;
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function deriveLinkKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("print-file-open-link-v1").digest();
}

function sign(key: Buffer, body: string): string {
  return base64url(createHmac("sha256", key).update(body).digest());
}

export function createOpenTicket(payload: OpenTicketPayload, key: Buffer, ttlSeconds: number, nowMs = Date.now()): string {
  const expires = Math.floor(nowMs / 1000) + ttlSeconds;
  const body = base64url(Buffer.from(JSON.stringify([VERSION, payload.fileId, payload.userId, expires]), "utf8"));
  return `${body}.${sign(key, body)}`;
}

export type OpenTicketResult =
  | { ok: true; payload: OpenTicketPayload; expiresAt: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyOpenTicket(ticket: string, key: Buffer, nowMs = Date.now()): OpenTicketResult {
  if (typeof ticket !== "string" || ticket.length > 512) return { ok: false, reason: "malformed" };
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;

  const expected = Buffer.from(sign(key, body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: "bad_signature" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== VERSION) return { ok: false, reason: "malformed" };
  const [, fileId, userId, expires] = decoded;
  if (typeof fileId !== "string" || typeof userId !== "string" || typeof expires !== "number") return { ok: false, reason: "malformed" };
  if (Math.floor(nowMs / 1000) > expires) return { ok: false, reason: "expired" };
  return { ok: true, payload: { fileId, userId }, expiresAt: expires };
}
