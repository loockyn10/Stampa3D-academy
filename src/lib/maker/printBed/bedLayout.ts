import type { LetterGeometryResult, PartKind, TriangleSoupData } from "@/lib/maker/types";
import { DEFAULT_SPACING_MM, packItems, type OversizeItem, type Placement, type Plate } from "@/lib/maker/printBed/packing";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

/**
 * Orientación de impresión SUGERIDA por pieza y layout de la Vista Cama. Todo
 * son transformaciones de ESCENA sobre las mismas mallas del `SignPart`
 * original: la geometría exportada nunca se toca.
 */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Piezas que se imprimen "cara visible contra la cama" (se voltean 180° en X):
 * la tapa (su labio queda hacia arriba, sin voladizos) y la máscara perforada
 * (la cara plana apoya en la cama y el faldón sube). El cuerpo apoya sobre su
 * base (Z=0) y los difusores planos se dejan como están.
 */
export const PRINT_FLIP_KINDS: readonly PartKind[] = ["lid", "mask"];

export interface BedItem {
  id: string;
  label: string;
  kind: PartKind;
  mesh: TriangleSoupData;
  /** Voltear 180° en X antes de apoyar (ver PRINT_FLIP_KINDS). */
  flip: boolean;
  /** Bounds de la malla ORIGINAL. */
  bounds: Bounds;
  /** Huella y alto tras aplicar el volteo (antes de rotar 0°/90° en Z). */
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export function computeMeshBounds(positions: Float32Array): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

function flipBounds(b: Bounds): Bounds {
  return { minX: b.minX, maxX: b.maxX, minY: -b.maxY, maxY: -b.minY, minZ: -b.maxZ, maxZ: -b.minZ };
}

export function makeBedItem(id: string, label: string, kind: PartKind, mesh: TriangleSoupData): BedItem {
  const bounds = computeMeshBounds(mesh.positions);
  const flip = PRINT_FLIP_KINDS.includes(kind);
  const o = flip ? flipBounds(bounds) : bounds;
  return {
    id,
    label,
    kind,
    mesh,
    flip,
    bounds,
    widthMm: o.maxX - o.minX,
    depthMm: o.maxY - o.minY,
    heightMm: o.maxZ - o.minZ,
  };
}

/**
 * Piezas a acomodar: cada pieza física de cada carácter (letras individuales,
 * como se exportan en el ZIP). Si el resultado no trae `letters`, las piezas
 * combinadas.
 */
export function collectBedItems(geometry: LetterGeometryResult): BedItem[] {
  const items: BedItem[] = [];
  if (geometry.letters.length > 0) {
    for (const letter of geometry.letters) {
      for (const part of letter.parts) {
        if (part.mesh.triangleCount === 0) continue;
        items.push(makeBedItem(`letter-${letter.index}-${part.kind}`, `${letter.char} · ${part.filenameSuffix}`, part.kind, part.mesh));
      }
    }
  } else {
    for (const part of geometry.parts) {
      if (part.mesh.triangleCount === 0) continue;
      items.push(makeBedItem(`part-${part.kind}`, part.filenameSuffix, part.kind, part.mesh));
    }
  }
  return items;
}

export interface BedLayout {
  plates: Plate[];
  oversize: (OversizeItem & { label: string })[];
  /** Piezas cuya altura (tras orientar) supera el volumen de la impresora. Se colocan igual y se avisa. */
  tooTall: { id: string; label: string; heightMm: number }[];
}

export function computeBedLayout(items: BedItem[], profile: PrinterProfile, spacingMm: number = DEFAULT_SPACING_MM): BedLayout {
  const packed = packItems(
    items.map((i) => ({ id: i.id, widthMm: i.widthMm, depthMm: i.depthMm })),
    { widthMm: profile.widthMm, depthMm: profile.depthMm },
    { spacingMm },
  );
  const labelOf = new Map(items.map((i) => [i.id, i.label]));
  return {
    plates: packed.plates,
    oversize: packed.oversize.map((o) => ({ ...o, label: labelOf.get(o.id) ?? o.id })),
    tooTall: items
      .filter((i) => i.heightMm > profile.heightMm + 1e-6)
      .map((i) => ({ id: i.id, label: i.label, heightMm: i.heightMm })),
  };
}

/**
 * Matriz 4x4 column-major (para THREE.Matrix4.fromArray) que lleva la malla
 * original a su lugar en la placa: volteo opcional, giro 90° opcional en Z,
 * y traslación para que la esquina mínima quede en (x, y) y el punto más bajo
 * en Z=0 (apoyada sobre la cama).
 */
export function placementMatrix(item: Pick<BedItem, "bounds" | "flip">, placement: Pick<Placement, "x" | "y" | "rotated">): number[] {
  // L = R * F, con F = diag(1,-1,-1) y R = giro +90° en Z: (x,y) -> (-y,x).
  const f = item.flip ? -1 : 1;
  const L = placement.rotated
    ? [
        [0, -f, 0],
        [1, 0, 0],
        [0, 0, f],
      ]
    : [
        [1, 0, 0],
        [0, f, 0],
        [0, 0, f],
      ];
  const b = item.bounds;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const x of [b.minX, b.maxX]) {
    for (const y of [b.minY, b.maxY]) {
      for (const z of [b.minZ, b.maxZ]) {
        minX = Math.min(minX, L[0][0] * x + L[0][1] * y + L[0][2] * z);
        minY = Math.min(minY, L[1][0] * x + L[1][1] * y + L[1][2] * z);
        minZ = Math.min(minZ, L[2][0] * x + L[2][1] * y + L[2][2] * z);
      }
    }
  }
  return [
    L[0][0], L[1][0], L[2][0], 0,
    L[0][1], L[1][1], L[2][1], 0,
    L[0][2], L[1][2], L[2][2], 0,
    placement.x - minX, placement.y - minY, -minZ, 1,
  ];
}
