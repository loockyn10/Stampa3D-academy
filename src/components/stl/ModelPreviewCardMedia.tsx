"use client";

import React, { useEffect, useRef, useState } from "react";
import { Boxes } from "lucide-react";
import { getPreviewCycle } from "@/lib/stl/preview-cycle";
import { AMBIENT_TIMING, isGeneratedThumbnailUrl } from "@/lib/stl/preview-media";

interface ModelPreviewCardMediaProps {
  /** Identifica la card en el coordinador del ciclo ambiental. */
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  /** WebM 360° prerenderizado; null/undefined = solo thumbnail. */
  previewUrl?: string | null;
}

/**
 * Media de una card de la Librería STL: thumbnail como estado base; preview 360° (video WebM
 * prerenderizado, NO Three.js) solo cuando el coordinador (`preview-cycle.ts`) la activa:
 *  - ciclo ambiental: una sola card visible reproduce una vuelta y luego pasa a la siguiente;
 *  - hover/focus de la card: prioridad absoluta;
 *  - nunca con prefers-reduced-motion, nunca si el video falló.
 * El `src` no se asigna hasta que la card se activa (preload="none"). Sin `loop`: el fin de la
 * vuelta (`ended`) le avisa al coordinador. Cualquier fallo vuelve al thumbnail/placeholder.
 * Thumbnail, video y placeholder llenan el MISMO marco (el padre fija la proporción 4:3), así que
 * activar/desactivar el preview nunca cambia el tamaño de la card. Los assets generados son cuadrados
 * con el mismo fondo que la card y el modelo ya encuadrado: se muestran enteros (`contain`) para no
 * recortar los extremos en 4:3; las portadas cargadas a mano usan `cover`.
 */
export function ModelPreviewCardMedia({ id, title, thumbnailUrl, previewUrl }: ModelPreviewCardMediaProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [reducedMotion, setReducedMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const [active, setActive] = useState(false);
  const [token, setToken] = useState(0);
  const [hasActivated, setHasActivated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  const generatedThumbnail = isGeneratedThumbnailUrl(thumbnailUrl, id);
  const hasPreview = Boolean(previewUrl) && !failed;
  const eligible = hasPreview && !reducedMotion;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(motionQuery.matches);
    sync();
    motionQuery.addEventListener?.("change", sync);
    return () => motionQuery.removeEventListener?.("change", sync);
  }, []);

  // Solo las cards con preview se registran: una card sin preview nunca entra al ciclo ni cuesta nada.
  useEffect(() => {
    if (!previewUrl) return;
    return getPreviewCycle().register(id, (snapshot) => {
      setActive(snapshot.active);
      setToken(snapshot.token);
    });
  }, [id, previewUrl]);

  useEffect(() => {
    if (!previewUrl) return;
    getPreviewCycle().update(id, { eligible: eligible && !failed, inView });
  }, [id, previewUrl, eligible, failed, inView]);

  // Visibilidad: la card solo participa del ciclo mientras esté suficientemente visible.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !previewUrl || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: AMBIENT_TIMING.visibleThreshold,
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [previewUrl]);

  // Hover (solo con puntero real) y foco de teclado sobre TODA la card (el link que la envuelve).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !previewUrl) return;
    const target: HTMLElement = root.closest("a") ?? root;
    const cycle = getPreviewCycle();
    const canHover = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const start = () => cycle.interactStart(id);
    const end = () => cycle.interactEnd(id);
    if (canHover) {
      target.addEventListener("mouseenter", start);
      target.addEventListener("mouseleave", end);
    }
    target.addEventListener("focusin", start);
    target.addEventListener("focusout", end);
    return () => {
      target.removeEventListener("mouseenter", start);
      target.removeEventListener("mouseleave", end);
      target.removeEventListener("focusin", start);
      target.removeEventListener("focusout", end);
    };
  }, [id, previewUrl]);

  // Ajuste de estado derivado durante el render (evita setState dentro de efectos).
  if (active && !hasActivated) setHasActivated(true);

  // El src se conserva (pausado) mientras la card siga visible; se libera al salir del viewport.
  const attachSrc = eligible && hasActivated && (active || inView);
  const playing = active && eligible;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      try {
        video.currentTime = 0;
      } catch {
        /* sin metadata todavía: arranca desde el inicio igual */
      }
      const result = video.play();
      // Autoplay bloqueado o interrumpido: no es un error del asset, se queda el thumbnail.
      if (result && typeof result.catch === "function") result.catch(() => undefined);
    } else {
      video.pause();
    }
  }, [playing, token, attachSrc]);

  // Al liberar el src se descarta el buffer y se vuelve al thumbnail.
  useEffect(() => {
    if (attachSrc) return;
    const video = videoRef.current;
    if (video && !video.getAttribute("src") && typeof video.load === "function") video.load();
  }, [attachSrc]);

  const onVideoError = () => {
    // Liberar el src (load() sin fuente) no es un fallo del asset.
    if (!videoRef.current?.getAttribute("src")) return;
    setFailed(true);
    setVideoReady(false);
    if (previewUrl) getPreviewCycle().failed(id);
  };

  const onVideoEnded = () => {
    setVideoReady(false);
    getPreviewCycle().ended(id);
  };

  return (
    <div ref={rootRef} className="absolute inset-0">
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt={title}
          loading="lazy"
          className={`h-full w-full transition-transform duration-500 group-hover:scale-105 ${
            generatedThumbnail ? "object-contain" : "object-cover"
          }`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Boxes size={48} className="text-gray-600" />
        </div>
      )}

      {hasPreview && (
        <video
          ref={videoRef}
          src={attachSrc ? (previewUrl as string) : undefined}
          muted
          playsInline
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
          disablePictureInPicture
          onPlaying={() => setVideoReady(true)}
          onPause={() => setVideoReady(false)}
          onEmptied={() => setVideoReady(false)}
          onEnded={onVideoEnded}
          onError={onVideoError}
          className={`pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
            videoReady && playing ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {hasPreview && (
        <span
          data-testid="preview-360-badge"
          className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full border border-stampa-border bg-stampa-bg-soft/80 px-2 py-0.5 text-[10px] font-bold tracking-wide text-stampa-orange backdrop-blur-sm"
        >
          360°
        </span>
      )}
    </div>
  );
}
