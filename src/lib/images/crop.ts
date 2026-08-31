export const SUPPORTED_RASTER_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedRasterImageType = (typeof SUPPORTED_RASTER_IMAGE_TYPES)[number];
export type ImageCropOutputType = SupportedRasterImageType | "preserve";
export type ImageCropShape = "rectangle" | "circle";

export interface ImageCropConfig {
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  quality?: number;
  outputType?: ImageCropOutputType;
  cropShape?: ImageCropShape;
  maxFileSizeMb?: number;
  maxZoom?: number;
  showGrid?: boolean;
  preview?: {
    label?: string;
    title?: string;
  };
}

export interface CropFrameSize {
  width: number;
  height: number;
}

export interface CropImageSize {
  width: number;
  height: number;
}

export interface CropOffset {
  x: number;
  y: number;
}

interface CropGeometryParams {
  image: CropImageSize;
  frame: CropFrameSize;
  zoom: number;
  offset: CropOffset;
}

export interface CropSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface CropPreviewLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EXTENSION_TO_MIME: Record<string, SupportedRasterImageType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const MIME_TO_EXTENSION: Record<SupportedRasterImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function getSupportedRasterImageType(file: Pick<File, "name" | "type">): SupportedRasterImageType | null {
  if (SUPPORTED_RASTER_IMAGE_TYPES.includes(file.type as SupportedRasterImageType)) {
    return file.type as SupportedRasterImageType;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_MIME[extension] ?? null;
}

export function validateRasterImageFile(file: File, maxFileSizeMb: number): string | null {
  if (!getSupportedRasterImageType(file)) {
    return "La imagen debe estar en formato JPG, PNG o WEBP.";
  }

  if (file.size > maxFileSizeMb * 1024 * 1024) {
    return `La imagen es muy pesada. El máximo es ${maxFileSizeMb} MB.`;
  }

  return null;
}

export function getCoverScale(image: CropImageSize, frame: CropFrameSize): number {
  if (image.width <= 0 || image.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return 1;
  }

  return Math.max(frame.width / image.width, frame.height / image.height);
}

export function clampCropOffset({ image, frame, zoom, offset }: CropGeometryParams): CropOffset {
  const scale = getCoverScale(image, frame) * Math.max(1, zoom);
  const maxX = Math.max(0, (image.width * scale - frame.width) / 2);
  const maxY = Math.max(0, (image.height * scale - frame.height) / 2);
  const clampAxis = (value: number, maximum: number) => maximum === 0
    ? 0
    : Math.min(maximum, Math.max(-maximum, value));

  return {
    x: clampAxis(offset.x, maxX),
    y: clampAxis(offset.y, maxY),
  };
}

export function getCropSourceRect({ image, frame, zoom, offset }: CropGeometryParams): CropSourceRect {
  const scale = getCoverScale(image, frame) * Math.max(1, zoom);
  const clampedOffset = clampCropOffset({ image, frame, zoom, offset });
  const displayedWidth = image.width * scale;
  const displayedHeight = image.height * scale;
  const displayedLeft = (frame.width - displayedWidth) / 2 + clampedOffset.x;
  const displayedTop = (frame.height - displayedHeight) / 2 + clampedOffset.y;

  return {
    x: Math.max(0, -displayedLeft / scale),
    y: Math.max(0, -displayedTop / scale),
    width: Math.min(image.width, frame.width / scale),
    height: Math.min(image.height, frame.height / scale),
    scale,
  };
}

export function getCropPreviewLayout({
  image,
  source,
  preview,
}: {
  image: CropImageSize;
  source: CropSourceRect;
  preview: CropFrameSize;
}): CropPreviewLayout {
  if (source.width <= 0 || source.height <= 0 || preview.width <= 0 || preview.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scale = Math.max(preview.width / source.width, preview.height / source.height);
  return {
    left: -source.x * scale,
    top: -source.y * scale,
    width: image.width * scale,
    height: image.height * scale,
  };
}

function resolveOutputType(file: File, config: ImageCropConfig): SupportedRasterImageType {
  if (config.cropShape === "circle") return "image/png";
  if (config.outputType && config.outputType !== "preserve") return config.outputType;
  return getSupportedRasterImageType(file) ?? "image/jpeg";
}

function buildOutputName(originalName: string, outputType: SupportedRasterImageType): string {
  const extension = MIME_TO_EXTENSION[outputType];
  const baseName = originalName.replace(/\.[^.]+$/, "") || "imagen";
  return `${baseName}-recortada.${extension}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: SupportedRasterImageType, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("No se pudo generar la imagen procesada."));
      },
      type,
      quality,
    );
  });
}

export async function createCroppedImageFile({
  file,
  imageElement,
  frame,
  zoom,
  offset,
  config,
}: {
  file: File;
  imageElement: HTMLImageElement;
  frame: CropFrameSize;
  zoom: number;
  offset: CropOffset;
  config: ImageCropConfig;
}): Promise<File> {
  const outputRatio = config.outputWidth / config.outputHeight;
  if (Math.abs(outputRatio - config.aspectRatio) > 0.01) {
    throw new Error("La configuración del recorte no coincide con las dimensiones de salida.");
  }

  const source = getCropSourceRect({
    image: { width: imageElement.naturalWidth, height: imageElement.naturalHeight },
    frame,
    zoom,
    offset,
  });

  const canvas = document.createElement("canvas");
  canvas.width = config.outputWidth;
  canvas.height = config.outputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Tu navegador no pudo preparar el editor de imagen.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (config.cropShape === "circle") {
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2, 0, Math.PI * 2);
    context.clip();
  }

  context.drawImage(
    imageElement,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const outputType = resolveOutputType(file, config);
  const blob = await canvasToBlob(canvas, outputType, config.quality ?? 0.9);
  return new File([blob], buildOutputName(file.name, outputType), {
    type: outputType,
    lastModified: Date.now(),
  });
}
