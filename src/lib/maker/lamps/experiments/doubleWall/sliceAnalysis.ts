import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Análisis de CAPAS de una malla: corta con un plano horizontal y reconstruye los lazos de la sección, como lo hace cualquier
 * laminador antes de generar trayectorias. NO es un laminador: no genera perímetros, relleno ni trayectorias; solo permite
 * inspeccionar lo que el laminador va a recibir (cantidad de contornos y huecos por capa, orientación, longitud, autointersección).
 * Sirve para detectar problemas ANTES de abrir Bambu Studio; no reemplaza abrirlo.
 */
export interface SliceLoop {
  points: [number, number][];
  /** Área con signo (shoelace): positivo = antihorario = contorno exterior de material; negativo = hueco. */
  area: number;
  length: number;
}

/** Corte horizontal (plano z = const). Los puntos son (x, y). */
export function sliceMesh(mesh: IndexedMesh, z: number): SliceLoop[] {
  return sliceMeshAxis(mesh, 2, z);
}

/**
 * Corte por un plano perpendicular al eje `axis` (0 = x, 1 = y, 2 = z) en `value`. Los puntos son las otras dos coordenadas en orden
 * cíclico derecho (eje x → (y, z); eje y → (z, x); eje z → (x, y)), de modo que el sólido queda a la izquierda y el área con signo
 * sigue el mismo criterio: positivo = contorno exterior, negativo = hueco. Sirve para las secciones VERTICALES.
 */
export function sliceMeshAxis(mesh: IndexedMesh, axis: 0 | 1 | 2, value: number): SliceLoop[] {
  const p = mesh.positions;
  const au = (axis + 1) % 3, av = (axis + 2) % 3;
  const z = value;
  const nV = p.length / 3;
  const segs = new Map<number, { end: number; pt: [number, number] }>();
  const edgePoint = (a: number, b: number): [number, number, number] => {
    const t = (z - p[a * 3 + axis]) / (p[b * 3 + axis] - p[a * 3 + axis]);
    return [p[a * 3 + au] + (p[b * 3 + au] - p[a * 3 + au]) * t, p[a * 3 + av] + (p[b * 3 + av] - p[a * 3 + av]) * t, a < b ? a * nV + b : b * nV + a];
  };
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const v = [mesh.tris[i], mesh.tris[i + 1], mesh.tris[i + 2]];
    const crossing: [number, number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      if ((p[a * 3 + axis] - z) * (p[b * 3 + axis] - z) < 0) crossing.push(edgePoint(a, b));
    }
    if (crossing.length !== 2) continue;
    const a0 = v[0] * 3, a1 = v[1] * 3, a2 = v[2] * 3;
    const ux = p[a1] - p[a0], uy = p[a1 + 1] - p[a0 + 1], uz = p[a1 + 2] - p[a0 + 2];
    const wx = p[a2] - p[a0], wy = p[a2 + 1] - p[a0 + 1], wz = p[a2 + 2] - p[a0 + 2];
    const nv = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    // dirección con el sólido a la izquierda: e_axis × n  =>  (d_u, d_v) = (−n_v, n_u)
    const dx = -nv[av], dy = nv[au];
    let [p0, p1] = crossing;
    if ((p1[0] - p0[0]) * dx + (p1[1] - p0[1]) * dy < 0) [p0, p1] = [p1, p0];
    segs.set(p0[2], { end: p1[2], pt: [p0[0], p0[1]] });
  }
  const loops: SliceLoop[] = [];
  const used = new Set<number>();
  for (const startKey of segs.keys()) {
    if (used.has(startKey)) continue;
    const points: [number, number][] = [];
    let key = startKey;
    let guard = 0;
    while (!used.has(key) && guard++ < 1e6) {
      used.add(key);
      const s = segs.get(key);
      if (!s) break;
      points.push(s.pt);
      key = s.end;
    }
    let area = 0, length = 0;
    for (let k = 0; k < points.length; k++) {
      const a = points[k], b = points[(k + 1) % points.length];
      area += (a[0] * b[1] - b[0] * a[1]) / 2;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    loops.push({ points, area, length });
  }
  return loops;
}

/** ¿El polígono (lazo cerrado) se cruza a sí mismo? Pares de segmentos no adyacentes. */
export function loopSelfIntersects(points: [number, number][]): boolean {
  const n = points.length;
  const ccw = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = points[j], d = points[(j + 1) % n];
      if (Math.min(a[0], b[0]) > Math.max(c[0], d[0]) || Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.min(a[1], b[1]) > Math.max(c[1], d[1]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1])) continue;
      if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return true;
    }
  }
  return false;
}

export function pointInLoop(pt: [number, number], loop: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export interface LayerSummary {
  z: number;
  /** Contornos exteriores (área > 0) y huecos (área < 0). */
  outerContours: number;
  holes: number;
  /** Longitud del contorno exterior (la que recorre el modo jarrón) y suma de la longitud de todos los lazos. */
  outerLength: number;
  totalLength: number;
  /** Todos los huecos están dentro del contorno exterior y ningún lazo se cruza a sí mismo. */
  nested: boolean;
  selfIntersections: number;
}

export function summarizeLayer(mesh: IndexedMesh, z: number, checkIntersections = true): LayerSummary {
  const loops = sliceMesh(mesh, z);
  const outer = loops.filter((l) => l.area > 0);
  const holes = loops.filter((l) => l.area < 0);
  const nested = outer.length === 1 && holes.every((h) => pointInLoop(h.points[0], outer[0].points));
  const selfIntersections = checkIntersections ? loops.filter((l) => loopSelfIntersects(l.points)).length : 0;
  return {
    z,
    outerContours: outer.length,
    holes: holes.length,
    outerLength: outer.reduce((s, l) => s + l.length, 0),
    totalLength: loops.reduce((s, l) => s + l.length, 0),
    nested,
    selfIntersections,
  };
}

/** Componentes conexas (por vértices compartidos) de una malla indexada. */
export function countComponents(mesh: IndexedMesh): number {
  const n = mesh.positions.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const used = new Uint8Array(n);
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i], b = mesh.tris[i + 1], c = mesh.tris[i + 2];
    used[a] = used[b] = used[c] = 1;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i++) if (used[i]) roots.add(find(i));
  return roots.size;
}

export interface ShellReport {
  /** Superficies cerradas conexas de la malla. */
  shells: number;
  /** Cuerpos sólidos (superficies con volumen positivo) y cavidades internas (volumen negativo: normales hacia adentro de la cavidad). */
  solidBodies: number;
  cavities: number;
  volumes: number[];
}

/**
 * Clasifica las superficies conexas por el signo de su volumen. Una cámara cerrada es una cavidad: otra superficie dentro del
 * sólido, con volumen negativo. Es UN solo sólido con un hueco interno, no dos piezas.
 */
export function shellReport(mesh: IndexedMesh): ShellReport {
  const n = mesh.positions.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < mesh.tris.length; i += 3) {
    parent[find(mesh.tris[i])] = find(mesh.tris[i + 1]);
    parent[find(mesh.tris[i + 1])] = find(mesh.tris[i + 2]);
  }
  const p = mesh.positions;
  const vol = new Map<number, number>();
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
    const v = (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    const root = find(mesh.tris[i]);
    vol.set(root, (vol.get(root) ?? 0) + v);
  }
  const volumes = [...vol.values()];
  return { shells: volumes.length, solidBodies: volumes.filter((v) => v > 0).length, cavities: volumes.filter((v) => v < 0).length, volumes };
}
