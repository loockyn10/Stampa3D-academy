"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Boxes } from "lucide-react";
import {
  MAX_SIMULTANEOUS_PREVIEWS,
  createPlaybackSlots,
  shouldAttachPreviewSrc,
  shouldPlayPreview,
} from "@/lib/stl/preview-media";

interface ModelPreviewCardMediaProps {
  /** Identifica la card en el registro de reproducción simultánea. */
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  /** WebM 360° prerenderizado; null/undefined = solo thumbnail. */
  previewUrl?: string | null;
}

/** Compartido por todas las cards de la página: limita cuántos videos corren a la vez. */
const playbackSlots = createPlaybackSlots(MAX_SIMULTANEOUS_PREVIEWS);

/**
 * Media de una card de la Librería STL: thumbnail siempre; preview 360° (video WebM
 * prerenderizado, NO Three.js) solo cuando corresponde:
 *  - desktop (hover real): al pasar el mouse sobre la card;
 *  - touch: cuando la card está suficientemente visible;
 *  - nunca con prefers-reduced-motion, nunca si el video falló.
 * El `src` no se asigna hasta que hace falta (preload="none"), así /libreria-stl no dispara
 * decenas de requests de video al cargar. Cualquier fallo vuelve al thumbnail/placeholder.
 */
export function ModelPreviewCardMedia({ id, title, thumbnailUrl, previewUrl }: ModelPreviewCardMediaProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [canHover, setCanHover] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [hasActivated, setHasActivated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [evicted, setEvicted] = useState(false);

  const hasPreview = Boolean(previewUrl) && !failed;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setCanHover(hoverQuery.matches);
      setReducedMotion(motionQuery.matches);
    };
    sync();
    hoverQuery.addEventListener?.("change", sync);
    motionQuery.addEventListener?.("change", sync);
    return () => {
      hoverQuery.removeEventListener?.("change", sync);
      motionQuery.removeEventListener?.("change", sync);
    };
  }, []);

  // Hover/foco sobre TODA la card (el link que la envuelve), no solo sobre la imagen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !previewUrl) return;
    const target: HTMLElement = root.closest("a") ?? root;
    const on = () => setHovering(true);
    const off = () => setHovering(false);
    target.addEventListener("mouseenter", on);
    target.addEventListener("mouseleave", off);
    target.addEventListener("focusin", on);
    target.addEventListener("focusout", off);
    return () => {
      target.removeEventListener("mouseenter", on);
      target.removeEventListener("mouseleave", off);
      target.removeEventListener("focusin", on);
      target.removeEventListener("focusout", off);
    };
  }, [previewUrl]);

  // Solo observa si hay preview que mostrar: una card sin preview no cuesta nada.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !previewUrl || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.6 });
    observer.observe(root);
    return () => observer.disconnect();
  }, [previewUrl]);

  const state = { previewUrl, failed, reducedMotion, canHover, hovering, inView };
  const shouldPlay = shouldPlayPreview(state);
  const wantsPlay = shouldPlay && !evicted;

  // Ajustes de estado derivado durante el render (patrón de React; evita setState dentro de efectos).
  if (!shouldPlay && evicted) setEvicted(false);
  if (wantsPlay && !hasActivated) setHasActivated(true);

  const attachSrc = shouldAttachPreviewSrc({ ...state, hasActivated }) && !evicted;

  // Reproducción en touch: máximo MAX_SIMULTANEOUS_PREVIEWS; el más antiguo se desaloja.
  useEffect(() => {
    if (!shouldPlayPreview(state)) {
      playbackSlots.release(id);
      return;
    }
    if (canHover) return;
    playbackSlots.acquire(id, () => setEvicted(true));
    return () => playbackSlots.release(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canHover, previewUrl, failed, reducedMotion, hovering, inView]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (wantsPlay) {
      const result = video.play();
      // Autoplay bloqueado o interrumpido: no es un error del asset, se queda el thumbnail.
      if (result && typeof result.catch === "function") result.catch(() => undefined);
    } else {
      video.pause();
    }
  }, [wantsPlay, attachSrc]);

  // Al liberar el src (touch fuera de viewport) se vuelve al thumbnail.
  useEffect(() => {
    if (attachSrc) return;
    const video = videoRef.current;
    if (video && !video.getAttribute("src") && typeof video.load === "function") video.load(); // libera el buffer
  }, [attachSrc]);

  const onVideoError = useCallback(() => {
    setFailed(true);
    setVideoReady(false);
  }, []);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt={title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
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
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
          disablePictureInPicture
          onPlaying={() => setVideoReady(true)}
          onPause={() => setVideoReady(false)}
          onEmptied={() => setVideoReady(false)}
          onError={onVideoError}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            videoReady && wantsPlay ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
