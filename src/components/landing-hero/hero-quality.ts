/** Detección de capacidades y perfiles de calidad del Hero 3D. Solo se ejecuta en el navegador. */

export type HeroQualityTier = "low" | "medium" | "high";

export type HeroQuality = {
  tier: HeroQualityTier;
  /** Capas apiladas del núcleo. */
  layers: number;
  /** Objetos impresos que orbitan (3 o 4; los equipos modestos usan menos). */
  pieces: number;
  /** Partículas de fondo. */
  dust: number;
  /** Segmentos angulares de cada capa (la sección usa `tubeSegments × 3`). */
  ringSegments: number;
  tubeSegments: number;
  maxDpr: number;
  antialias: boolean;
  /** Reflejos de entorno (PMREM). Se omiten en el nivel bajo. */
  environment: boolean;
};

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

/**
 * ¿Se puede crear un contexto WebGL? El canvas de prueba queda sin referencias para que el navegador lo recoja
 * (forzar `loseContext()` acá puede dejar al renderer real sin contexto en algunos drivers).
 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function resolveHeroQuality(viewportWidth: number): HeroQuality {
  const nav = navigator as NavigatorWithMemory;
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const isSmall = viewportWidth < 768;
  const weak = cores <= 4 || memory <= 2;

  const tier: HeroQualityTier = isSmall ? (weak ? "low" : "medium") : weak ? "medium" : "high";

  switch (tier) {
    case "low":
      return { tier, layers: 26, pieces: 3, dust: 90, ringSegments: 56, tubeSegments: 4, maxDpr: 1.25, antialias: false, environment: false };
    case "medium":
      return { tier, layers: 36, pieces: 4, dust: 180, ringSegments: 80, tubeSegments: 5, maxDpr: 1.5, antialias: true, environment: true };
    default:
      return { tier, layers: 46, pieces: 4, dust: 320, ringSegments: 112, tubeSegments: 6, maxDpr: 1.75, antialias: true, environment: true };
  }
}
