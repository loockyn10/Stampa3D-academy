import { NextRequest, NextResponse } from "next/server";
import { verifyOpenTicket } from "@/lib/print-files/link-token";
import { DOWNLOAD_LINK_TTL_SECONDS } from "@/lib/print-files/config";
import { createPrintFilesAdminClient, createSignedDownload, getPrintFileLinkKey } from "@/lib/print-files/server";
import { UUID_PATTERN } from "@/lib/print-files/validation";

/**
 * Descarga temporal para laminadores de escritorio (Bambu Studio, OrcaSlicer…), que no tienen la sesión del navegador.
 * La autorización es el ticket firmado de la ruta (10 min, un solo archivo; ver link-token.ts). El último segmento
 * (`<nombre>.3mf`) es solo informativo: el archivo lo decide el ticket, nunca la ruta.
 *
 * Se SIRVE el contenido (no se redirige): así el laminador recibe un 200 con el nombre correcto sin depender de que
 * siga redirecciones, y la URL de almacenamiento nunca sale de este servidor.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function denied(status: number, message: string) {
  return new NextResponse(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

async function serve(request: NextRequest, ticket: string, method: "GET" | "HEAD") {
  const verified = verifyOpenTicket(ticket, getPrintFileLinkKey());
  if (!verified.ok) {
    return denied(verified.reason === "expired" ? 410 : 403, verified.reason === "expired" ? "El enlace venció." : "Enlace inválido.");
  }
  const { fileId, userId } = verified.payload;
  if (!UUID_PATTERN.test(fileId) || !UUID_PATTERN.test(userId)) return denied(403, "Enlace inválido.");

  const admin = createPrintFilesAdminClient();
  const { data: row } = await admin
    .from("product_print_files")
    .select("storage_path, file_name, file_size")
    .eq("id", fileId)
    .eq("user_id", userId)
    .eq("status", "ready")
    .maybeSingle();
  if (!row) return denied(404, "El archivo ya no está disponible.");

  const signedUrl = await createSignedDownload(admin, String(row.storage_path), DOWNLOAD_LINK_TTL_SECONDS);
  if (!signedUrl) return denied(502, "No se pudo acceder al archivo.");

  const upstream = await fetch(signedUrl, { method, cache: "no-store", signal: request.signal });
  if (!upstream.ok) return denied(upstream.status === 404 ? 404 : 502, "No se pudo acceder al archivo.");

  const safeName = String(row.file_name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const headers = new Headers({
    ...NO_STORE,
    "Content-Type": "model/3mf",
    "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(String(row.file_name))}`,
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new NextResponse(method === "HEAD" ? null : upstream.body, { status: 200, headers });
}

export async function GET(request: NextRequest, context: { params: Promise<{ ticket: string; filename: string }> }) {
  const { ticket } = await context.params;
  return serve(request, ticket, "GET");
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ ticket: string; filename: string }> }) {
  const { ticket } = await context.params;
  return serve(request, ticket, "HEAD");
}
