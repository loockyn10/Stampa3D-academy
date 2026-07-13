import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Quita espacios raros, pasa a minúscula, reemplaza espacios por guiones y quita caracteres problemáticos.
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName) return "";
  return fileName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes
    .replace(/\s+/g, "-") // reemplaza espacios por guiones
    .replace(/[^a-z0-9.-]/g, ""); // quita caracteres no alfanuméricos salvo puntos y guiones
}

/**
 * Devuelve la referencia de storage: storage://bucket/path
 */
export function buildStorageReference(bucket: string, path: string): string {
  return `storage://${bucket}/${path}`;
}

/**
 * Parsea la referencia y devuelve bucket y path
 */
export function parseStorageReference(value: string): { bucket: string; path: string } | null {
  if (!value || !value.startsWith("storage://")) return null;
  const withoutScheme = value.slice("storage://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex === -1) return null;
  const bucket = withoutScheme.slice(0, slashIndex);
  const path = withoutScheme.slice(slashIndex + 1);
  return { bucket, path };
}

/**
 * Valida si es una URL externa (http o https)
 */
export function isExternalUrl(value: string): boolean {
  return value?.startsWith("http://") || value?.startsWith("https://");
}

/**
 * Devuelve la URL de acceso (firmada, pública o externa)
 */
export async function getFileAccessUrl(supabase: SupabaseClient, value: string, expiresIn = 3600): Promise<string | null> {
  if (!value) return null;

  if (isExternalUrl(value)) {
    return value;
  }

  const parsed = parseStorageReference(value);
  if (!parsed) return null;

  const { bucket, path } = parsed;

  const publicBuckets = ["stl-thumbnails", "company-logos", "product-images"];
  
  if (publicBuckets.includes(bucket)) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  } else {
    // Es bucket privado
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) {
      console.error("Error creating signed URL:", error);
      return null;
    }
    return data.signedUrl;
  }
}
