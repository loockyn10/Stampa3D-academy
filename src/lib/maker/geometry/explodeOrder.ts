import type { PartKind } from "@/lib/maker/types";

/**
 * Capa de armado SEMÁNTICA de cada tipo de pieza (0.4.2, corrige el orden
 * explosionado del frente perforado — sección 1 del pedido): 0 = cuerpo
 * (nunca se explota), valores crecientes = más lejos del cuerpo / más cerca
 * del observador en la vista ENSAMBLADA. Tabla central por `PartKind`, no
 * lógica dispersa en el viewport.
 *
 * Reemplaza el intento de 0.4.1 (`meshMinZ`, la posición Z real mínima de
 * cada malla) — que volvió a romperse al agregar el faldón lateral de la
 * máscara perforada (0.4.1 sección 15.6): el faldón extiende su geometría
 * hacia ATRÁS del difusor (hasta `depthMm - maskSideDepthMm`, potencialmente
 * cerca de Z=0), así que el `minZ` de la máscara termina siendo MENOR que el
 * del difusor aunque la máscara sea la pieza más externa — invirtiendo el
 * rank calculado a partir de esa métrica. La posición física real de cada
 * pieza es un detalle de implementación de front/*; el orden de armado es
 * una propiedad SEMÁNTICA de cada `PartKind` (que rol cumple, no dónde
 * llegan a extenderse sus vértices), así que se declara acá explícitamente
 * en vez de inferirse de la malla.
 *
 * "lid" (tapa completa), "diffuser" (difusor del frente perforado) y
 * "channelDiffuser" (difusor del canal luminoso) comparten la misma capa
 * porque nunca coexisten entre sí (son mutuamente excluyentes por
 * `frontType`) — cada una es, cuando existe, la única pieza intermedia entre
 * el cuerpo y la pieza más externa (o la única pieza extra, si no hay
 * ninguna más externa). "mask" (máscara perforada) es una capa más externa:
 * en `frontType === "perforated"` coexiste con "diffuser", y físicamente va
 * SIEMPRE por delante de él (ver docs/STAMPA_MAKER.md sección 15.5/15.6).
 */
export const PART_ASSEMBLY_LAYER: Record<PartKind, number> = {
  body: 0,
  lid: 1,
  diffuser: 1,
  channelDiffuser: 1,
  mask: 2,
};

/**
 * Rank de desplazamiento explosionado (1, 2, 3...) de cada pieza no-"body"
 * presente en `kinds`, derivado de `PART_ASSEMBLY_LAYER` — nunca del orden
 * en que aparecen en `kinds` ni de su posición Z real. Con 1 sola pieza
 * extra (p.ej. tapa, o difusor de canal) da rank 1 (mismo +10mm de
 * siempre); con 2 (máscara+difusor del frente perforado) el difusor
 * (capa 1, más cerca del cuerpo) recibe rank 1 y la máscara (capa 2, más
 * lejos) recibe rank 2 — nunca al revés, sin importar el orden de `kinds`.
 * Deduplica por capa (si coexistieran dos kinds de la misma capa, ambos
 * recibirían el mismo rank) — no ocurre hoy (lid/diffuser/channelDiffuser
 * son mutuamente excluyentes por `frontType`), pero mantiene la función
 * correcta si eso cambiara en el futuro.
 */
export function computeExplodeRanks(kinds: PartKind[]): Map<PartKind, number> {
  const nonBodyKinds = kinds.filter((kind) => kind !== "body");
  const uniqueLayers = Array.from(new Set(nonBodyKinds.map((kind) => PART_ASSEMBLY_LAYER[kind]))).sort((a, b) => a - b);
  const rankByLayer = new Map<number, number>();
  uniqueLayers.forEach((layer, i) => rankByLayer.set(layer, i + 1));

  const ranks = new Map<PartKind, number>();
  for (const kind of nonBodyKinds) {
    ranks.set(kind, rankByLayer.get(PART_ASSEMBLY_LAYER[kind])!);
  }
  return ranks;
}

/**
 * Separación inicial (0-100). Única fuente de verdad de la vista ensamblada/
 * explosionada: 0 = ensamblado, 1-100 = progresivamente explosionado. Arranca en
 * 0 (como antes arrancaba en "Ensamblada").
 */
export const DEFAULT_EXPLOSION_AMOUNT = 0;

/** Separación visual efectiva: durante Editar recortes es 0 (el valor del usuario no se toca, solo deja de aplicarse). */
export function effectiveExplosionAmount(userAmount: number, editingCutouts: boolean): number {
  return editingCutouts ? 0 : userAmount;
}

/** Desplazamiento Z visual (mm) de una pieza de rank `rank` (0 = cuerpo, nunca se mueve). */
export function computeExplodeOffsetMm(size: { height: number; depth: number }, percent: number, rank: number): number {
  return rank <= 0 ? 0 : computeExplodeStepMm(size, percent) * rank;
}

/**
 * Desplazamiento VISUAL (mm) entre capas consecutivas de la vista
 * explosionada, en función del tamaño del modelo y del porcentaje elegido
 * (0-100). Escala con la profundidad (peso principal) y con el alto del
 * diseño, así el mismo % funciona en una letra de 50 mm y en una de 500 mm.
 * Puramente visual: nunca toca la geometría exportada. La pieza de rank `r`
 * se mueve `r * step` (el orden semántico lo define `computeExplodeRanks`).
 */
export function computeExplodeStepMm(size: { height: number; depth: number }, percent: number): number {
  const pct = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0)) / 100;
  const reference = Math.max(size.depth, 0) * 0.8 + Math.max(size.height, 0) * 0.2;
  return pct * reference;
}
