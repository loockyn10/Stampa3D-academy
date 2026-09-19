/**
 * Auto-arrange V1 de la Vista Cama: shelf packing determinístico sobre el
 * bounding box XY de cada pieza, con rotación solo 0°/90°. No compite con un
 * slicer: solo distribuye razonablemente las piezas en una o más placas.
 * Puro (sin three ni DOM) para poder testearlo. Ver docs/STAMPA_MAKER.md
 * sección 20.
 */
export interface PackItem {
  id: string;
  widthMm: number;
  depthMm: number;
}

export interface PackBed {
  widthMm: number;
  depthMm: number;
}

export interface Placement {
  id: string;
  /** Esquina mínima de la huella dentro de la placa (origen en la esquina frontal-izquierda). */
  x: number;
  y: number;
  /** true = la pieza se gira 90° respecto de su orientación original. */
  rotated: boolean;
  /** Huella final (ya con el giro aplicado). */
  widthMm: number;
  depthMm: number;
}

export interface Plate {
  /** 1-based. */
  index: number;
  placements: Placement[];
}

export interface OversizeItem {
  id: string;
  widthMm: number;
  depthMm: number;
}

export interface PackResult {
  plates: Plate[];
  /** Piezas cuya huella no entra en la cama ni girada 90°: NO se colocan (no se finge que entran). */
  oversize: OversizeItem[];
}

export const DEFAULT_SPACING_MM = 5;

interface Shelf {
  y: number;
  height: number;
  cursorX: number;
}

interface PlateState {
  plate: Plate;
  shelves: Shelf[];
  nextY: number;
}

interface Orientation {
  rotated: boolean;
  w: number;
  d: number;
}

const EPS = 1e-6;

/** Orientaciones candidatas en orden de preferencia: primero la que deja la pieza apaisada (ancho >= fondo) si entra. */
function orientationsFor(item: PackItem, bed: PackBed): Orientation[] {
  const normal: Orientation = { rotated: false, w: item.widthMm, d: item.depthMm };
  const turned: Orientation = { rotated: true, w: item.depthMm, d: item.widthMm };
  const list = item.widthMm >= item.depthMm ? [normal, turned] : [turned, normal];
  return list.filter((o) => o.w <= bed.widthMm + EPS && o.d <= bed.depthMm + EPS);
}

export function packItems(items: PackItem[], bed: PackBed, opts: { spacingMm?: number } = {}): PackResult {
  const spacing = Math.max(0, opts.spacingMm ?? DEFAULT_SPACING_MM);
  const oversize: OversizeItem[] = [];
  const candidates: { item: PackItem; orientations: Orientation[] }[] = [];

  for (const item of items) {
    const orientations = orientationsFor(item, bed);
    if (orientations.length === 0) oversize.push({ id: item.id, widthMm: item.widthMm, depthMm: item.depthMm });
    else candidates.push({ item, orientations });
  }

  // Orden determinístico: fondo preferido decreciente (shelf packing clásico), luego ancho e id.
  candidates.sort((a, b) => {
    const da = a.orientations[0].d;
    const db = b.orientations[0].d;
    if (Math.abs(da - db) > EPS) return db - da;
    const wa = a.orientations[0].w;
    const wb = b.orientations[0].w;
    if (Math.abs(wa - wb) > EPS) return wb - wa;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });

  const states: PlateState[] = [];
  const place = (state: PlateState, shelf: Shelf, id: string, o: Orientation) => {
    state.plate.placements.push({ id, x: shelf.cursorX, y: shelf.y, rotated: o.rotated, widthMm: o.w, depthMm: o.d });
    shelf.cursorX += o.w + spacing;
  };

  for (const { item, orientations } of candidates) {
    let placed = false;

    for (const state of states) {
      for (const shelf of state.shelves) {
        const o = orientations.find((c) => c.d <= shelf.height + EPS && shelf.cursorX + c.w <= bed.widthMm + EPS);
        if (o) {
          place(state, shelf, item.id, o);
          placed = true;
          break;
        }
      }
      if (placed) break;

      const o = orientations.find((c) => state.nextY + c.d <= bed.depthMm + EPS);
      if (o) {
        const shelf: Shelf = { y: state.nextY, height: o.d, cursorX: 0 };
        state.shelves.push(shelf);
        state.nextY += o.d + spacing;
        place(state, shelf, item.id, o);
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Una placa vacía siempre aloja una pieza que no es oversize.
      const o = orientations[0];
      const state: PlateState = { plate: { index: states.length + 1, placements: [] }, shelves: [], nextY: o.d + spacing };
      const shelf: Shelf = { y: 0, height: o.d, cursorX: 0 };
      state.shelves.push(shelf);
      states.push(state);
      place(state, shelf, item.id, o);
    }
  }

  return { plates: states.map((s) => s.plate), oversize };
}
