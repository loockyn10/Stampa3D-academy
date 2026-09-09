"use client";

import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import {
  normalizePrinterCatalogImagePath,
  PRINTER_CATALOG_IMAGES_BUCKET,
} from "@/lib/printers/catalog-image";

export function PrinterCatalogImage({
  imagePath,
  alt,
  className = "",
}: {
  imagePath?: string | null;
  alt: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const normalizedPath = normalizePrinterCatalogImagePath(imagePath);
  const supabase = useMemo(() => createClient(), []);
  const imageUrl = useMemo(() => {
    if (!normalizedPath) return null;
    return supabase.storage
      .from(PRINTER_CATALOG_IMAGES_BUCKET)
      .getPublicUrl(normalizedPath).data.publicUrl;
  }, [normalizedPath, supabase]);

  return (
    <div className={`relative flex overflow-hidden bg-gradient-to-br from-white/[0.06] to-transparent ${className}`}>
      {imageUrl && failedUrl !== imageUrl ? (
        // Images are cropped to 800x600 before upload and loaded lazily from the public catalog bucket.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(imageUrl)}
          className="h-full w-full object-contain p-2"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500"
          role="img"
          aria-label={`${alt}, sin imagen de catálogo`}
        >
          <Printer className="h-8 w-8 text-stampa-orange/70" aria-hidden="true" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Sin imagen</span>
        </div>
      )}
    </div>
  );
}
