import type { ImageCropConfig } from "@/lib/images/crop";

export const COURSE_COVER_ASPECT_RATIO = 16 / 9;
export const COURSE_COVER_OUTPUT_WIDTH = 1280;
export const COURSE_COVER_OUTPUT_HEIGHT = 720;
export const PRINTER_CATALOG_ASPECT_RATIO = 4 / 3;
export const PRINTER_CATALOG_OUTPUT_WIDTH = 800;
export const PRINTER_CATALOG_OUTPUT_HEIGHT = 600;

export function getCourseCoverImageEditorConfig(title: string): ImageCropConfig {
  return {
    aspectRatio: COURSE_COVER_ASPECT_RATIO,
    outputWidth: COURSE_COVER_OUTPUT_WIDTH,
    outputHeight: COURSE_COVER_OUTPUT_HEIGHT,
    quality: 0.9,
    outputType: "preserve",
    maxFileSizeMb: 5,
    showGrid: true,
    preview: {
      label: "Vista previa",
      title,
    },
  };
}

export function getPrinterCatalogImageEditorConfig(title: string): ImageCropConfig {
  return {
    aspectRatio: PRINTER_CATALOG_ASPECT_RATIO,
    outputWidth: PRINTER_CATALOG_OUTPUT_WIDTH,
    outputHeight: PRINTER_CATALOG_OUTPUT_HEIGHT,
    quality: 0.9,
    outputType: "preserve",
    maxFileSizeMb: 5,
    showGrid: true,
    preview: {
      label: "Vista previa en la tarjeta",
      title,
    },
  };
}
