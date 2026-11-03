import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { PRINT_FILES_BUCKET } from "./config";
import { deriveLinkKey } from "./link-token";
import type { RangeSource } from "./three-mf-container";

/**
 * Acceso del servidor al bucket privado `product-print-files`. Solo se usa DESPUÉS de que la Server Action o la ruta
 * verificó sesión, acceso a la plataforma y propiedad de la fila: el cliente `service_role` salta la RLS.
 */

export function createPrintFilesAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Faltan variables de entorno de Supabase para los archivos de impresión.");
  return createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** {user_id}/{product_id}/{file_id}.3mf — el mismo patrón que exige el CHECK de la tabla. */
export function buildPrintFileStoragePath(userId: string, productId: string, fileId: string): string {
  return `${userId}/${productId}/${fileId}.3mf`;
}

export function getPrintFileLinkKey(): Buffer {
  const secret = process.env.PRINT_FILES_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Falta una clave para firmar los enlaces de archivos de impresión.");
  return deriveLinkKey(secret);
}

export async function createSignedUpload(admin: SupabaseClient, path: string) {
  const { data, error } = await admin.storage.from(PRINT_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return null;
  return { path: data.path ?? path, token: data.token };
}

export async function createSignedDownload(admin: SupabaseClient, path: string, ttlSeconds: number, downloadName?: string) {
  const { data, error } = await admin.storage
    .from(PRINT_FILES_BUCKET)
    .createSignedUrl(path, ttlSeconds, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Elimina objetos; un objeto que ya no existe no es un error. Devuelve false si el almacenamiento falló. */
export async function removeStorageObjects(admin: SupabaseClient, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const { error } = await admin.storage.from(PRINT_FILES_BUCKET).remove(paths);
  if (error) {
    console.error("[print-files] No se pudo eliminar del almacenamiento:", error.message);
    return false;
  }
  return true;
}

export class RemoteObjectError extends Error {}

/**
 * Lector de rangos sobre una URL firmada: pide solo el final del archivo y el directorio central con `Range`.
 * Si el almacenamiento ignorara `Range` y respondiera 200 con el cuerpo completo, se usa ese cuerpo (acotado por
 * `maxBytes` según `Content-Length`) para no inspeccionar más de lo permitido.
 */
export function remoteRangeSource(url: string, maxBytes: number): RangeSource {
  let fullBody: Uint8Array | null = null;

  async function loadFull(response: Response): Promise<Uint8Array> {
    if (fullBody) return fullBody;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new RemoteObjectError("El archivo supera el límite permitido.");
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new RemoteObjectError("El archivo supera el límite permitido.");
    fullBody = buffer;
    return buffer;
  }

  async function request(range: string): Promise<Response> {
    const response = await fetch(url, { headers: { Range: range }, cache: "no-store" });
    if (response.status === 404 || response.status === 400) throw new RemoteObjectError("El archivo no existe en el almacenamiento.");
    if (response.status !== 200 && response.status !== 206) throw new RemoteObjectError(`Respuesta inesperada del almacenamiento (${response.status}).`);
    return response;
  }

  return {
    async readTail(length) {
      if (fullBody) return { bytes: fullBody.subarray(Math.max(0, fullBody.length - length)), totalSize: fullBody.length };
      const response = await request(`bytes=-${length}`);
      if (response.status === 206) {
        const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(response.headers.get("content-range") ?? "");
        if (!match) throw new RemoteObjectError("El almacenamiento no informó el tamaño del archivo.");
        const totalSize = Number(match[1]);
        if (totalSize > maxBytes) throw new RemoteObjectError("El archivo supera el límite permitido.");
        return { bytes: new Uint8Array(await response.arrayBuffer()), totalSize };
      }
      const full = await loadFull(response);
      return { bytes: full.subarray(Math.max(0, full.length - length)), totalSize: full.length };
    },
    async readRange(start, endExclusive) {
      if (fullBody) return fullBody.subarray(start, endExclusive);
      const response = await request(`bytes=${start}-${endExclusive - 1}`);
      if (response.status === 206) return new Uint8Array(await response.arrayBuffer());
      const full = await loadFull(response);
      return full.subarray(start, endExclusive);
    },
  };
}
