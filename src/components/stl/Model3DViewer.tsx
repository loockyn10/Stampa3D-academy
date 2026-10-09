"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Mesh, Object3D } from "three";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { STL_VIEWER_MAX_BYTES, type Model3DFormat, type StlDimensions } from "@/lib/stl/library";
import {
  describeModel3DLoadError,
  Model3DLoadError,
  parseModel3D,
  type ParsedGeometry,
  type ParsedObject,
} from "@/lib/stl/parse-model";

type ViewerError = { title: string; detail: string };

interface Model3DViewerProps {
  /** Variante a previsualizar; la URL firmada se pide a /api/stl/preview (misma autorización que la descarga; el servidor decide el formato). */
  variantId: string;
  onDimensions?: (dimensions: StlDimensions | null) => void;
}

const MAX_MB = Math.round(STL_VIEWER_MAX_BYTES / (1024 * 1024));

async function readWithLimit(
  response: Response,
  signal: AbortSignal,
  onProgress: (ratio: number | null) => void,
): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > STL_VIEWER_MAX_BYTES) throw new Error("too-heavy");
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > STL_VIEWER_MAX_BYTES) throw new Error("too-heavy");
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received > STL_VIEWER_MAX_BYTES) {
      reader.cancel().catch(() => undefined);
      throw new Error("too-heavy");
    }
    onProgress(declared > 0 ? received / declared : null);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export function Model3DViewer({ variantId, onDimensions }: Model3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const onDimensionsRef = useRef(onDimensions);
  useEffect(() => {
    onDimensionsRef.current = onDimensions;
  }, [onDimensions]);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<ViewerError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abort = new AbortController();
    let disposed = false;
    let cleanup: (() => void) | null = null;

    const fail = (title: string, detail: string) => {
      if (disposed) return;
      setError({ title, detail });
      setStatus("error");
      onDimensionsRef.current?.(null);
    };

    setStatus("loading");
    setProgress(null);
    setError(null);

    (async () => {
      // 1. URL firmada (valida sesión, membresía y publicación en el servidor).
      let signedUrl: string;
      let format: Model3DFormat;
      try {
        const res = await fetch("/api/stl/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantId }),
          signal: abort.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          if (res.status === 422) return fail("Formato no soportado", data.error || "Este archivo no tiene vista previa 3D.");
          if (res.status === 401 || res.status === 403) return fail("Sin acceso", "Tu cuenta no tiene acceso a este archivo.");
          if (res.status === 404) return fail("Archivo no encontrado", "El archivo ya no está disponible.");
          return fail("No se pudo cargar", "Probá de nuevo en unos segundos.");
        }
        if (data.format !== "stl" && data.format !== "3mf") return fail("Formato no soportado", "La vista previa 3D solo admite archivos STL y 3MF.");
        signedUrl = data.url as string;
        format = data.format;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        return fail("No se pudo cargar", "Revisá tu conexión e intentá otra vez.");
      }

      // 2. Descarga del archivo 3D (solo ahora, al abrir el detalle).
      let buffer: ArrayBuffer;
      try {
        const fileRes = await fetch(signedUrl, { signal: abort.signal });
        if (!fileRes.ok) {
          return fail(
            fileRes.status === 404 ? "Archivo no encontrado" : "No se pudo descargar el archivo",
            "Podés intentar de nuevo o usar el botón Descargar.",
          );
        }
        buffer = await readWithLimit(fileRes, abort.signal, (ratio) => {
          if (!disposed) setProgress(ratio);
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if ((err as Error)?.message === "too-heavy") {
          return fail("Modelo muy pesado", `La vista previa admite hasta ${MAX_MB} MB. Descargalo para verlo en tu slicer.`);
        }
        return fail("No se pudo descargar el archivo", "Revisá tu conexión e intentá otra vez.");
      }
      if (disposed) return;

      // 3. Escena Three.js (se carga bajo demanda para no inflar el bundle de la Librería).
      try {
        const THREE = await import("three");
        const [{ STLLoader }, { ThreeMFLoader }, { OrbitControls }] = await Promise.all([
          import("three/examples/jsm/loaders/STLLoader.js"),
          format === "3mf"
            ? import("three/examples/jsm/loaders/3MFLoader.js")
            : Promise.resolve({ ThreeMFLoader: null }),
          import("three/examples/jsm/controls/OrbitControls.js"),
        ]);
        if (disposed) return;

        // STL -> una geometría; 3MF -> Group con una o más mallas (cada formato con su loader).
        let model: Object3D;
        try {
          const parsed = parseModel3D(format, buffer, {
            stl: () => new STLLoader(),
            "3mf": () => {
              if (!ThreeMFLoader) throw new Error("3MF loader no cargado");
              return new ThreeMFLoader();
            },
          });
          if (parsed.format === "stl") {
            model = new THREE.Mesh(parsed.geometry as ParsedGeometry as never, new THREE.MeshBasicMaterial());
          } else {
            model = parsed.group as ParsedObject as unknown as Object3D;
          }
        } catch (err) {
          if (err instanceof Model3DLoadError) {
            const copy = describeModel3DLoadError(err);
            return fail(copy.title, copy.detail);
          }
          throw err;
        }

        // Material neutro único para todas las mallas (3MF trae materiales propios que se descartan).
        const material = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.55, metalness: 0.05 });
        const disposeModel = () => {
          model.traverse((object) => {
            (object as Mesh).geometry?.dispose();
          });
        };
        model.traverse((object) => {
          const mesh = object as Mesh;
          if (!mesh.isMesh) return;
          const previous = mesh.material;
          mesh.material = material;
          (Array.isArray(previous) ? previous : [previous]).forEach((item) => item?.dispose?.());
        });

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        if (box.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite) || size.lengthSq() === 0) {
          disposeModel();
          material.dispose();
          const copy = describeModel3DLoadError(new Model3DLoadError("empty", format, "Sin volumen"));
          return fail(copy.title, copy.detail);
        }
        onDimensionsRef.current?.({ x: size.x, y: size.y, z: size.z });
        model.position.sub(box.getCenter(new THREE.Vector3()));
        model.updateMatrixWorld(true);

        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        } catch {
          disposeModel();
          material.dispose();
          return fail("Visor no compatible", "Tu navegador no soporta WebGL. Podés descargar el archivo igual.");
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
        const pivot = new THREE.Group();
        pivot.rotation.x = -Math.PI / 2; // STL y 3MF son Z-up; la escena es Y-up.
        pivot.add(model);
        scene.add(pivot);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
        camera.add(keyLight);
        scene.add(camera);

        const radius = Math.max(size.length() / 2, 1e-6);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableDamping = false;
        controls.minDistance = radius * 0.6;
        controls.maxDistance = radius * 8;

        const render = () => renderer.render(scene, camera);
        const resetView = () => {
          const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
          camera.position.set(distance * 0.7, distance * 0.55, distance * 0.7);
          camera.near = distance / 100;
          camera.far = distance * 20;
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
          render();
        };
        resetRef.current = resetView;

        const resize = () => {
          const { clientWidth, clientHeight } = container;
          if (!clientWidth || !clientHeight) return;
          renderer.setSize(clientWidth, clientHeight, false);
          camera.aspect = clientWidth / clientHeight;
          camera.updateProjectionMatrix();
          render();
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
        controls.addEventListener("change", render);

        const onContextLost = (event: Event) => {
          event.preventDefault();
          fail("Visor interrumpido", "El navegador liberó la memoria gráfica. Recargá la vista previa.");
        };
        renderer.domElement.addEventListener("webglcontextlost", onContextLost);

        resize();
        resetView();
        setStatus("ready");

        cleanup = () => {
          resetRef.current = null;
          resizeObserver.disconnect();
          renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
          controls.removeEventListener("change", render);
          controls.dispose();
          disposeModel();
          material.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        };
      } catch (err) {
        console.error("[Model3DViewer]", err);
        fail("Visor no disponible", "No pude iniciar la vista previa 3D. Podés descargar el archivo igual.");
      }
    })();

    return () => {
      disposed = true;
      abort.abort();
      cleanup?.();
    };
  }, [variantId, attempt]);

  return (
    <div className="relative aspect-[4/3] max-h-[70vh] w-full overflow-hidden rounded-2xl border border-stampa-border bg-stampa-bg-soft sm:aspect-video">
      <div ref={containerRef} className="absolute inset-0 touch-none" aria-label="Vista previa 3D del modelo" role="img" />

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stampa-text-muted">
          <Loader2 className="h-7 w-7 animate-spin text-stampa-orange" />
          <span className="text-xs font-medium">
            {progress !== null ? `Cargando modelo… ${Math.round(progress * 100)}%` : "Cargando modelo…"}
          </span>
        </div>
      )}

      {status === "error" && error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <AlertCircle className="h-7 w-7 text-stampa-text-muted" />
          <p className="text-sm font-bold text-stampa-text">{error.title}</p>
          <p className="max-w-xs text-xs text-stampa-text-muted">{error.detail}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-1 rounded-lg border border-stampa-border bg-stampa-surface px-3 py-1.5 text-xs font-bold text-stampa-text hover:border-stampa-orange/50"
          >
            Reintentar
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          <button
            type="button"
            onClick={() => resetRef.current?.()}
            className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-stampa-border bg-stampa-surface/90 px-2.5 py-1.5 text-[11px] font-bold text-stampa-text-soft backdrop-blur hover:text-stampa-text"
          >
            <RotateCcw size={13} /> Restablecer
          </button>
          <p className="pointer-events-none absolute bottom-2 left-3 right-3 truncate text-[10px] text-stampa-text-muted">
            Arrastrá para rotar · rueda o pellizco para zoom
          </p>
        </>
      )}
    </div>
  );
}
