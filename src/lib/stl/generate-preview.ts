import type { Model3DFormat } from "@/lib/stl/library";
import {
  addStandardLights,
  applyNeutralMaterial,
  boundingRadius,
  createZUpPivot,
  disposeModelGeometry,
  fitDistance,
  measureAndCenter,
  toObject3D,
} from "@/lib/stl/model-display";
import { parseModel3D } from "@/lib/stl/parse-model";
import { PREVIEW_SPEC, THUMBNAIL_SPEC } from "@/lib/stl/preview-media";
import { PreviewUnsupportedError, recordTurntable } from "@/lib/stl/record-turntable";

export interface GeneratedPreview {
  blob: Blob;
  mimeType: string;
  bytes: number;
  frames: number;
}

export interface GeneratedThumbnail {
  blob: Blob;
  mimeType: string;
  bytes: number;
}

export interface GeneratedAssets {
  thumbnail: GeneratedThumbnail | null;
  thumbnailError: string | null;
  preview: GeneratedPreview | null;
  previewError: string | null;
}

export interface GenerateAssetsOptions {
  /** Capturar la miniatura WebP (vista 3/4). */
  thumbnail: boolean;
  /** Grabar el WebM 360°. */
  preview: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "error-desconocido";
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0) reject(new Error("No se pudo capturar la miniatura."));
        else if (blob.type !== mimeType) reject(new Error("El navegador no exporta WebP."));
        else resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Genera el preview 360° (WebM) de un STL/3MF ya descargado, 100% en el navegador.
 * Renderer offscreen propio (un único WebGLRenderer temporal, liberado al terminar): las cards
 * nunca montan Three.js. Requiere Chromium (captureStream + MediaRecorder + WebM).
 * Reutiliza parse-model.ts y los helpers de model-display.ts del viewer.
 * Parsea y arma la escena UNA vez; con ella captura la miniatura (vista 3/4) y luego graba la vuelta.
 * Los dos assets fallan de forma independiente: el error de uno no invalida al otro.
 */
export async function generateModelAssets(
  format: Model3DFormat,
  buffer: ArrayBuffer,
  options: GenerateAssetsOptions = { thumbnail: true, preview: true },
): Promise<GeneratedAssets> {
  if (typeof document === "undefined") throw new PreviewUnsupportedError("La generación solo corre en el navegador.");

  const THREE = await import("three");
  const [{ STLLoader }, threeMf] = await Promise.all([
    import("three/examples/jsm/loaders/STLLoader.js"),
    format === "3mf" ? import("three/examples/jsm/loaders/3MFLoader.js") : Promise.resolve(null),
  ]);

  const parsed = parseModel3D(format, buffer, {
    stl: () => new STLLoader(),
    "3mf": () => {
      if (!threeMf) throw new Error("3MF loader no cargado");
      return new threeMf.ThreeMFLoader();
    },
  });
  const model = toObject3D(THREE, parsed);
  const material = applyNeutralMaterial(THREE, model);
  const measured = measureAndCenter(THREE, model);
  if (!measured) {
    disposeModelGeometry(model);
    material.dispose();
    throw new Error("El modelo no tiene volumen.");
  }

  const { size: side, elevation, background } = PREVIEW_SPEC;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;

  let renderer: InstanceType<typeof THREE.WebGLRenderer> | null = null;
  try {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    } catch {
      throw new PreviewUnsupportedError("WebGL no está disponible.");
    }
    renderer.setPixelRatio(1);
    renderer.setSize(side, side, false);
    renderer.setClearColor(background, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    const pivot = createZUpPivot(THREE, model);
    scene.add(pivot);
    addStandardLights(THREE, scene, camera);

    // Encuadre consistente: la esfera que contiene al modelo siempre entra en cuadro, sea cual sea el giro.
    const radius = boundingRadius(measured.size);
    const distance = fitDistance(radius, camera.fov, 1.15);
    camera.near = distance / 100;
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance);
    camera.lookAt(0, 0, 0);

    const activeRenderer = renderer;
    const result: GeneratedAssets = { thumbnail: null, thumbnailError: null, preview: null, previewError: null };

    if (options.thumbnail) {
      try {
        pivot.rotation.z = THUMBNAIL_SPEC.yaw;
        activeRenderer.render(scene, camera);
        const blob = await canvasToBlob(canvas, THUMBNAIL_SPEC.mimeType, THUMBNAIL_SPEC.quality);
        result.thumbnail = { blob, mimeType: blob.type, bytes: blob.size };
      } catch (err) {
        result.thumbnailError = errorMessage(err);
      }
    }

    if (options.preview) {
      try {
        const recorded = await recordTurntable({
          canvas,
          MediaRecorderCtor: typeof MediaRecorder === "undefined" ? null : (MediaRecorder as never),
          now: () => performance.now(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          renderFrame: (angle) => {
            pivot.rotation.z = angle; // gira sobre el eje vertical del modelo (Z-up del archivo).
            activeRenderer.render(scene, camera);
          },
        });
        const blob = new Blob(recorded.chunks as BlobPart[], { type: "video/webm" });
        if (blob.size === 0) throw new Error("El preview generado está vacío.");
        result.preview = { blob, mimeType: recorded.mimeType, bytes: blob.size, frames: recorded.frames };
      } catch (err) {
        result.previewError = errorMessage(err);
      }
    }
    return result;
  } finally {
    disposeModelGeometry(model);
    material.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
