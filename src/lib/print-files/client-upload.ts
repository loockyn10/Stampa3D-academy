import type { SupabaseClient } from "@supabase/supabase-js";
import {
  completeProductPrintFileUploadAction,
  deleteProductPrintFileAction,
  prepareProductPrintFileUploadAction,
} from "@/app/productos/print-file-actions";
import { PRINT_FILES_BUCKET, PRINT_FILE_ABSOLUTE_MAX_BYTES } from "./config";
import { blobRangeSource, inspectThreeMfContainer } from "./three-mf-container";
import type { PrintFile } from "./types";
import { validatePrintFileUpload } from "./validation";

export type UploadPrintFileResult =
  | { success: true; file: PrintFile; warning?: string }
  | { success: false; error: string };

export interface UploadPrintFileInput {
  supabase: SupabaseClient;
  file: File;
  productId: string;
  /** Datos del proyecto (ignorados al reemplazar: el reemplazo hereda los del archivo anterior). */
  metadata?: Record<string, unknown>;
  replaceFileId?: string | null;
}

/**
 * Subida en cuatro pasos. El navegador sube DIRECTO al bucket privado con una URL de subida firmada por el servidor
 * (que fija la ruta: el cliente no elige dónde escribe) y el servidor verifica el objeto antes de publicarlo.
 *   1. verificación local rápida (extensión, tamaño, contenedor 3MF) solo para dar feedback inmediato;
 *   2. el servidor valida permisos/propiedad, registra la fila `pending` y firma la subida;
 *   3. subida del archivo;
 *   4. el servidor inspecciona el objeto subido y recién entonces lo marca `ready` (o lo descarta).
 */
export async function uploadPrintFile({ supabase, file, productId, metadata, replaceFileId }: UploadPrintFileInput): Promise<UploadPrintFileResult> {
  const local = validatePrintFileUpload({ fileName: file.name, size: file.size }, PRINT_FILE_ABSOLUTE_MAX_BYTES);
  if (!local.ok) return { success: false, error: local.error };

  const container = await inspectThreeMfContainer(blobRangeSource(file));
  if (!container.ok) return { success: false, error: container.message };

  const prepared = await prepareProductPrintFileUploadAction({
    productId,
    fileName: file.name,
    size: file.size,
    replaceFileId: replaceFileId ?? null,
    metadata: metadata ?? null,
  });
  if (!prepared.success) return { success: false, error: prepared.error };

  const { error: uploadError } = await supabase.storage
    .from(PRINT_FILES_BUCKET)
    .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: "model/3mf" });
  if (uploadError) {
    await deleteProductPrintFileAction(prepared.fileId);
    return { success: false, error: "No se pudo subir el archivo. Revisá tu conexión y probá de nuevo." };
  }

  const completed = await completeProductPrintFileUploadAction(prepared.fileId);
  if (!completed.success) return { success: false, error: completed.error };
  return { success: true, file: completed.file, warning: completed.warning };
}
