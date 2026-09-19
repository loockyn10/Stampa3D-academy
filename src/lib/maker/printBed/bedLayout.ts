import type { LetterGeometryResult, PartKind, TriangleSoupData } from "@/lib/maker/types";
import { getPrintTransform, meshBounds, printRotationMatrix, rotatedBounds, type Bounds3, type Matrix3 } from "@/lib/maker/printOrientation";
import { DEFAULT_SPACING_MM, packItems, type OversizeItem, type Placement, type Plate } from "@/lib/maker/printBed/packing";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

/**
 * Layout de la Vista Cama. La orientación de cada pieza NO se decide acá: sale
 * de `printOrientation.ts` (PrintTransform por PartKind), la MISMA fuente que
 * usa la exportación STL. Todo son transformaciones de ESCENA sobre las mismas
 * mallas del `SignPart` original.
 */
export type Bounds = Bounds3;

export interface BedItem {
  id: string;
  label: string;
  kind: PartKind;
  mesh: TriangleSoupData;
  /** Bounds de la malla ORIGINAL. */
  bounds: Bounds;
  /** Huella y alto tras aplicar el PrintTransform del tipo de pieza (antes de rotar 0°/90° en Z para el packing). */
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export function makeBedItem(id: string, label: string, kind: PartKind, mesh: TriangleSoupData): BedItem {
  const bounds = meshBounds(mesh.positions);
  const o = rotatedBounds(bounds, printRotationMatrix(getPrintTransform(kind)));
  return {
    id,
    label,
    kind,
    mesh,
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
 * original a su lugar en la placa: PrintTransform del tipo de pieza (misma
 * rotación que aplica la exportación STL), giro 90° opcional en Z del
 * packing, y traslación para que la esquina mínima quede en (x, y) y el punto
 * más bajo en Z=0 (apoyada sobre la cama).
 */
export function placementMatrix(item: Pick<BedItem, "bounds" | "kind">, placement: Pick<Placement, "x" | "y" | "rotated">): number[] {
  const P: Matrix3 = printRotationMatrix(getPrintTransform(item.kind));
  const R: Matrix3 = placement.rotated ? [[0, -1, 0], [1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const L: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) L[i][j] += R[i][k] * P[k][j];
  const o = rotatedBounds(item.bounds, L);
  return [
    L[0][0], L[1][0], L[2][0], 0,
    L[0][1], L[1][1], L[2][1], 0,
    L[0][2], L[1][2], L[2][2], 0,
    placement.x - o.minX, placement.y - o.minY, -o.minZ, 1,
  ];
}
