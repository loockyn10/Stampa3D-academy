"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { HeroSceneApi } from "./HeroCoreCanvas";
import { clamp01, computeTimeline, type HeroTimeline } from "./hero-timeline";

type Options = {
  trackRef: RefObject<HTMLElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  sceneRef: RefObject<HeroSceneApi | null>;
  reducedMotion: boolean;
  /** Se incrementa cuando la escena 3D queda lista/falla para forzar un frame. */
  sceneVersion: number;
};

const FALLBACK_RIG = { baseZ: 14.5, endZ: -4.6 };

/**
 * Un único bucle de animación para toda la experiencia:
 * lee el scroll → suaviza el progreso → calcula la línea de tiempo → dibuja la escena 3D y publica
 * las variables CSS que gobiernan texto, subtítulos, destello y escena final.
 * Se detiene cuando el hero sale de pantalla y no corre con `prefers-reduced-motion`.
 */
export function useHeroController({ trackRef, stageRef, sceneRef, reducedMotion, sceneVersion }: Options): void {
  const progressRef = useRef(0);

  useEffect(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage) return;

    const written = new Map<string, string>();
    const setVar = (name: string, value: number, digits = 3) => {
      const text = value.toFixed(digits);
      if (written.get(name) === text) return;
      written.set(name, text);
      stage.style.setProperty(name, text);
    };
    const setFlag = (name: string, on: boolean) => {
      const text = on ? "true" : "false";
      if (stage.dataset[name] !== text) stage.dataset[name] = text;
    };

    const publish = (tl: HeroTimeline, progress: number) => {
      setVar("--p", progress, 4);
      setVar("--ex", tl.explode);
      setVar("--hero", tl.hero);
      setVar("--cap1", tl.caption1);
      setVar("--cap2", tl.caption2);
      setVar("--flash", tl.flash);
      setVar("--canvas", tl.canvas);
      setVar("--disc", tl.discovery);
      setVar("--dock", tl.dock);
      setFlag("heroActive", tl.hero > 0.02);
      setFlag("discActive", tl.discovery > 0.02);
    };

    if (reducedMotion) {
      // Sin secuencia ligada al scroll: un único fotograma estático del núcleo ya formado.
      const tl = computeTimeline(0, sceneRef.current ?? FALLBACK_RIG);
      publish({ ...tl, hero: 1, discovery: 1, dock: 0 }, 0);
      sceneRef.current?.render(tl, 0);
      return;
    }

    const readTarget = (): number => {
      const total = track.offsetHeight - stage.clientHeight;
      if (total <= 0) return 0;
      return clamp01(-track.getBoundingClientRect().top / total);
    };

    let current = readTarget();
    progressRef.current = current;
    let last = performance.now();
    let frame = 0;
    let running = false;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const target = readTarget();
      // Amortiguación exponencial: la secuencia sigue al scroll sin saltos.
      current += (target - current) * (1 - Math.exp(-dt * 7));
      if (Math.abs(target - current) < 0.0002) current = target;
      progressRef.current = current;

      const scene = sceneRef.current;
      const tl = computeTimeline(current, scene ?? FALLBACK_RIG);
      publish(tl, current);
      scene?.render(tl, dt);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
        else stop();
      },
      { rootMargin: "100px 0px" },
    );
    observer.observe(track);

    return () => {
      observer.disconnect();
      stop();
    };
    // sceneVersion: re-sincroniza el bucle cuando la escena 3D aparece o desaparece.
  }, [trackRef, stageRef, sceneRef, reducedMotion, sceneVersion]);
}
