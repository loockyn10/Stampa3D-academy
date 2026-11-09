"use client";

import { useEffect, useRef } from "react";
import { HeroCoreScene } from "./core-scene";
import { HeroLampScene } from "./lamp-scene";
import { resolveHeroQuality } from "./hero-quality";
import type { HeroTimeline } from "./hero-timeline";

/** Superficie mínima que el controlador necesita de la escena 3D (el resto es detalle interno). */
export type HeroSceneApi = {
  baseZ: number;
  endZ: number;
  render: (timeline: HeroTimeline, dt: number) => void;
};

/** Objeto protagonista: el núcleo de capas (por defecto) o la lámpara de diseño (prueba creativa). */
export type HeroModel = "nucleo" | "lampara";

type Props = {
  model?: HeroModel;
  reducedMotion: boolean;
  onReady: (api: HeroSceneApi) => void;
  /** El contexto WebGL se perdió o no se pudo crear la escena: el padre muestra el fallback. */
  onFail: () => void;
  /** Se completó la formación inicial. */
  onFormed?: () => void;
};

/**
 * Monta el canvas WebGL y la escena. Se importa con `next/dynamic` (ssr: false) para que Three.js
 * viaje en su propio chunk y no cargue con el resto de la aplicación.
 */
export default function HeroCoreCanvas({ model = "nucleo", reducedMotion, onReady, onFail, onFormed }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onFail, onFormed });

  useEffect(() => {
    callbacks.current = { onReady, onFail, onFormed };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // El canvas se crea en cada montaje: `dispose()` fuerza la pérdida del contexto, y un canvas reutilizado
    // (p. ej. el segundo montaje de React StrictMode) devolvería ese contexto ya perdido.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.appendChild(canvas);

    let scene: HeroCoreScene | HeroLampScene | null = null;
    try {
      const SceneClass = model === "lampara" ? HeroLampScene : HeroCoreScene;
      scene = new SceneClass(canvas, resolveHeroQuality(host.clientWidth || window.innerWidth), {
        reducedMotion,
        onContextLost: () => callbacks.current.onFail(),
        onFormed: () => callbacks.current.onFormed?.(),
      });
    } catch {
      canvas.remove();
      callbacks.current.onFail();
      return;
    }

    const active = scene;
    const measure = () => active.resize(host.clientWidth, host.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);

    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      active.setPointer(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    };
    if (!reducedMotion) window.addEventListener("pointermove", onPointerMove, { passive: true });

    callbacks.current.onReady({
      get baseZ() {
        return active.baseZ;
      },
      get endZ() {
        return active.endZ;
      },
      render: (timeline, dt) => active.render(timeline, dt),
    });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
      active.dispose();
      canvas.remove();
    };
  }, [model, reducedMotion]);

  return <div ref={hostRef} className="absolute inset-0" />;
}
