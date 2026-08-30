import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isExternalUrl,
  parseStorageReference,
} from "@/lib/storage";

export const RAFFLE_IMAGES_BUCKET = "product-images";

export function resolveRaffleImageUrl(
  supabase: SupabaseClient,
  value: string | null | undefined,
): string | null {
  const imageReference = value?.trim();
  if (!imageReference) return null;

  if (isExternalUrl(imageReference)) return imageReference;

  const storageReference = parseStorageReference(imageReference);
  if (storageReference && storageReference.bucket !== RAFFLE_IMAGES_BUCKET) {
    return null;
  }

  let objectPath = storageReference?.path ?? imageReference;
  objectPath = objectPath.replace(/^\/+/, "");
  if (objectPath.startsWith(`${RAFFLE_IMAGES_BUCKET}/`)) {
    objectPath = objectPath.slice(RAFFLE_IMAGES_BUCKET.length + 1);
  }
  if (!objectPath) return null;

  const { data } = supabase.storage
    .from(RAFFLE_IMAGES_BUCKET)
    .getPublicUrl(objectPath);

  return data.publicUrl;
}
