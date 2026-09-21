import type { LetterGeometryResult, LetterSignParams, Point2D } from "@/lib/maker/types";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";
import { PAPER_SIZES_MM, PdfDocument, type PdfPage } from "@/lib/maker/installation/pdf/pdfWriter";
import type { PaperFormat } from "@/lib/maker/installation/types";

/**
 * PLANTILLA DE INSTALACIÓN 1:1. Una sola fuente de verdad con el 3D: los contornos son
 * los `ContourGroup` reales de cada letra (`LetterInstance.contourGroups`, jamás se
 * recalcula el texto con otra fuente) y todas las marcas (montaje, puertos, ruteo) salen
 * del MISMO `InstallationPlan` que genera la geometría. Vista DE FRENTE (como se ve en la
 * pared), 1 unidad = 1 mm, teselada en varias hojas con superposición cuando el cartel
 * no entra en una.
 */

export interface TemplateMark {
  id: string;
  instanceId: string;
  kind: "keyhole-drill" | "standoff" | "cable-port";
  /** Rótulo impreso: "M-S1", "M-K2", "IN", "OUT", "ALIM". */
  label: string;
  /** Posición GLOBAL (mm, mismas coordenadas de los contornos): la misma del plan 3D. */
  x: number;
  y: number;
  /** Diámetro de perforación / paso (mm). */
  diameterMm: number;
  /** Diámetro de la huella de referencia (cabeza del keyhole o cuerpo del separador), 0 = ninguna. */
  footprintDiameterMm: number;
  /** keyhole: centro de la cabeza (donde entra el tornillo); el tornillo queda arriba, en `x,y`. */
  headX?: number;
  headY?: number;
}

export interface TemplateRoute {
  fromId: string;
  toId: string;
  from: Point2D;
  to: Point2D;
}

export interface TemplateLetter {
  id: string;
  label: string;
  loops: Point2D[][];
  center: Point2D;
}

export interface TemplateModel {
  title: string;
  /** Caja del diseño en coordenadas globales. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  widthMm: number;
  heightMm: number;
  letters: TemplateLetter[];
  marks: TemplateMark[];
  routes: TemplateRoute[];
  mounting: "none" | "keyhole" | "standoff";
  summary: string[];
  paper: PaperFormat;
  overlapMm: number;
}

export function buildTemplateModel(result: LetterGeometryResult, params: LetterSignParams, title = "Cartel"): TemplateModel {
  const settings = getInstallationSettings(params);
  const plan = result.installation;
  const letters: TemplateLetter[] = result.letters.map((l) => {
    const b = l.instance.boundsMm;
    return { id: l.instance.id, label: l.instance.label, loops: l.instance.contourGroups.flatMap((g) => [g.outer, ...g.holes]), center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] };
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of result.letters) {
    const b = l.instance.boundsMm;
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }

  const marks: TemplateMark[] = [];
  const routes: TemplateRoute[] = [];
  const summary: string[] = [];
  if (plan) {
    const labelOf = new Map(result.letters.map((l) => [l.instance.id, l.instance.label]));
    for (const lp of plan.letters) {
      const label = labelOf.get(lp.instanceId) ?? lp.instanceId;
      let n = 0;
      for (const m of lp.mounts) {
        if (!m.valid) continue;
        n += 1;
        const gx = plan.origin.x + m.x, gy = plan.origin.y + m.y;
        if (m.kind === "keyhole") {
          const k = settings.mounting.keyhole;
          // Con el cuello hacia arriba (rotación 180°) el tornillo de pared queda en el extremo superior del cuello.
          marks.push({ id: m.id, instanceId: lp.instanceId, kind: "keyhole-drill", label: `${label}-K${n}`, x: gx, y: gy + k.neckLengthMm, diameterMm: k.neckWidthMm, footprintDiameterMm: k.headDiameterMm, headX: gx, headY: gy });
        } else {
          const s = settings.mounting.standoff;
          marks.push({ id: m.id, instanceId: lp.instanceId, kind: "standoff", label: `${label}-S${n}`, x: gx, y: gy, diameterMm: s.screwHoleDiameterMm, footprintDiameterMm: s.bodyDiameterMm });
        }
      }
      for (const p of lp.ports) {
        if (!p.valid) continue;
        marks.push({ id: p.id, instanceId: lp.instanceId, kind: "cable-port", label: p.role === "power-in" ? "ALIM" : p.role === "in" ? "IN" : "OUT", x: plan.origin.x + p.x, y: plan.origin.y + p.y, diameterMm: p.holeDiameterMm, footprintDiameterMm: 0 });
      }
    }
    if (plan.wiring) {
      const portOf = (id: string, role: "in" | "out") => plan.letters.find((l) => l.instanceId === id)?.ports.find((p) => (role === "out" ? p.role === "out" : p.role === "in"));
      for (const link of plan.wiring.links) {
        const a = portOf(link.fromId, "out"), b = portOf(link.toId, "in");
        if (a && b) routes.push({ fromId: link.fromId, toId: link.toId, from: [plan.origin.x + a.x, plan.origin.y + a.y], to: [plan.origin.x + b.x, plan.origin.y + b.y] });
      }
    }
    if (settings.mounting.type === "keyhole") {
      summary.push(`Montaje Keyhole: perforar en cada marca (tornillo para el cuello de ${settings.mounting.keyhole.neckWidthMm} mm; cabeza de ${settings.mounting.keyhole.headDiameterMm} mm).`);
    } else if (settings.mounting.type === "standoff") {
      const s = settings.mounting.standoff;
      summary.push(`Separadores de ${s.wallSpacingMm} mm: perforar en el centro de cada marca (tornillo de ${s.screwHoleDiameterMm} mm; cuerpo del separador de ${s.bodyDiameterMm} mm).`);
    }
    if (plan.wiring) summary.push("Cableado encadenado (conexión eléctrica en paralelo): la línea punteada es solo referencia del recorrido del cable; no requiere perforar la pared.");
  }

  return {
    title,
    bounds: { minX, maxX, minY, maxY },
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    letters,
    marks,
    routes,
    mounting: settings.mounting.type,
    summary,
    paper: settings.template.paper,
    overlapMm: settings.template.overlapMm,
  };
}

// ---------------------------------------------------------------- teselado

export const TEMPLATE_PADDING_MM = 12;
export const TEMPLATE_PAGE_MARGIN_MM = 10;
export const TEMPLATE_HEADER_MM = 12;
export const TEMPLATE_FOOTER_MM = 22;
export const CALIBRATION_MM = 100;

export interface TemplateTile {
  col: number;
  row: number;
  page: number;
  /** Origen (esquina inferior izquierda) del área que cubre esta hoja, en coordenadas de plantilla (0,0 = esquina inf. izq. del diseño). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TemplateLayout {
  paper: PaperFormat;
  pageWidthMm: number;
  pageHeightMm: number;
  usableWidthMm: number;
  usableHeightMm: number;
  overlapMm: number;
  cols: number;
  rows: number;
  tiles: TemplateTile[];
  /** Región a cubrir (diseño + relleno), coordenadas de plantilla. */
  content: { x0: number; y0: number; x1: number; y1: number };
}

function layoutOriented(widthMm: number, heightMm: number, paper: PaperFormat, overlapMm: number, landscape: boolean): TemplateLayout {
  const base = PAPER_SIZES_MM[paper];
  const size = landscape ? { widthMm: base.heightMm, heightMm: base.widthMm } : base;
  const usableW = size.widthMm - 2 * TEMPLATE_PAGE_MARGIN_MM;
  const usableH = size.heightMm - 2 * TEMPLATE_PAGE_MARGIN_MM - TEMPLATE_HEADER_MM - TEMPLATE_FOOTER_MM;
  const overlap = Math.min(Math.max(overlapMm, 0), Math.min(usableW, usableH) / 3);
  const content = { x0: -TEMPLATE_PADDING_MM, y0: -TEMPLATE_PADDING_MM, x1: widthMm + TEMPLATE_PADDING_MM, y1: heightMm + TEMPLATE_PADDING_MM };
  const cw = content.x1 - content.x0, ch = content.y1 - content.y0;
  const count = (total: number, usable: number) => (total <= usable + 1e-9 ? 1 : Math.ceil((total - overlap) / (usable - overlap) - 1e-9));
  const cols = count(cw, usableW), rows = count(ch, usableH);
  const tiles: TemplateTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = content.x0 + col * (usableW - overlap);
      const y1 = content.y1 - row * (usableH - overlap);
      tiles.push({ col, row, page: row * cols + col + 1, x0, y0: y1 - usableH, x1: x0 + usableW, y1 });
    }
  }
  return { paper, pageWidthMm: size.widthMm, pageHeightMm: size.heightMm, usableWidthMm: usableW, usableHeightMm: usableH, overlapMm: overlap, cols, rows, tiles, content };
}

/**
 * Teselado 1:1: `cols x rows` hojas con `overlapMm` de superposición, sin escalar; orden por
 * filas desde la esquina superior izquierda. La orientación (vertical/apaisada) es la que
 * necesite menos hojas (empate: vertical): un cartel ancho no desperdicia hojas.
 */
export function computeTemplateLayout(widthMm: number, heightMm: number, paper: PaperFormat, overlapMm: number): TemplateLayout {
  const portrait = layoutOriented(widthMm, heightMm, paper, overlapMm, false);
  const landscape = layoutOriented(widthMm, heightMm, paper, overlapMm, true);
  return landscape.tiles.length < portrait.tiles.length ? landscape : portrait;
}

// ----------------------------------------------------------------- dibujo

const INK: [number, number, number] = [0.1, 0.1, 0.1];
const GRAY: [number, number, number] = [0.55, 0.55, 0.55];

function drawArrowHead(page: PdfPage, x: number, y: number, angle: number, size: number): void {
  const a1 = angle + Math.PI * 0.85, a2 = angle - Math.PI * 0.85;
  page.moveTo(x, y).lineTo(x + Math.cos(a1) * size, y + Math.sin(a1) * size).lineTo(x + Math.cos(a2) * size, y + Math.sin(a2) * size).closePath().fill();
}

/** Símbolos de la leyenda (mismos dibujos que las marcas: no dependen del color). */
function drawSymbol(page: PdfPage, kind: "ring" | "dot" | "target" | "arrow", x: number, y: number): void {
  page.save().strokeColor(...INK).fillColor(...INK).lineWidth(0.3).solid();
  if (kind === "ring") page.circle(x, y, 1.6).stroke();
  else if (kind === "dot") page.circle(x, y, 1.4).fill();
  else if (kind === "target") page.circle(x, y, 1.8).stroke().circle(x, y, 0.5).fill();
  else {
    page.dash([1, 0.8]).line(x - 2.2, y, x + 1.6, y).solid();
    drawArrowHead(page, x + 2.2, y, 0, 1.4);
  }
  page.restore();
}

function drawContent(page: PdfPage, model: TemplateModel): void {
  const { widthMm: W } = model;
  page.strokeColor(...INK).fillColor(0.94, 0.94, 0.94).lineWidth(0.3).solid();
  for (const letter of model.letters) {
    page.save().translate(-model.bounds.minX, -model.bounds.minY);
    for (const loop of letter.loops) page.polyline(loop as Point2D[], true);
    page.fillStrokeEvenOdd();
    page.restore();
  }
  // Rótulos de letra (etiqueta única A1/A2: la misma de la guía de cableado y el ZIP).
  page.fillColor(...INK);
  for (const letter of model.letters) page.text(letter.label, letter.center[0] - model.bounds.minX, letter.center[1] - model.bounds.minY - 2, 6, { font: "bold", align: "center" });

  // Línea de nivel.
  page.save().strokeColor(...GRAY).lineWidth(0.25).dash([3, 1.5]).line(-TEMPLATE_PADDING_MM, 0, W + TEMPLATE_PADDING_MM, 0).restore();
  page.text("Línea de nivel", W + TEMPLATE_PADDING_MM - 1, 1.2, 2.4, { align: "right" });

  // Cotas: ancho total (abajo) y alto máximo (izquierda).
  const dimY = -6, dimX = -6, H = model.heightMm;
  page.save().strokeColor(...INK).lineWidth(0.25).solid();
  page.line(0, dimY, W, dimY).line(0, dimY - 1.5, 0, dimY + 1.5).line(W, dimY - 1.5, W, dimY + 1.5);
  page.line(dimX, 0, dimX, H).line(dimX - 1.5, 0, dimX + 1.5, 0).line(dimX - 1.5, H, dimX + 1.5, H);
  page.restore();
  page.text(`Ancho total: ${W.toFixed(1)} mm`, W / 2, dimY - 3.5, 2.8, { align: "center" });
  page.text(`Alto máx.: ${H.toFixed(1)} mm`, dimX - 2, H / 2, 2.8, { align: "center", rotateDeg: 90 });

  // Rutas de cable (solo referencia, punteadas con flecha).
  page.save().strokeColor(...INK).fillColor(...INK).lineWidth(0.3);
  for (const r of model.routes) {
    const fx = r.from[0] - model.bounds.minX, fy = r.from[1] - model.bounds.minY, tx = r.to[0] - model.bounds.minX, ty = r.to[1] - model.bounds.minY;
    page.dash([1.2, 0.9]).line(fx, fy, tx, ty).solid();
    drawArrowHead(page, (fx + tx) / 2 + Math.cos(Math.atan2(ty - fy, tx - fx)) * 1.2, (fy + ty) / 2 + Math.sin(Math.atan2(ty - fy, tx - fx)) * 1.2, Math.atan2(ty - fy, tx - fx), 1.8);
  }
  page.restore();

  // Marcas de montaje y pasos de cable.
  for (const m of model.marks) {
    const x = m.x - model.bounds.minX, y = m.y - model.bounds.minY;
    page.save().strokeColor(...INK).fillColor(...INK).lineWidth(0.3).solid();
    if (m.kind === "cable-port") {
      page.circle(x, y, Math.max(m.diameterMm / 2, 1.1)).fill();
      page.text(m.label, x, y + 2.4, 2.4, { align: "center", font: "bold" });
    } else {
      if (m.footprintDiameterMm > 0) {
        const hx = (m.headX ?? m.x) - model.bounds.minX, hy = (m.headY ?? m.y) - model.bounds.minY;
        page.save().strokeColor(...GRAY).dash([1.2, 1]).circle(hx, hy, m.footprintDiameterMm / 2).stroke().restore();
        if (m.kind === "keyhole-drill") page.save().strokeColor(...GRAY).dash([1.2, 1]).line(hx, hy, x, y).restore();
      }
      page.circle(x, y, m.diameterMm / 2).stroke();
      if (m.kind === "standoff") page.circle(x, y, 0.5).fill();
      page.line(x - m.diameterMm / 2 - 1.2, y, x + m.diameterMm / 2 + 1.2, y).line(x, y - m.diameterMm / 2 - 1.2, x, y + m.diameterMm / 2 + 1.2);
      page.text(m.label, x + m.diameterMm / 2 + 1.6, y + 1, 2.8, { font: "bold" });
      page.text(`Ø ${m.diameterMm} mm`, x + m.diameterMm / 2 + 1.6, y - 2, 2.4);
    }
    page.restore();
  }
}

function drawTile(page: PdfPage, model: TemplateModel, layout: TemplateLayout, tile: TemplateTile): void {
  const m = TEMPLATE_PAGE_MARGIN_MM;
  const ox = m, oy = m + TEMPLATE_FOOTER_MM;
  const { usableWidthMm: uw, usableHeightMm: uh, pageWidthMm: pw, pageHeightMm: ph } = layout;

  // Contenido a escala real, recortado al área útil de la hoja.
  page.save().clipRect(ox, oy, uw, uh).translate(ox - tile.x0, oy - tile.y0);
  drawContent(page, model);

  // Líneas de alineación en el centro de cada franja de superposición (mismas coordenadas de plantilla en hojas vecinas).
  const bands = { xs: [] as number[], ys: [] as number[] };
  if (tile.col > 0) bands.xs.push(tile.x0 + layout.overlapMm / 2);
  if (tile.col < layout.cols - 1) bands.xs.push(tile.x1 - layout.overlapMm / 2);
  if (tile.row > 0) bands.ys.push(tile.y1 - layout.overlapMm / 2);
  if (tile.row < layout.rows - 1) bands.ys.push(tile.y0 + layout.overlapMm / 2);
  page.strokeColor(...GRAY).lineWidth(0.2).dash([2, 2]);
  for (const bx of bands.xs) page.line(bx, tile.y0, bx, tile.y1);
  for (const by of bands.ys) page.line(tile.x0, by, tile.x1, by);
  page.solid().lineWidth(0.25);
  for (const bx of bands.xs) for (const by of bands.ys) page.circle(bx, by, 1.5).stroke().line(bx - 3, by, bx + 3, by).line(bx, by - 3, bx, by + 3);
  page.restore();

  // Marcas de corte en las esquinas del área útil.
  page.save().strokeColor(...INK).lineWidth(0.25).solid();
  const len = 6, gap = 1.5;
  for (const [cx, cy, sx, sy] of [[ox, oy, -1, -1], [ox + uw, oy, 1, -1], [ox, oy + uh, -1, 1], [ox + uw, oy + uh, 1, 1]] as const) {
    page.line(cx + sx * gap, cy, cx + sx * (gap + len), cy).line(cx, cy + sy * gap, cx, cy + sy * (gap + len));
  }
  page.restore();

  // Encabezado.
  page.text(`${model.title} — Plantilla de instalación 1:1`, m, ph - m - 3.5, 4, { font: "bold" });
  page.text(`Página ${tile.page} / ${layout.tiles.length}  ·  columna ${tile.col + 1} de ${layout.cols}, fila ${tile.row + 1} de ${layout.rows}`, pw - m, ph - m - 3.5, 3, { align: "right" });
  const notes = [...model.summary];
  if (layout.tiles.length > 1) notes.push(`Superponer las hojas sobre las líneas de alineación punteadas (${layout.overlapMm} mm de superposición). Orden: por filas, desde arriba a la izquierda.`);
  notes.slice(0, 2).forEach((line, i) => page.text(line, m, ph - m - 7.5 - i * 3, 2.4));

  // Pie: control de 100 mm (izquierda) y leyenda (derecha).
  const fy = m + 4;
  page.save().strokeColor(...INK).lineWidth(0.35).solid();
  page.line(m, fy, m + CALIBRATION_MM, fy).line(m, fy - 2, m, fy + 2).line(m + CALIBRATION_MM, fy - 2, m + CALIBRATION_MM, fy + 2);
  page.restore();
  page.text("100 mm", m + CALIBRATION_MM / 2, fy + 1.5, 2.6, { align: "center" });
  page.text("Imprimir al 100% / Tamaño real.", m, fy + 10, 2.6, { font: "bold" }).text("Verificar que esta referencia mida 100 mm.", m, fy + 6.5, 2.6);
  const lx = m + CALIBRATION_MM + 8;
  const legend: { kind: "ring" | "dot" | "target" | "arrow"; text: string }[] = [
    { kind: "ring", text: "Perforación de montaje (keyhole)" },
    { kind: "target", text: "Receptor / separador (perforar en el centro)" },
    { kind: "dot", text: "Paso de cable (IN / OUT / ALIM)" },
    { kind: "arrow", text: "Dirección del cableado (referencia)" },
  ];
  legend.forEach((item, i) => {
    const y = fy + 11 - i * 4.4;
    drawSymbol(page, item.kind, lx + 2.4, y);
    page.text(item.text, lx + 6, y - 0.9, 2.3);
  });
}

/** Documento PDF vectorial de la plantilla. */
export function buildInstallTemplatePdf(model: TemplateModel): Uint8Array {
  const layout = computeTemplateLayout(model.widthMm, model.heightMm, model.paper, model.overlapMm);
  const doc = new PdfDocument();
  doc.setInfo({ title: `${model.title} - Plantilla de instalación 1:1`, creator: "Stampa Maker" });
  for (const tile of layout.tiles) drawTile(doc.addPage(layout.pageWidthMm, layout.pageHeightMm), model, layout, tile);
  return doc.toBytes();
}
