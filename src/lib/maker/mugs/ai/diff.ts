import type { MugDecoration, MugDefinition } from "@/lib/maker/mugs/types";

/** Cambio semántico entre dos definiciones, listo para mostrarse ANTES → DESPUÉS (nunca JSON). */
export interface MugDiffEntry {
  id: string;
  group: string;
  label: string;
  before: string;
  after: string;
  kind: "changed" | "added" | "removed";
}

const LABELS = {
  mode: { printed: "Jarro impreso", "insert-shell": "Para inserto" },
  body: { straight: "Recto", conical: "Cónico", barrel: "Barril", bulged: "Abombado" },
  rim: { simple: "Simple", thick: "Grueso", rounded: "Redondeado" },
  base: { normal: "Normal", reinforced: "Reforzada" },
  surface: { smooth: "Lisa", faceted: "Facetada" },
  handle: { classic: "Clásica", square: "Cuadrada", angular: "Angular" },
  decoMode: { emboss: "relieve", engrave: "grabado", medallion: "medallón" },
} as const;

const mm = (v: number) => `${Math.round(v * 10) / 10} mm`;
const pct = (v: number) => `${Math.round(v)}%`;
const lbl = (map: Record<string, string>, v: string) => map[v] ?? v;

interface FieldRow {
  id: string;
  group: string;
  label: string;
  /** null = el campo no aplica a esta definición (no se compara si no aplica en ninguna de las dos). */
  get: (d: MugDefinition) => string | null;
}

const insertMode = (d: MugDefinition) => d.mode === "insert-shell";

const FIELDS: FieldRow[] = [
  { id: "mode", group: "General", label: "Modo", get: (d) => lbl(LABELS.mode, d.mode) },
  { id: "height", group: "Dimensiones", label: "Altura", get: (d) => (insertMode(d) ? null : mm(d.heightMm)) },
  { id: "topDiameter", group: "Dimensiones", label: "Diámetro superior", get: (d) => (insertMode(d) ? null : mm(d.topDiameterMm)) },
  { id: "bottomDiameter", group: "Dimensiones", label: "Diámetro inferior", get: (d) => (insertMode(d) ? null : mm(d.bottomDiameterMm)) },
  { id: "wall", group: "Dimensiones", label: "Espesor de pared", get: (d) => mm(d.wallThicknessMm) },
  { id: "bottomThickness", group: "Dimensiones", label: "Espesor de base", get: (d) => mm(d.bottomThicknessMm) },
  { id: "bodyStyle", group: "Cuerpo", label: "Cuerpo", get: (d) => lbl(LABELS.body, d.bodyStyle) },
  { id: "bulge", group: "Cuerpo", label: "Abombado", get: (d) => (d.bodyStyle === "barrel" || d.bodyStyle === "bulged" ? pct(d.bodyBulgePct) : null) },
  { id: "rim", group: "Cuerpo", label: "Borde", get: (d) => lbl(LABELS.rim, d.rim) },
  { id: "base", group: "Cuerpo", label: "Base", get: (d) => lbl(LABELS.base, d.base) },
  { id: "surface", group: "Cuerpo", label: "Superficie", get: (d) => (d.surface.style === "faceted" ? `Facetada (${d.surface.sides} lados)` : "Lisa") },
  { id: "grooves", group: "Ranuras", label: "Ranuras", get: (d) => (d.grooves.enabled ? `${d.grooves.count}` : "0") },
  { id: "groovesDepth", group: "Ranuras", label: "Profundidad de ranuras", get: (d) => (d.grooves.enabled ? mm(d.grooves.depthMm) : null) },
  { id: "bands", group: "Bandas", label: "Bandas", get: (d) => (d.bands.enabled ? `${d.bands.count}` : "0") },
  { id: "bandsHeight", group: "Bandas", label: "Alto de banda", get: (d) => (d.bands.enabled ? mm(d.bands.heightMm) : null) },
  { id: "bandsRelief", group: "Bandas", label: "Relieve de banda", get: (d) => (d.bands.enabled ? mm(d.bands.reliefMm) : null) },
  { id: "handle", group: "Asa", label: "Asa", get: (d) => (d.handle.enabled ? lbl(LABELS.handle, d.handle.style) : "Sin asa") },
  { id: "handleThickness", group: "Asa", label: "Espesor del asa", get: (d) => (d.handle.enabled ? mm(d.handle.thicknessMm) : null) },
  { id: "handleSection", group: "Asa", label: "Ancho del asa", get: (d) => (d.handle.enabled ? mm(d.handle.sectionWidthMm) : null) },
  { id: "handleSize", group: "Asa", label: "Tamaño del asa", get: (d) => (d.handle.enabled ? (d.handle.auto ? "Automático" : `${mm(d.handle.heightMm)} × ${mm(d.handle.projectionMm)}`) : null) },
  { id: "handlePosition", group: "Asa", label: "Posición del asa", get: (d) => (d.handle.enabled && !d.handle.auto ? pct(d.handle.verticalPositionPct) : null) },
  { id: "insertHeight", group: "Inserto", label: "Altura del inserto", get: (d) => (insertMode(d) ? mm(d.insert.heightMm) : null) },
  { id: "insertTop", group: "Inserto", label: "Diámetro superior del inserto", get: (d) => (insertMode(d) ? mm(d.insert.topDiameterMm) : null) },
  { id: "insertBottom", group: "Inserto", label: "Diámetro inferior del inserto", get: (d) => (insertMode(d) ? mm(d.insert.bottomDiameterMm) : null) },
  { id: "insertClearance", group: "Inserto", label: "Holgura del inserto", get: (d) => (insertMode(d) ? mm(d.insert.clearanceMm) : null) },
];

function describeAngle(a: number): string {
  if (a === 0) return "frente";
  if (a === 90) return "lado del asa";
  if (a === -90) return "lado opuesto al asa";
  if (Math.abs(a) === 180) return "atrás";
  return `${Math.round(a)}°`;
}

function describeArt(d: MugDecoration): string {
  const s = d.source;
  if (s.kind === "text") return `Texto «${s.text.replace(/\n/g, " / ")}»`;
  if (s.kind === "svg" || s.kind === "raster") return `Archivo ${s.fileName}`;
  return "Medallón liso";
}

function describeDecoration(d: MugDecoration): string {
  return `${describeArt(d)} — ${LABELS.decoMode[d.mode]}, ${describeAngle(d.position.angleDeg)}, altura ${Math.round(d.position.centerZMm)} mm`;
}

function decorationChanges(a: MugDecoration, b: MugDecoration): string[] {
  const out: string[] = [];
  if (describeArt(a) !== describeArt(b)) out.push("arte");
  if (a.mode !== b.mode) out.push("modo");
  if (a.position.angleDeg !== b.position.angleDeg || a.position.centerZMm !== b.position.centerZMm) out.push("posición");
  if (a.size.widthMm !== b.size.widthMm || a.size.heightMm !== b.size.heightMm) out.push("tamaño");
  if (a.rotationDeg !== b.rotationDeg) out.push("rotación");
  if (a.depthMm !== b.depthMm) out.push("profundidad");
  if (a.enabled !== b.enabled) out.push(b.enabled ? "activada" : "desactivada");
  if (a.medallion.shape !== b.medallion.shape) out.push("forma del medallón");
  return out;
}

/** Diff semántico entre dos definiciones: solo lo que cambió, con etiquetas legibles. */
export function diffMugDefinitions(before: MugDefinition, after: MugDefinition): MugDiffEntry[] {
  const out: MugDiffEntry[] = [];
  for (const row of FIELDS) {
    const a = row.get(before), b = row.get(after);
    if (a === null && b === null) continue;
    if (a === b) continue;
    out.push({ id: row.id, group: row.group, label: row.label, before: a ?? "—", after: b ?? "—", kind: "changed" });
  }
  const prev = new Map(before.decorations.map((d) => [d.id, d]));
  const seen = new Set<string>();
  for (const d of after.decorations) {
    seen.add(d.id);
    const old = prev.get(d.id);
    if (!old) {
      out.push({ id: `deco:${d.id}`, group: "Decoraciones", label: "Decoración nueva", before: "—", after: describeDecoration(d), kind: "added" });
    } else {
      const changes = decorationChanges(old, d);
      if (changes.length > 0) out.push({ id: `deco:${d.id}`, group: "Decoraciones", label: `Decoración «${old.name}»`, before: describeDecoration(old), after: `${describeDecoration(d)} (cambia: ${changes.join(", ")})`, kind: "changed" });
    }
  }
  for (const d of before.decorations) {
    if (!seen.has(d.id)) out.push({ id: `deco:${d.id}`, group: "Decoraciones", label: "Decoración eliminada", before: describeDecoration(d), after: "—", kind: "removed" });
  }
  return out;
}
