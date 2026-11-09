/**
 * Línea de tiempo del Hero: función pura de progreso de scroll (0..1) → valores de cámara, núcleo y capas HTML.
 * No conoce Three.js ni el DOM, así que se puede ajustar (o testear) sola.
 *
 *   0.00 – 0.04  Exploración (núcleo flotando, texto del hero visible)
 *   0.04 – 0.55  Transformación (la cámara se acerca, las piezas se separan)
 *   0.50 – 0.74  Travesía (la cámara atraviesa el núcleo; destello)
 *   0.74 – 1.00  Descubrimiento (se revela la plataforma)
 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const norm = (v: number, a: number, b: number): number => clamp01((v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = norm(v, a, b);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export type HeroTimeline = {
  /** 0..1 separación de capas y piezas. */
  explode: number;
  /** Cámara (unidades de escena). `z` es relativa al encuadre base: se interpola entre `baseZ` y `endZ`. */
  camZ: number;
  camY: number;
  lookY: number;
  /** Giro adicional del núcleo ligado al scroll (rad). */
  twist: number;
  /** 0..1 intensidad del corazón luminoso. */
  glow: number;
  /** 0..1 destello de la travesía (overlay HTML). */
  flash: number;
  /** 1 = núcleo desplazado hacia el lado del encuadre inicial, 0 = centrado. */
  shift: number;
  /** Atenuación del movimiento libre (giro/parallax) a medida que avanza el scroll. */
  idle: number;
  /** Opacidad del canvas. */
  canvas: number;
  /** Opacidad del texto principal. */
  hero: number;
  /** Opacidad de cada subtítulo cinematográfico. */
  caption1: number;
  caption2: number;
  /** 0..1 revelado de la escena final. */
  discovery: number;
};

/** `flashScale`: atenúa el destello de la travesía (1 = completo). */
export type HeroCameraRig = { baseZ: number; endZ: number; flashScale?: number };

/** Vuelve a pasar por un campana: sube en [a,b], baja en [c,d]. */
const bell = (v: number, a: number, b: number, c: number, d: number): number =>
  smoothstep(a, b, v) * (1 - smoothstep(c, d, v));

export function computeTimeline(p: number, rig: HeroCameraRig): HeroTimeline {
  const progress = clamp01(p);
  const approach = easeInOutCubic(norm(progress, 0.02, 0.82));
  return {
    explode: easeInOutCubic(norm(progress, 0.04, 0.5)),
    camZ: lerp(rig.baseZ, rig.endZ, approach),
    camY: lerp(1.3, 0, smoothstep(0, 0.5, progress)),
    lookY: lerp(0.15, 0, smoothstep(0, 0.5, progress)),
    twist: progress * 1.35,
    glow: smoothstep(0.2, 0.6, progress),
    flash: bell(progress, 0.47, 0.585, 0.585, 0.76) * (rig.flashScale ?? 1),
    shift: 1 - smoothstep(0, 0.32, progress),
    idle: 1 - smoothstep(0, 0.3, progress),
    canvas: 1 - 0.62 * smoothstep(0.7, 0.93, progress),
    hero: 1 - smoothstep(0.015, 0.13, progress),
    caption1: bell(progress, 0.12, 0.2, 0.3, 0.37),
    caption2: bell(progress, 0.31, 0.39, 0.47, 0.53),
    discovery: smoothstep(0.76, 0.94, progress),
  };
}
