"use client";

import { useEffect, useRef } from "react";

type Props = {
  src: string;
  poster: string;
  width: number;
  height: number;
  alt: string;
  /** `false` (movimiento reducido): no se reproduce y queda el póster. */
  animate: boolean;
  /** La demostración se describe en texto al lado: el video queda fuera del árbol de accesibilidad. */
  decorative: boolean;
};

/**
 * Video de demostración: sin sonido, en bucle, sin controles. Solo se reproduce mientras está a la vista
 * (IntersectionObserver), así no consume CPU/batería fuera de pantalla, y respeta `prefers-reduced-motion`.
 * Mientras carga (y siempre con movimiento reducido) se ve el póster.
 */
export function DemoVideo({ src, poster, width, height, alt, animate, decorative }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // `muted` como propiedad: React no siempre lo refleja como atributo y iOS exige silencio para reproducir solo.
    video.muted = true;
    if (!animate) {
      video.pause();
      return;
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void video.play().catch(() => undefined);
          else video.pause();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [animate, src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      width={width}
      height={height}
      muted
      loop
      playsInline
      disablePictureInPicture
      preload={animate ? "auto" : "none"}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative ? true : undefined}
    />
  );
}
