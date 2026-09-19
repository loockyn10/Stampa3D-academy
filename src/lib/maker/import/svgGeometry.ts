import type { Point2D } from "@/lib/maker/types";
import { DesignImportError } from "@/lib/maker/import/types";

/** Matriz afín SVG [a,b,c,d,e,f]: x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** parent ∘ local: primero se aplica `local`, después `parent`. */
export function multiply(p: Matrix, l: Matrix): Matrix {
  return [
    p[0] * l[0] + p[2] * l[1],
    p[1] * l[0] + p[3] * l[1],
    p[0] * l[2] + p[2] * l[3],
    p[1] * l[2] + p[3] * l[3],
    p[0] * l[4] + p[2] * l[5] + p[4],
    p[1] * l[4] + p[3] * l[5] + p[5],
  ];
}

function applyToPoint(m: Matrix, [x, y]: Point2D): Point2D {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function numbersOf(s: string): number[] {
  return (s.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

/** Parsea el atributo `transform`: matrix, translate, scale, rotate, skewX, skewY (encadenados, anidables vía multiply). Funciones desconocidas se rechazan. */
export function parseTransform(value: string | undefined): Matrix {
  if (!value || !value.trim()) return IDENTITY;
  let result: Matrix = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    consumed += m[0].length;
    const args = numbersOf(m[2]);
    let t: Matrix;
    switch (m[1]) {
      case "matrix":
        if (args.length !== 6) throw new DesignImportError("SVG_INVALID", "El SVG tiene una transformación matrix() inválida.");
        t = args as Matrix;
        break;
      case "translate":
        t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale":
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        const r: Matrix = [cos, sin, -sin, cos, 0, 0];
        t = args.length >= 3 ? multiply(multiply([1, 0, 0, 1, args[1], args[2]], r), [1, 0, 0, 1, -args[1], -args[2]]) : r;
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        throw new DesignImportError("SVG_UNSUPPORTED", `El SVG usa una transformación no soportada (${m[1]}).`);
    }
    if (!t.every(Number.isFinite)) throw new DesignImportError("SVG_INVALID", "El SVG tiene una transformación con valores inválidos.");
    result = multiply(result, t);
  }
  if (consumed === 0) throw new DesignImportError("SVG_INVALID", "El SVG tiene un atributo transform inválido.");
  return result;
}

// --- Subpaths (líneas y cúbicas), en coordenadas locales ---

type Seg = { t: "L"; p: Point2D } | { t: "C"; c1: Point2D; c2: Point2D; p: Point2D };
export interface SubPath {
  start: Point2D;
  segs: Seg[];
  /** true si el subpath se cerró con Z (lo usa Neon LED para distinguir recorridos cerrados de abiertos; el resto del importador lo ignora). */
  closed?: boolean;
}

class Scanner {
  pos = 0;
  constructor(readonly s: string) {}
  skipSep(): void {
    while (this.pos < this.s.length && /[\s,]/.test(this.s[this.pos])) this.pos++;
  }
  atEnd(): boolean {
    this.skipSep();
    return this.pos >= this.s.length;
  }
  peekIsNumber(): boolean {
    this.skipSep();
    return this.pos < this.s.length && /[-+.\d]/.test(this.s[this.pos]);
  }
  number(): number {
    this.skipSep();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.pos, this.pos + 40));
    if (!m) throw new DesignImportError("SVG_INVALID", "El SVG tiene un trazado (path) con datos inválidos.");
    this.pos += m[0].length;
    return Number(m[0]);
  }
  flag(): number {
    this.skipSep();
    const c = this.s[this.pos];
    if (c !== "0" && c !== "1") throw new DesignImportError("SVG_INVALID", "El SVG tiene un arco inválido en un trazado.");
    this.pos++;
    return c === "1" ? 1 : 0;
  }
}

function arcToCubics(p0: Point2D, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Point2D): Seg[] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [{ t: "L", p: p1 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (p0[0] + p1[0]) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const step = dTheta / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const segs: Seg[] = [];
  const pt = (t: number): Point2D => [cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi, cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi];
  const dpt = (t: number): Point2D => [-rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi, -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi];
  for (let i = 0; i < n; i++) {
    const a = theta1 + i * step, b = a + step;
    const pa = pt(a), pb = i === n - 1 ? p1 : pt(b);
    const da = dpt(a), db = dpt(b);
    segs.push({ t: "C", c1: [pa[0] + k * da[0], pa[1] + k * da[1]], c2: [pb[0] - k * db[0], pb[1] - k * db[1]], p: pb });
  }
  return segs;
}

/** Parsea el atributo `d` de un <path> a subpaths. Soporta M L H V C S Q T A Z (absolutos y relativos). */
export function parsePathData(d: string): SubPath[] {
  const sc = new Scanner(d);
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCtrl: Point2D | null = null;
  let lastCmd = "";
  let cmd = "";

  const ensure = (): SubPath => {
    if (!cur) {
      cur = { start: [cx, cy], segs: [] };
      sx = cx;
      sy = cy;
      subs.push(cur);
    }
    return cur;
  };

  while (!sc.atEnd()) {
    const c = d[sc.pos];
    if (/[A-Za-z]/.test(c)) {
      if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) throw new DesignImportError("SVG_INVALID", "El SVG tiene un comando de trazado desconocido.");
      sc.pos++;
      if (c === "Z" || c === "z") {
        if (cur) {
          (cur as SubPath).closed = true;
          cx = sx;
          cy = sy;
          cur = null;
        }
        lastCmd = "Z";
        lastCtrl = null;
        cmd = "";
        continue;
      }
      cmd = c;
    } else if (!cmd || !sc.peekIsNumber()) {
      throw new DesignImportError("SVG_INVALID", "El SVG tiene un trazado (path) con datos inválidos.");
    } else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";

    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;

    switch (up) {
      case "M": {
        cx = sc.number() + ox;
        cy = sc.number() + oy;
        sx = cx;
        sy = cy;
        cur = { start: [cx, cy], segs: [] };
        subs.push(cur);
        lastCtrl = null;
        break;
      }
      case "L": {
        cx = sc.number() + ox;
        cy = sc.number() + oy;
        ensure().segs.push({ t: "L", p: [cx, cy] });
        lastCtrl = null;
        break;
      }
      case "H": {
        cx = sc.number() + ox;
        ensure().segs.push({ t: "L", p: [cx, cy] });
        lastCtrl = null;
        break;
      }
      case "V": {
        cy = sc.number() + oy;
        ensure().segs.push({ t: "L", p: [cx, cy] });
        lastCtrl = null;
        break;
      }
      case "C":
      case "S": {
        let c1: Point2D;
        if (up === "C") c1 = [sc.number() + ox, sc.number() + oy];
        else c1 = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        const c2: Point2D = [sc.number() + ox, sc.number() + oy];
        const p: Point2D = [sc.number() + ox, sc.number() + oy];
        ensure().segs.push({ t: "C", c1, c2, p });
        lastCtrl = c2;
        cx = p[0];
        cy = p[1];
        break;
      }
      case "Q":
      case "T": {
        let q: Point2D;
        if (up === "Q") q = [sc.number() + ox, sc.number() + oy];
        else q = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        const p: Point2D = [sc.number() + ox, sc.number() + oy];
        ensure().segs.push({
          t: "C",
          c1: [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)],
          c2: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
          p,
        });
        lastCtrl = q;
        cx = p[0];
        cy = p[1];
        break;
      }
      case "A": {
        const rx = sc.number(), ry = sc.number(), rot = sc.number();
        const large = sc.flag(), sweep = sc.flag();
        const p: Point2D = [sc.number() + ox, sc.number() + oy];
        ensure().segs.push(...arcToCubics([cx, cy], rx, ry, rot, large, sweep, p));
        lastCtrl = null;
        cx = p[0];
        cy = p[1];
        break;
      }
    }
    lastCmd = cmd;
  }
  return subs;
}

/** Subpaths de formas básicas (rect, círculo, elipse). */
export function rectSubPaths(x: number, y: number, w: number, h: number, rxIn: number | null, ryIn: number | null): SubPath[] {
  if (!(w > 0 && h > 0)) return [];
  let rx = rxIn ?? ryIn ?? 0;
  let ry = ryIn ?? rxIn ?? 0;
  rx = Math.min(Math.max(rx, 0), w / 2);
  ry = Math.min(Math.max(ry, 0), h / 2);
  if (rx === 0 || ry === 0) {
    return [{ start: [x, y], segs: [{ t: "L", p: [x + w, y] }, { t: "L", p: [x + w, y + h] }, { t: "L", p: [x, y + h] }] }];
  }
  const d = `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y}`;
  return parsePathData(d);
}

export function ellipseSubPaths(cx: number, cy: number, rx: number, ry: number): SubPath[] {
  if (!(rx > 0 && ry > 0)) return [];
  const k = 0.5522847498307936;
  const s: Seg[] = [
    { t: "C", c1: [cx + rx, cy + k * ry], c2: [cx + k * rx, cy + ry], p: [cx, cy + ry] },
    { t: "C", c1: [cx - k * rx, cy + ry], c2: [cx - rx, cy + k * ry], p: [cx - rx, cy] },
    { t: "C", c1: [cx - rx, cy - k * ry], c2: [cx - k * rx, cy - ry], p: [cx, cy - ry] },
    { t: "C", c1: [cx + k * rx, cy - ry], c2: [cx + rx, cy - k * ry], p: [cx + rx, cy] },
  ];
  return [{ start: [cx + rx, cy], segs: s }];
}

export function polySubPaths(pointsAttr: string): SubPath[] {
  const nums = numbersOf(pointsAttr);
  const pts: Point2D[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  if (pts.length < 3) return [];
  return [{ start: pts[0], segs: pts.slice(1).map((p) => ({ t: "L", p }) as Seg) }];
}

export function transformSubPaths(subs: SubPath[], m: Matrix): SubPath[] {
  const tp = (p: Point2D) => applyToPoint(m, p);
  return subs.map((s) => ({
    start: tp(s.start),
    closed: s.closed,
    segs: s.segs.map((g) => (g.t === "L" ? { t: "L", p: tp(g.p) } : { t: "C", c1: tp(g.c1), c2: tp(g.c2), p: tp(g.p) }) as Seg),
  }));
}

export function subPathsBounds(subs: SubPath[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (p: Point2D) => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  };
  for (const s of subs) {
    add(s.start);
    for (const g of s.segs) {
      if (g.t === "L") add(g.p);
      else {
        add(g.c1);
        add(g.c2);
        add(g.p);
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function flattenCubic(p0: Point2D, c1: Point2D, c2: Point2D, p3: Point2D, tol: number, out: Point2D[], depth: number): void {
  const dx = p3[0] - p0[0], dy = p3[1] - p0[1];
  const len = Math.hypot(dx, dy);
  const dist = (p: Point2D) => (len < 1e-12 ? Math.hypot(p[0] - p0[0], p[1] - p0[1]) : Math.abs((p[0] - p0[0]) * dy - (p[1] - p0[1]) * dx) / len);
  if (depth >= 12 || (dist(c1) <= tol && dist(c2) <= tol)) {
    out.push(p3);
    return;
  }
  const mid = (a: Point2D, b: Point2D): Point2D => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const a = mid(p0, c1), b = mid(c1, c2), c = mid(c2, p3);
  const ab = mid(a, b), bc = mid(b, c);
  const m = mid(ab, bc);
  flattenCubic(p0, a, ab, m, tol, out, depth + 1);
  flattenCubic(m, bc, c, p3, tol, out, depth + 1);
}

/** Aplana un subpath (ya transformado) a polígono, con tolerancia `tol` en unidades de la fuente. Descarta duplicados consecutivos y el punto de cierre repetido. */
export function flattenSubPath(sub: SubPath, tol: number): Point2D[] {
  const pts: Point2D[] = [sub.start];
  let cur = sub.start;
  for (const g of sub.segs) {
    if (g.t === "L") pts.push(g.p);
    else flattenCubic(cur, g.c1, g.c2, g.p, tol, pts, 0);
    cur = g.p;
  }
  const clean: Point2D[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-12) clean.push(p);
  }
  if (clean.length > 1) {
    const f = clean[0], l = clean[clean.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-12) clean.pop();
  }
  return clean;
}
