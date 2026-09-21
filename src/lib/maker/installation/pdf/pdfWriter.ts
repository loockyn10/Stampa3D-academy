/**
 * Escritor PDF mínimo, vectorial y SIN dependencias (paths, círculos, recorte, texto
 * con las fuentes base-14). Existe para poder garantizar la ESCALA 1:1 de la plantilla:
 * cada página declara su tamaño real en puntos (`MediaBox`) y su contenido usa una
 * matriz fija mm -> pt (`72 / 25.4`), de modo que 1 unidad de dibujo = 1 mm de papel.
 * Nada se rasteriza. Se eligió esto en vez de sumar una dependencia porque el proyecto
 * solo tenía `@react-pdf/renderer` (pensado para documentos de flujo, no para geometría
 * a escala con teselado) y la necesidad aquí es acotada y testeable byte a byte.
 *
 * Coordenadas de página: milímetros, origen abajo-izquierda, Y hacia arriba.
 */

export const PT_PER_MM = 72 / 25.4;
export const mmToPt = (mm: number): number => mm * PT_PER_MM;
export const ptToMm = (pt: number): number => pt / PT_PER_MM;

export type PdfFont = "regular" | "bold" | "symbol";
const FONT_RESOURCE: Record<PdfFont, string> = { regular: "F1", bold: "F2", symbol: "F3" };
/** Flecha derecha en la fuente Symbol (código 0xAE): no existe en WinAnsi. */
export const SYMBOL_ARROW_RIGHT = "®";

const num = (n: number): string => {
  const s = (Math.round(n * 10000) / 10000).toFixed(4);
  return s.replace(/\.?0+$/, "") || "0";
};

/** Caracteres fuera de Latin-1 que sí existen en WinAnsi (bytes 0x80-0x9F). */
const WIN_ANSI_EXTRA: Record<number, number> = { 0x2014: 0x97, 0x2013: 0x96, 0x2022: 0x95, 0x201c: 0x93, 0x201d: 0x94, 0x2019: 0x92, 0x2018: 0x91 };

function escapeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    const c = code <= 255 ? ch : WIN_ANSI_EXTRA[code] !== undefined ? String.fromCharCode(WIN_ANSI_EXTRA[code]) : "?";
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return out;
}

/** Ancho aproximado del texto (mm) para alinear/centrar: promedio de Helvetica (no exacto, suficiente para etiquetas). */
export function approxTextWidthMm(text: string, sizeMm: number, font: PdfFont = "regular"): number {
  const factor = font === "bold" ? 0.6 : font === "symbol" ? 1 : 0.54;
  return [...text].length * sizeMm * factor;
}

export class PdfPage {
  readonly widthMm: number;
  readonly heightMm: number;
  private ops: string[] = [];

  constructor(widthMm: number, heightMm: number) {
    this.widthMm = widthMm;
    this.heightMm = heightMm;
    // Única conversión de unidades del documento: mm -> pt.
    this.ops.push(`${num(PT_PER_MM)} 0 0 ${num(PT_PER_MM)} 0 0 cm`);
  }

  save(): this { this.ops.push("q"); return this; }
  restore(): this { this.ops.push("Q"); return this; }
  /** Traslada el origen de dibujo (mm). */
  translate(x: number, y: number): this { this.ops.push(`1 0 0 1 ${num(x)} ${num(y)} cm`); return this; }
  strokeColor(r: number, g: number, b: number): this { this.ops.push(`${num(r)} ${num(g)} ${num(b)} RG`); return this; }
  fillColor(r: number, g: number, b: number): this { this.ops.push(`${num(r)} ${num(g)} ${num(b)} rg`); return this; }
  lineWidth(mm: number): this { this.ops.push(`${num(mm)} w`); return this; }
  dash(pattern: number[], phase = 0): this { this.ops.push(`[${pattern.map(num).join(" ")}] ${num(phase)} d`); return this; }
  solid(): this { this.ops.push("[] 0 d"); return this; }

  moveTo(x: number, y: number): this { this.ops.push(`${num(x)} ${num(y)} m`); return this; }
  lineTo(x: number, y: number): this { this.ops.push(`${num(x)} ${num(y)} l`); return this; }
  closePath(): this { this.ops.push("h"); return this; }
  stroke(): this { this.ops.push("S"); return this; }
  fill(): this { this.ops.push("f"); return this; }
  fillStroke(): this { this.ops.push("B"); return this; }
  /** Relleno par-impar (los counters de las letras quedan vacíos). */
  fillEvenOdd(): this { this.ops.push("f*"); return this; }
  fillStrokeEvenOdd(): this { this.ops.push("B*"); return this; }

  /** Polilínea/polígono. */
  polyline(points: readonly (readonly [number, number])[], closed = false): this {
    points.forEach(([x, y], i) => (i === 0 ? this.moveTo(x, y) : this.lineTo(x, y)));
    if (closed) this.closePath();
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this { this.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`); return this; }

  /** Círculo con 4 curvas de Bézier (sin recorrer el path: el llamador hace stroke/fill). */
  circle(cx: number, cy: number, r: number): this {
    const k = 0.5522847498 * r;
    this.moveTo(cx + r, cy);
    this.ops.push(`${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`);
    this.ops.push(`${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c`);
    this.ops.push(`${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`);
    this.ops.push(`${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`);
    return this.closePath();
  }

  /** Recorte rectangular: todo lo que se dibuje después (hasta `restore`) queda dentro. */
  clipRect(x: number, y: number, w: number, h: number): this {
    this.rect(x, y, w, h);
    this.ops.push("W n");
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number): this { return this.moveTo(x1, y1).lineTo(x2, y2).stroke(); }

  /** Texto (tamaño en mm). `align`: "left" | "center" | "right" respecto de x. */
  text(text: string, x: number, y: number, sizeMm: number, opts: { font?: PdfFont; align?: "left" | "center" | "right"; rotateDeg?: number } = {}): this {
    const font = opts.font ?? "regular";
    const width = approxTextWidthMm(text, sizeMm, font);
    const dx = opts.align === "center" ? -width / 2 : opts.align === "right" ? -width : 0;
    const rot = ((opts.rotateDeg ?? 0) * Math.PI) / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    const tx = x + dx * c, ty = y + dx * s;
    this.ops.push("BT", `/${FONT_RESOURCE[font]} ${num(sizeMm)} Tf`, `${num(c)} ${num(s)} ${num(-s)} ${num(c)} ${num(tx)} ${num(ty)} Tm`, `(${escapeText(text)}) Tj`, "ET");
    return this;
  }

  /** Texto en varios renglones (separados por \n). */
  paragraph(lines: string[], x: number, y: number, sizeMm: number, lineHeightMm: number, opts: { font?: PdfFont } = {}): this {
    lines.forEach((line, i) => this.text(line, x, y - i * lineHeightMm, sizeMm, opts));
    return this;
  }

  contentString(): string {
    return this.ops.join("\n");
  }
}

export class PdfDocument {
  private pages: PdfPage[] = [];
  private info: { title?: string; creator?: string } = {};

  setInfo(info: { title?: string; creator?: string }): void {
    this.info = info;
  }

  addPage(widthMm: number, heightMm: number): PdfPage {
    const page = new PdfPage(widthMm, heightMm);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  toBytes(): Uint8Array {
    const objects: string[] = [];
    const add = (body: string): number => objects.push(body);
    // 1: catálogo, 2: páginas, 3-5: fuentes, luego (página, contenido) por página, y el info.
    add("<< /Type /Catalog /Pages 2 0 R >>");
    const kids = this.pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
    add(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>");
    this.pages.forEach((page, i) => {
      const contentId = 7 + i * 2;
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(mmToPt(page.widthMm))} ${num(mmToPt(page.heightMm))}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`,
      );
      const content = page.contentString();
      add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    const infoId = add(`<< /Title (${escapeText(this.info.title ?? "Stampa Maker")}) /Creator (${escapeText(this.info.creator ?? "Stampa Maker")}) >>`);

    let out = "%PDF-1.4\n%âãÏÓ\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefAt = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

    // Todo el documento es Latin-1 (1 char = 1 byte): los offsets del xref cuentan bytes.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}

export const PAPER_SIZES_MM = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  A3: { widthMm: 297, heightMm: 420 },
} as const;
