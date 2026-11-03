"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { FEATURE_UNAVAILABLE_MESSAGE, isFeatureAvailable } from "@/lib/features/server";
import {
  DOWNLOAD_LINK_TTL_SECONDS,
  MAX_PRINT_FILES_PER_PRODUCT,
  MAX_PRINT_FILES_PER_USER,
  OPEN_LINK_TTL_SECONDS,
  PENDING_UPLOAD_TTL_MS,
  PRINT_FILE_MIN_BYTES,
  resolvePrintFileMaxBytes,
} from "@/lib/print-files/config";
import { createOpenTicket } from "@/lib/print-files/link-token";
import {
  RemoteObjectError,
  buildPrintFileStoragePath,
  createPrintFilesAdminClient,
  createSignedDownload,
  createSignedUpload,
  getPrintFileLinkKey,
  remoteRangeSource,
  removeStorageObjects,
} from "@/lib/print-files/server";
import { inspectThreeMfContainer } from "@/lib/print-files/three-mf-container";
import { PRINT_FILE_COLUMNS, type PrintFile } from "@/lib/print-files/types";
import {
  UUID_PATTERN,
  stripThreeMfExtension,
  toUrlFileName,
  validatePrintFileMetadata,
  validatePrintFileUpload,
  type PrintFileMetadata,
} from "@/lib/print-files/validation";
import { createClient } from "@/utils/supabase/server";

type Failure = { success: false; error: string };
const fail = (error: string): Failure => ({ success: false, error });

const GENERIC_ERROR = "No se pudo completar la operación. Probá de nuevo.";
const INVALID_FILE = "El archivo seleccionado no es válido.";
const NOT_FOUND = "No se encontró el archivo o no te pertenece.";

async function authorize() {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.userId || !access.capabilities.accessPlatform) {
    return { ok: false, error: "No tenés permiso para administrar archivos de impresión." } as const;
  }
  if (!(await isFeatureAvailable(supabase, "mi_taller", access))) {
    return { ok: false, error: FEATURE_UNAVAILABLE_MESSAGE } as const;
  }
  return { ok: true, supabase, userId: access.userId } as const;
}

type Authorized = Extract<Awaited<ReturnType<typeof authorize>>, { ok: true }>;

function metadataColumns(metadata: PrintFileMetadata) {
  return {
    name: metadata.name,
    slicer: metadata.slicer,
    component_id: metadata.componentId,
    printer_id: metadata.printerId,
    printer_name: metadata.printerName,
    est_minutes: metadata.estMinutes,
    est_grams: metadata.estGrams,
    material: metadata.material,
  };
}

/** La pieza debe ser una pieza activa de ESTE producto del usuario (la base lo vuelve a exigir con un trigger). */
async function componentBelongsToProduct(auth: Authorized, productId: string, componentId: string | null): Promise<boolean> {
  if (!componentId) return true;
  const { data } = await auth.supabase
    .from("product_components")
    .select("id")
    .eq("id", componentId)
    .eq("product_id", productId)
    .eq("user_id", auth.userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function printerBelongsToUser(auth: Authorized, printerId: string | null): Promise<boolean> {
  if (!printerId) return true;
  const { data } = await auth.supabase.from("printers").select("id").eq("id", printerId).eq("user_id", auth.userId).maybeSingle();
  return Boolean(data);
}

/** Subidas que nunca se confirmaron (pestaña cerrada, corte de red): se limpian fila + objeto. */
async function cleanupStalePending(auth: Authorized, productId: string) {
  const cutoff = new Date(Date.now() - PENDING_UPLOAD_TTL_MS).toISOString();
  const { data: stale } = await auth.supabase
    .from("product_print_files")
    .select("id, storage_path")
    .eq("user_id", auth.userId)
    .eq("product_id", productId)
    .eq("status", "pending")
    .lt("created_at", cutoff);
  if (!stale || stale.length === 0) return;
  const removed = await removeStorageObjects(createPrintFilesAdminClient(), stale.map((row) => String(row.storage_path)));
  if (!removed) return;
  await auth.supabase
    .from("product_print_files")
    .delete()
    .eq("user_id", auth.userId)
    .in("id", stale.map((row) => row.id));
}

// ------------------------------------------------------------------------------------------------ subir

export interface PrepareUploadInput {
  productId: string;
  fileName: string;
  size: number;
  /** Si se informa, el nuevo archivo reemplaza a este una vez verificado (hereda sus datos). */
  replaceFileId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function prepareProductPrintFileUploadAction(input: PrepareUploadInput) {
  if (!UUID_PATTERN.test(input.productId)) return fail("El producto seleccionado no es válido.");
  const replaceFileId = input.replaceFileId ?? null;
  if (replaceFileId && !UUID_PATTERN.test(replaceFileId)) return fail(INVALID_FILE);

  const maxBytes = resolvePrintFileMaxBytes(process.env.PRINT_FILES_MAX_MB);
  const upload = validatePrintFileUpload({ fileName: input.fileName, size: input.size }, maxBytes);
  if (!upload.ok) return fail(upload.error);

  const auth = await authorize();
  if (!auth.ok) return fail(auth.error);

  const { data: product } = await auth.supabase
    .from("products")
    .select("id")
    .eq("id", input.productId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (!product) return fail("No se encontró el producto o no te pertenece.");

  let metadata: PrintFileMetadata;
  if (replaceFileId) {
    const { data: previous } = await auth.supabase
      .from("product_print_files")
      .select("name, slicer, component_id, printer_id, printer_name, est_minutes, est_grams, material")
      .eq("id", replaceFileId)
      .eq("user_id", auth.userId)
      .eq("product_id", input.productId)
      .eq("status", "ready")
      .maybeSingle();
    if (!previous) return fail(NOT_FOUND);
    const inherited = validatePrintFileMetadata({
      name: previous.name,
      slicer: previous.slicer,
      componentId: previous.component_id,
      printerId: previous.printer_id,
      printerName: previous.printer_name,
      estMinutes: previous.est_minutes,
      estGrams: previous.est_grams,
      material: previous.material,
    });
    if (!inherited.ok) return fail(inherited.error);
    metadata = inherited.value;
  } else {
    const validated = validatePrintFileMetadata(input.metadata, stripThreeMfExtension(upload.fileName));
    if (!validated.ok) return fail(validated.error);
    metadata = validated.value;
    if (!(await componentBelongsToProduct(auth, input.productId, metadata.componentId))) return fail("La pieza seleccionada no pertenece a este producto.");
    if (!(await printerBelongsToUser(auth, metadata.printerId))) return fail("La impresora seleccionada no es válida.");
  }

  await cleanupStalePending(auth, input.productId);

  const { count, error: countError } = await auth.supabase
    .from("product_print_files")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .eq("product_id", input.productId);
  if (countError) return fail(GENERIC_ERROR);
  // Un reemplazo suma un archivo solo de forma transitoria.
  if (!replaceFileId && (count ?? 0) >= MAX_PRINT_FILES_PER_PRODUCT) {
    return fail(`Cada producto admite hasta ${MAX_PRINT_FILES_PER_PRODUCT} archivos de impresión.`);
  }

  const { count: userCount, error: userCountError } = await auth.supabase
    .from("product_print_files")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId);
  if (userCountError) return fail(GENERIC_ERROR);
  if (!replaceFileId && (userCount ?? 0) >= MAX_PRINT_FILES_PER_USER) {
    return fail(`Llegaste al máximo de ${MAX_PRINT_FILES_PER_USER} archivos de impresión. Eliminá alguno para subir otro.`);
  }

  const fileId = randomUUID();
  const storagePath = buildPrintFileStoragePath(auth.userId, input.productId, fileId);

  // user_id sale de la sesión del servidor, nunca del cliente; la RLS y el trigger de la tabla lo vuelven a exigir.
  const { error: insertError } = await auth.supabase.from("product_print_files").insert({
    id: fileId,
    user_id: auth.userId,
    product_id: input.productId,
    file_name: upload.fileName,
    storage_path: storagePath,
    replaces_id: replaceFileId,
    ...metadataColumns(metadata),
  });
  if (insertError) return fail(GENERIC_ERROR);

  const admin = createPrintFilesAdminClient();
  const signed = await createSignedUpload(admin, storagePath);
  if (!signed) {
    await auth.supabase.from("product_print_files").delete().eq("id", fileId).eq("user_id", auth.userId);
    return fail("No se pudo preparar la subida. Probá de nuevo.");
  }

  return { success: true as const, fileId, path: signed.path, token: signed.token, maxBytes };
}

export async function completeProductPrintFileUploadAction(fileId: string) {
  if (!UUID_PATTERN.test(fileId)) return fail(INVALID_FILE);
  const auth = await authorize();
  if (!auth.ok) return fail(auth.error);

  const { data: row } = await auth.supabase
    .from("product_print_files")
    .select("id, product_id, storage_path, status, replaces_id")
    .eq("id", fileId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (!row) return fail(NOT_FOUND);

  const admin = createPrintFilesAdminClient();

  if (row.status !== "ready") {
    const maxBytes = resolvePrintFileMaxBytes(process.env.PRINT_FILES_MAX_MB);
    const discard = async (message: string) => {
      await removeStorageObjects(admin, [String(row.storage_path)]);
      await auth.supabase.from("product_print_files").delete().eq("id", fileId).eq("user_id", auth.userId);
      return fail(message);
    };

    const url = await createSignedDownload(admin, String(row.storage_path), 120);
    if (!url) return discard("No se encontró el archivo subido. Probá de nuevo.");

    let verdict;
    try {
      verdict = await inspectThreeMfContainer(remoteRangeSource(url, maxBytes));
    } catch (error) {
      const message = error instanceof RemoteObjectError ? error.message : "No se pudo verificar el archivo subido.";
      return discard(message);
    }
    if (!verdict.ok) return discard(verdict.message);
    if (verdict.totalSize < PRINT_FILE_MIN_BYTES || verdict.totalSize > maxBytes) {
      return discard(`El archivo supera el límite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
    }

    // status / file_size no son editables por el usuario: se fijan con el cliente del servidor, acotado a esta fila.
    const { error: readyError } = await admin
      .from("product_print_files")
      .update({ status: "ready", file_size: verdict.totalSize })
      .eq("id", fileId)
      .eq("user_id", auth.userId);
    if (readyError) return discard(GENERIC_ERROR);
  }

  let warning: string | undefined;
  if (row.replaces_id) {
    const { data: previous } = await auth.supabase
      .from("product_print_files")
      .select("id, storage_path")
      .eq("id", row.replaces_id)
      .eq("user_id", auth.userId)
      .eq("product_id", row.product_id)
      .maybeSingle();
    if (previous && previous.id !== fileId) {
      const removed = await removeStorageObjects(admin, [String(previous.storage_path)]);
      if (removed) {
        await auth.supabase.from("product_print_files").delete().eq("id", previous.id).eq("user_id", auth.userId);
      } else {
        warning = "El archivo nuevo quedó guardado, pero no se pudo eliminar la versión anterior. Eliminala manualmente.";
      }
    }
    // `replaces_id` se conserva hasta acá para que un reintento de esta acción termine la limpieza si se cortó a la mitad.
    if (!warning) await admin.from("product_print_files").update({ replaces_id: null }).eq("id", fileId).eq("user_id", auth.userId);
  }

  const { data: file, error: readError } = await auth.supabase
    .from("product_print_files")
    .select(PRINT_FILE_COLUMNS)
    .eq("id", fileId)
    .eq("user_id", auth.userId)
    .single();
  if (readError || !file) return fail(GENERIC_ERROR);
  return { success: true as const, file: file as unknown as PrintFile, warning };
}

// ------------------------------------------------------------------------------------- editar / eliminar

export async function updateProductPrintFileAction(fileId: string, rawMetadata: Record<string, unknown>) {
  if (!UUID_PATTERN.test(fileId)) return fail(INVALID_FILE);
  const validated = validatePrintFileMetadata(rawMetadata);
  if (!validated.ok) return fail(validated.error);

  const auth = await authorize();
  if (!auth.ok) return fail(auth.error);

  const { data: current } = await auth.supabase
    .from("product_print_files")
    .select("id, product_id")
    .eq("id", fileId)
    .eq("user_id", auth.userId)
    .eq("status", "ready")
    .maybeSingle();
  if (!current) return fail(NOT_FOUND);

  const metadata = validated.value;
  if (!(await componentBelongsToProduct(auth, String(current.product_id), metadata.componentId))) return fail("La pieza seleccionada no pertenece a este producto.");
  if (!(await printerBelongsToUser(auth, metadata.printerId))) return fail("La impresora seleccionada no es válida.");

  const { data, error } = await auth.supabase
    .from("product_print_files")
    .update(metadataColumns(metadata))
    .eq("id", fileId)
    .eq("user_id", auth.userId)
    .select(PRINT_FILE_COLUMNS)
    .maybeSingle();
  if (error) return fail("No se pudieron guardar los cambios.");
  if (!data) return fail(NOT_FOUND);
  return { success: true as const, file: data as unknown as PrintFile };
}

/** Sirve también para descartar una subida pendiente (cancelada o fallida). */
export async function deleteProductPrintFileAction(fileId: string) {
  if (!UUID_PATTERN.test(fileId)) return fail(INVALID_FILE);
  const auth = await authorize();
  if (!auth.ok) return fail(auth.error);

  const { data: row } = await auth.supabase
    .from("product_print_files")
    .select("id, storage_path")
    .eq("id", fileId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (!row) return fail(NOT_FOUND);

  // Primero el objeto: si el almacenamiento falla no se borra la fila y el archivo no queda huérfano e invisible.
  const removed = await removeStorageObjects(createPrintFilesAdminClient(), [String(row.storage_path)]);
  if (!removed) return fail("No se pudo eliminar el archivo del almacenamiento. Probá de nuevo.");

  const { error } = await auth.supabase.from("product_print_files").delete().eq("id", fileId).eq("user_id", auth.userId);
  if (error) return fail("No se pudo eliminar el proyecto.");
  return { success: true as const, fileId };
}

// ---------------------------------------------------------------------------------------------- acceso

async function resolveOrigin(): Promise<string | null> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const forwarded = requestHeaders.get("x-forwarded-proto");
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : /^(localhost|127\.0\.0\.1)(:|$)/i.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * `download`: URL firmada de 60 s para descargar desde el navegador.
 * `open`: URL temporal (10 min) que el laminador de escritorio puede descargar sin sesión; termina en `.3mf`.
 */
export async function createPrintFileAccessAction(fileId: string, intent: "download" | "open") {
  if (!UUID_PATTERN.test(fileId)) return fail(INVALID_FILE);
  if (intent !== "download" && intent !== "open") return fail(INVALID_FILE);
  const auth = await authorize();
  if (!auth.ok) return fail(auth.error);

  const { data: row } = await auth.supabase
    .from("product_print_files")
    .select("id, file_name, storage_path")
    .eq("id", fileId)
    .eq("user_id", auth.userId)
    .eq("status", "ready")
    .maybeSingle();
  if (!row) return fail(NOT_FOUND);

  if (intent === "download") {
    const url = await createSignedDownload(createPrintFilesAdminClient(), String(row.storage_path), DOWNLOAD_LINK_TTL_SECONDS, String(row.file_name));
    if (!url) return fail("No se pudo generar el enlace de descarga.");
    return { success: true as const, url, fileName: String(row.file_name) };
  }

  const origin = await resolveOrigin();
  if (!origin) return fail("No se pudo determinar la dirección de la aplicación.");
  const ticket = createOpenTicket({ fileId, userId: auth.userId }, getPrintFileLinkKey(), OPEN_LINK_TTL_SECONDS);
  const urlFileName = toUrlFileName(String(row.file_name));
  return {
    success: true as const,
    url: `${origin}/api/print-files/open/${ticket}/${urlFileName}`,
    fileName: String(row.file_name),
  };
}
