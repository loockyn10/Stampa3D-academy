import type { LetterGeometryResult, LetterSignParams } from "@/lib/maker/types";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";
import { PAPER_SIZES_MM, PdfDocument, SYMBOL_ARROW_RIGHT, approxTextWidthMm, type PdfPage } from "@/lib/maker/installation/pdf/pdfWriter";
import type { CableLength, LetterWiring, WiringModel } from "@/lib/maker/installation/types";

/**
 * GUÍA DE CONEXIÓN (PDF). Muestra el orden FÍSICO del cable (S -> T -> A1 -> ...) y deja
 * explícito que la conexión ELÉCTRICA es en PARALELO: dos buses (+ y -) con una derivación a
 * cada letra. Pensada para principiantes: pocos pasos, sin teoría. Baja tensión DC únicamente.
 * Usa las mismas etiquetas que la plantilla y el ZIP (A1/A2), tomadas del modelo de cableado.
 */

export const WIRING_GUIDE_PARALLEL_NOTE = "Conexión eléctrica en paralelo";

const INK: [number, number, number] = [0.1, 0.1, 0.1];
const GRAY: [number, number, number] = [0.5, 0.5, 0.5];

/** "S → T → A1 → M → P → A2": el orden físico del cable. */
export function wiringOrderLabels(model: WiringModel): string[] {
  return model.letters.map((l) => l.label);
}

export function wiringOrderText(model: WiringModel): string {
  return wiringOrderLabels(model).join(" → ");
}

export function roleDescription(l: LetterWiring): string {
  if (l.role.hasPowerIn && l.role.hasOut) return "Alimentación + salida al siguiente";
  if (l.role.hasPowerIn) return "Alimentación (única letra)";
  if (l.role.hasOut) return "Entrada del anterior + salida al siguiente";
  return "Entrada del anterior (última)";
}

export const GUIDE_STEPS = [
  "Preparar los cables: cortar cada tramo con el largo indicado en la tabla (incluye margen) y pelar las puntas.",
  "Realizar los empalmes: en cada letra unir juntos los cables + (entrada, LED y salida) y, por separado, los cables - (entrada, LED y salida).",
  "Aislar cada empalme (por ejemplo con termocontraíble) para que + y - no se toquen jamás.",
  "Colocar cada empalme terminado en su alojamiento (+ y - van en bahías distintas) y pasar el cable por los clips.",
  "Verificar la polaridad: + con + y - con - en TODAS las letras. Nunca conectar la salida de un LED a la entrada del siguiente.",
  "Probar la iluminación con la fuente ANTES del montaje final y recién entonces fijar el cartel.",
];

function wrap(text: string, maxWidthMm: number, sizeMm: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (approxTextWidthMm(next, sizeMm) > maxWidthMm && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function box(page: PdfPage, x: number, y: number, w: number, h: number, label: string, size = 3.4, bold = true): void {
  page.save().strokeColor(...INK).lineWidth(0.35).solid().rect(x, y, w, h).stroke().restore();
  page.text(label, x + w / 2, y + h / 2 - size * 0.32, size, { align: "center", font: bold ? "bold" : "regular" });
}

/** Línea del orden físico con flechas reales (fuente Symbol) entre etiquetas. */
function drawOrderLine(page: PdfPage, labels: string[], x: number, y: number, maxWidth: number): number {
  const size = 4;
  let cx = x, cy = y;
  labels.forEach((label, i) => {
    const w = approxTextWidthMm(label, size, "bold");
    if (cx + w > x + maxWidth) { cx = x; cy -= 7; }
    page.text(label, cx, cy, size, { font: "bold" });
    cx += w + 1.5;
    if (i < labels.length - 1) {
      page.text(SYMBOL_ARROW_RIGHT, cx, cy, size, { font: "symbol" });
      cx += approxTextWidthMm(SYMBOL_ARROW_RIGHT, size, "symbol") + 1.5;
    }
  });
  return cy;
}

/** Esquema de dos buses (+ / -) con una derivación por letra; el bus + va con línea llena y el - punteada (no depende del color). */
function drawParallelDiagram(page: PdfPage, model: WiringModel, x: number, top: number, width: number): number {
  const perRow = 6;
  const rows: LetterWiring[][] = [];
  for (let i = 0; i < model.letters.length; i += perRow) rows.push(model.letters.slice(i, i + perRow));
  const rowH = 46;
  const busX0 = x + 30;
  const colW = (width - 34) / perRow;
  rows.forEach((row, ri) => {
    const yPlus = top - ri * rowH - 8;
    const yMinus = yPlus - 22;
    const busX1 = busX0 + row.length * colW;
    page.save().strokeColor(...INK).lineWidth(0.7).solid().line(busX0 - 8, yPlus, busX1, yPlus).restore();
    page.save().strokeColor(...INK).lineWidth(0.7).dash([2.5, 1.5]).line(busX0 - 8, yMinus, busX1, yMinus).restore();
    page.text("+", busX0 - 5, yPlus + 1.4, 5, { font: "bold" });
    page.text("-", busX0 - 5, yMinus + 1.4, 5, { font: "bold" });
    if (ri === 0) {
      box(page, x, yMinus + 5, 16, 12, "FUENTE", 3);
      // Terminales de la fuente: + al bus de arriba (línea llena), - al de abajo (punteada).
      page.save().strokeColor(...INK).lineWidth(0.5).solid().line(x + 8, yMinus + 17, x + 8, yPlus).line(x + 8, yPlus, busX0 - 8, yPlus).restore();
      page.save().strokeColor(...INK).lineWidth(0.5).dash([2.5, 1.5]).line(x + 8, yMinus + 5, x + 8, yMinus).line(x + 8, yMinus, busX0 - 8, yMinus).restore();
    } else {
      page.text("(continúa de la fila anterior)", x, yPlus + 3, 2.6);
    }
    row.forEach((l, ci) => {
      const cx = busX0 + colW * (ci + 0.5);
      // Derivación a cada bus: + arriba y - abajo, con el LED (caja) en el medio.
      page.save().strokeColor(...INK).lineWidth(0.5).solid().line(cx - 3, yPlus, cx - 3, yPlus - 6).line(cx + 3, yMinus, cx + 3, yMinus + 6).restore();
      page.save().strokeColor(...INK).fillColor(...INK).circle(cx - 3, yPlus, 0.8).fill().circle(cx + 3, yMinus, 0.8).fill().restore();
      box(page, cx - 7, yMinus + 6, 14, 10, `LED ${l.label}`, 2.8);
      page.text(l.label, cx, yMinus - 5.5, 3.6, { align: "center", font: "bold" });
    });
  });
  return top - rows.length * rowH;
}

/** Diagramas por tipo de letra (intermedia y última), con la misma notación IN+/LED+/OUT+. */
function drawLetterDiagrams(page: PdfPage, x: number, top: number): number {
  const w = 60;
  const sub = (title: string, ox: number, oy: number, hasOut: boolean) => {
    page.text(title, ox, oy, 3.4, { font: "bold" });
    const yP = oy - 11, yM = oy - 27;
    for (const [y, sign] of [[yP, "+"], [yM, "-"]] as const) {
      page.save().strokeColor(...INK).lineWidth(0.5).solid();
      if (sign === "-") page.dash([2.5, 1.5]);
      page.line(ox, y, ox + (hasOut ? w : 28), y).restore();
      page.text(`IN${sign}`, ox - 1, y + 1.6, 2.8, { font: "bold" });
      if (hasOut) page.text(`OUT${sign}`, ox + w - 8, y + 1.6, 2.8, { font: "bold" });
      const tapX = ox + 28;
      page.save().strokeColor(...INK).fillColor(...INK).lineWidth(0.5).solid().line(tapX, y, tapX, y + (sign === "+" ? -6 : 6)).circle(tapX, y, 0.8).fill().restore();
      page.text(`LED${sign}`, tapX + 7, y + (sign === "+" ? -5 : 4), 2.8);
    }
    page.save().strokeColor(...INK).lineWidth(0.4).solid().rect(ox + 23, yM + 6, 10, yP - yM - 12).stroke().restore();
    page.text("LED", ox + 28, (yP + yM) / 2 - 1, 2.8, { align: "center" });
  };
  sub("Letra intermedia (entrada y salida)", x, top, true);
  sub("Letra última (solo entrada)", x + 82, top, false);
  return top - 34;
}

export function buildWiringGuidePdf(result: LetterGeometryResult, params: LetterSignParams, title = "Cartel"): Uint8Array {
  const settings = getInstallationSettings(params);
  const plan = result.installation;
  const model = plan?.wiring ?? null;
  const size = PAPER_SIZES_MM[settings.template.paper];
  const doc = new PdfDocument();
  doc.setInfo({ title: `${title} - Guía de conexión`, creator: "Stampa Maker" });
  const m = 15;
  const W = size.widthMm, H = size.heightMm;
  const inner = W - 2 * m;

  const page1 = doc.addPage(W, H);
  page1.text(`${title} — Guía de conexión`, m, H - m - 5, 6, { font: "bold" });
  if (!model) {
    page1.text("El cableado está desactivado en este proyecto. Activá «Cableado: Encadenado» para generar la guía.", m, H - m - 16, 3.4);
    return doc.toBytes();
  }

  page1.text(WIRING_GUIDE_PARALLEL_NOTE.toUpperCase(), m, H - m - 15, 4.2, { font: "bold" });
  let y = H - m - 22;
  for (const line of wrap("Los cables recorren las letras en cadena, pero cada letra se conecta a los dos buses (+ y -): todas reciben la misma tensión. Solo baja tensión continua (DC). La fuente AC/DC y toda conexión a red (110/220 V) quedan FUERA del cartel.", inner, 3)) {
    page1.text(line, m, y, 3);
    y -= 4.4;
  }
  if (settings.wiring.voltage) {
    page1.text(`Tensión de los LED indicada: ${settings.wiring.voltage === "other" ? "otra" : settings.wiring.voltage} (solo referencia; no se dimensiona nada).`, m, y, 3);
    y -= 4.4;
  }

  y -= 4;
  page1.text("Orden físico del cable", m, y, 3.6, { font: "bold" });
  y -= 6;
  page1.text("FUENTE", m, y, 4, { font: "bold" });
  const afterSource = m + approxTextWidthMm("FUENTE", 4, "bold") + 1.5;
  page1.text(SYMBOL_ARROW_RIGHT, afterSource + 1, y, 4, { font: "symbol" });
  y = drawOrderLine(page1, wiringOrderLabels(model), afterSource + 8, y, inner - (afterSource - m) - 8);
  y -= 10;

  page1.text("Esquema eléctrico (todas las letras en paralelo)", m, y, 3.6, { font: "bold" });
  y = drawParallelDiagram(page1, model, m, y - 6, inner) - 4;
  page1.text("Línea llena = bus +   ·   Línea punteada = bus -", m, y, 2.8);
  y -= 10;

  y = drawLetterDiagrams(page1, m + 6, y - 2) - 6;

  // Tabla de roles y longitudes.
  const lengthOf = new Map<string, CableLength>();
  for (const c of plan?.cableLengths ?? []) lengthOf.set(c.fromId, c);
  page1.text("Letras y tramos de cable", m, y, 3.6, { font: "bold" });
  y -= 5;
  page1.text("Letra", m, y, 2.8, { font: "bold" }).text("Rol", m + 22, y, 2.8, { font: "bold" }).text("Tramo al siguiente (cable + servicio)", m + 92, y, 2.8, { font: "bold" });
  y -= 4;
  for (const l of model.letters) {
    if (y < m + 8) break;
    const c = lengthOf.get(l.instanceId);
    page1.text(l.label, m, y, 2.9, { font: "bold" }).text(roleDescription(l), m + 22, y, 2.9);
    page1.text(c ? `${c.fromLabel} a ${c.toLabel}: ${Math.round(c.lengthMm)} mm` : "—", m + 92, y, 2.9);
    y -= 4.2;
  }

  // Página 2: pasos.
  const page2 = doc.addPage(W, H);
  page2.text("Paso a paso", m, H - m - 5, 6, { font: "bold" });
  let y2 = H - m - 16;
  GUIDE_STEPS.forEach((step, i) => {
    page2.save().strokeColor(...INK).lineWidth(0.4).circle(m + 3, y2 + 1, 3).stroke().restore();
    page2.text(String(i + 1), m + 3, y2 - 0.2, 3.6, { align: "center", font: "bold" });
    for (const [li, line] of wrap(step, inner - 12, 3.2).entries()) page2.text(line, m + 10, y2 - li * 4.4, 3.2);
    y2 -= 8 + wrap(step, inner - 12, 3.2).length * 4.4;
  });
  y2 -= 6;
  page2.save().strokeColor(...GRAY).lineWidth(0.3).solid().rect(m, y2 - 16, inner, 20).stroke().restore();
  for (const [i, line] of wrap("Atención: este sistema es solo para cartelería LED de baja tensión (DC). Stampa imprime las piezas que sostienen, ordenan, separan y protegen el cableado; el contacto eléctrico lo hacen tus empalmes, nunca el plástico.", inner - 8, 3).entries()) {
    page2.text(line, m + 4, y2 - 2 - i * 4.2, 3);
  }
  return doc.toBytes();
}
