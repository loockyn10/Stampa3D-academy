import { diffuserKind, familyHasControl, isMainControl } from "@/lib/maker/lamps/capabilities";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import { LAMP_LIMITS, type LampDefinition, type LampIssue, type LampLimitKey, type LampShadeType } from "@/lib/maker/lamps/types";

/**
 * RESTRICCIONES DINÁMICAS de los controles de Lámparas.
 *
 * Un slider no puede ofrecer valores que rompan el modelo. Los límites de `LAMP_LIMITS` son la envolvente estática (valores que ningún diseño
 * admite); lo que de verdad se puede elegir en un control depende de TODOS los otros (la torsión máxima depende del diámetro y de la
 * inclinación de los rombos; la cintura, del difusor; la amplitud, de las ondas...). Esas dependencias no tienen una fórmula cerrada fiable
 * (la geometría es un campo muestreado), así que el rango se obtiene con la MISMA validación que bloquea la exportación (`validateLamp`):
 *
 *   1. se evalúa el control en ~25 valores de su envolvente (y en el valor actual);
 *   2. «válido» = ningún error que el control pueda evitar (los errores que aparecen en TODOS los valores, p. ej. los que causa otro control,
 *      no se le atribuyen a este: se informan aparte);
 *   3. se toma el tramo válido contiguo que contiene al valor actual (o el más cercano) y se afinan sus bordes por bisección sobre la grilla del control.
 *
 * Como cada borde sale de la validación real, todo valor ofrecido es válido DADO el estado actual; mover un control y recalcular los demás
 * mantiene la secuencia válida. Si los bordes se midieron con el muestreo grueso (doble pared), se confirman con la validación completa.
 * Nada acá modifica una definición: solo calcula rangos y razones.
 */

export interface LampControlSpec {
  /** Ruta del campo en la `LampDefinition` (`shade.heightMm`...). */
  path: string;
  label: string;
  /** Envolvente estática de la interfaz (siempre dentro de `LAMP_LIMITS`). */
  min: number;
  max: number;
  step: number;
  unit: string;
  /** true = control principal de la familia activa (se calcula primero y se muestra fuera de «Personalización avanzada»). Lo decide `capabilities.ts`: se completa en `specsFor` / `specFor`. */
  main?: boolean;
  /** Si está, el control solo existe cuando esto se cumple (patrón calado, ajuste del difusor...). */
  when?: (def: LampDefinition) => boolean;
}

const sw = (...types: LampShadeType[]) => (def: LampDefinition) => types.includes(def.shadeType);
const diamond = (def: LampDefinition) => def.shadeType === "openwork" && def.openwork.pattern === "diamond";
const spiral = (def: LampDefinition) => def.shadeType === "openwork" && def.openwork.pattern === "spiral";
const wavyInsert = (def: LampDefinition) => def.shadeType === "solid" && def.insert.enabled && diffuserKind(def.insert) === "wavy";
const dropInsert = (def: LampDefinition) => def.shadeType === "solid" && def.insert.enabled && def.insert.style === "drop";
const endsFree = (def: LampDefinition) => def.shadeType === "openwork" && def.openwork.diffuserFit !== "diameter";
const diameterDriven = (def: LampDefinition) => def.shadeType === "openwork" && def.openwork.diffuserFit === "diameter";

export const LAMP_CONTROL_SPECS: LampControlSpec[] = [
  // ---- Sólida
  { path: "shade.heightMm", label: "Altura", min: 80, max: 320, step: 5, unit: "mm" },
  { path: "shade.bottomDiameterMm", label: "Diámetro inferior", min: 100, max: 260, step: 5, unit: "mm", when: sw("solid") },
  { path: "shade.topDiameterMm", label: "Diámetro superior", min: 80, max: 280, step: 5, unit: "mm", when: sw("solid") },
  { path: "shade.amplitudeMm", label: "Amplitud", min: 0, max: 20, step: 0.5, unit: "mm", when: sw("solid") },
  { path: "shade.waves", label: "Cantidad de ondas", min: 2, max: 32, step: 1, unit: "", when: sw("solid") },
  { path: "shade.twistDeg", label: "Torsión", min: -720, max: 720, step: 5, unit: "°", when: sw("solid") },
  { path: "shade.verticalFrequency", label: "Variación vertical (ciclos)", min: 0, max: 6, step: 0.5, unit: "", when: sw("solid") },
  { path: "shade.patternIntensityPct", label: "Intensidad de la variación vertical", min: 0, max: 100, step: 5, unit: "%", when: sw("solid") },
  { path: "shade.organicPct", label: "Variación orgánica", min: 0, max: 100, step: 5, unit: "%", when: (d) => d.shadeType === "solid" && d.shade.family === "organic" },
  { path: "shade.profileAmountPct", label: "Intensidad del perfil", min: 0, max: 100, step: 5, unit: "%", when: (d) => d.shadeType === "solid" && d.shade.profile !== "straight" },
  // ---- Calada
  { path: "openwork.diffuserDiameterMm", label: "Ø exterior del difusor", min: 60, max: 200, step: 0.5, unit: "mm", when: diameterDriven },
  { path: "openwork.maxDiameterMm", label: "Diámetro máximo decorativo", min: 80, max: 300, step: 5, unit: "mm", when: sw("openwork") },
  { path: "shade.bottomDiameterMm", label: "Diámetro inferior (exterior del anillo)", min: 60, max: 260, step: 1, unit: "mm", when: endsFree },
  { path: "shade.topDiameterMm", label: "Diámetro superior (exterior del anillo)", min: 60, max: 280, step: 1, unit: "mm", when: endsFree },
  { path: "openwork.divisions", label: "Densidad (rombos alrededor)", min: 3, max: 48, step: 1, unit: "", when: diamond },
  { path: "openwork.bands", label: "Cantidad de bandas", min: 1, max: 24, step: 1, unit: "", when: spiral },
  { path: "openwork.waistPct", label: "Intensidad de cintura", min: 0, max: 100, step: 5, unit: "%", when: sw("openwork") },
  { path: "openwork.twistDeg", label: "Torsión", min: -720, max: 720, step: 5, unit: "°", when: sw("openwork") },
  { path: "openwork.inclinationDeg", label: "Inclinación de las diagonales", min: 20, max: 75, step: 1, unit: "°", when: diamond },
  { path: "openwork.turns", label: "Vueltas", min: -8, max: 8, step: 0.05, unit: "", when: spiral },
  { path: "openwork.stripWidthMm", label: "Grosor (ancho de las tiras)", min: 1, max: 14, step: 0.2, unit: "mm", when: sw("openwork") },
  { path: "openwork.depthMm", label: "Profundidad de las tiras", min: 1, max: 6, step: 0.1, unit: "mm", when: sw("openwork") },
  { path: "openwork.bulgePositionPct", label: "Posición del ensanchamiento / cintura", min: 10, max: 90, step: 5, unit: "%", when: sw("openwork") },
  { path: "openwork.curvaturePct", label: "Curvatura", min: 0, max: 100, step: 5, unit: "%", when: sw("openwork") },
  { path: "openwork.organicPct", label: "Variación orgánica", min: 0, max: 100, step: 5, unit: "%", when: sw("openwork") },
  { path: "openwork.variationPct", label: "Variación de inclinación", min: 0, max: 70, step: 5, unit: "%", when: sw("openwork") },
  { path: "openwork.variationCycles", label: "Ciclos de la variación", min: 0, max: 6, step: 0.5, unit: "", when: sw("openwork") },
  { path: "openwork.diffuserClearanceMm", label: "Holgura diametral del difusor", min: 0.7, max: 10, step: 0.1, unit: "mm", when: sw("openwork") },
  { path: "openwork.diffuserTopGapMm", label: "Holgura vertical del difusor", min: 4, max: 60, step: 1, unit: "mm", when: (d) => diameterDriven(d) && d.insert.heightMm === null },
  // ---- Doble pared
  { path: "doubleWall.maxDiameterMm", label: "Diámetro máximo (abombado)", min: 100, max: 340, step: 5, unit: "mm", when: sw("double") },
  { path: "shade.bottomDiameterMm", label: "Diámetro inferior", min: 100, max: 300, step: 1, unit: "mm", when: sw("double") },
  { path: "shade.topDiameterMm", label: "Diámetro superior", min: 100, max: 300, step: 1, unit: "mm", when: sw("double") },
  { path: "doubleWall.fluteAmplitudeMm", label: "Profundidad de las estrías", min: 0, max: 12, step: 0.5, unit: "mm", when: sw("double") },
  { path: "doubleWall.flutes", label: "Estrías / ondulaciones (cantidad)", min: 3, max: 48, step: 1, unit: "", when: sw("double") },
  { path: "doubleWall.twistDeg", label: "Torsión", min: -720, max: 720, step: 5, unit: "°", when: sw("double") },
  { path: "doubleWall.innerBottomDiameterMm", label: "Diámetro inferior de la pared interior", min: 40, max: 300, step: 1, unit: "mm", when: sw("double") },
  { path: "doubleWall.innerTopDiameterMm", label: "Diámetro superior de la pared interior", min: 40, max: 300, step: 1, unit: "mm", when: sw("double") },
  { path: "doubleWall.innerWaistPct", label: "Intensidad de cintura", min: 0, max: 100, step: 5, unit: "%", when: sw("double") },
  { path: "doubleWall.minGapMm", label: "Separación mínima entre paredes", min: 5, max: 60, step: 1, unit: "mm", when: sw("double") },
  { path: "doubleWall.bulgePositionPct", label: "Posición del ensanchamiento", min: 10, max: 90, step: 5, unit: "%", when: sw("double") },
  { path: "doubleWall.curvaturePct", label: "Curvatura de la pared exterior", min: 0, max: 100, step: 5, unit: "%", when: sw("double") },
  { path: "doubleWall.innerWaistPositionPct", label: "Posición de la cintura interior", min: 10, max: 90, step: 5, unit: "%", when: sw("double") },
  { path: "doubleWall.innerCurvaturePct", label: "Curvatura de la pared interior", min: 0, max: 100, step: 5, unit: "%", when: sw("double") },
  { path: "doubleWall.innerOrganicPct", label: "Variación orgánica interior", min: 0, max: 100, step: 5, unit: "%", when: sw("double") },
  // ---- Comunes
  { path: "thread.majorDiameterMm", label: "Diámetro de montaje (rosca)", min: 80, max: 200, step: 1, unit: "mm" },
  { path: "insert.heightMm", label: "Altura del difusor", min: 30, max: 400, step: 1, unit: "mm", when: (d) => d.insert.enabled && d.insert.heightMm !== null },
  // ---- Difusor de la pantalla sólida (el de la calada y el de la doble pared es siempre un cilindro recto: no tiene estos controles)
  { path: "insert.amplitudeMm", label: "Amplitud del difusor", min: 0, max: 12, step: 0.5, unit: "mm", when: wavyInsert },
  { path: "insert.waves", label: "Ondas del difusor", min: 2, max: 32, step: 1, unit: "", when: wavyInsert },
  { path: "insert.twistDeg", label: "Torsión del difusor", min: -720, max: 720, step: 5, unit: "°", when: wavyInsert },
  { path: "insert.verticalFrequency", label: "Frecuencia vertical del difusor", min: 0, max: 6, step: 0.5, unit: "", when: wavyInsert },
  { path: "insert.dropClosureMm", label: "Altura del cierre", min: 10, max: 120, step: 1, unit: "mm", when: dropInsert },
  { path: "insert.dropCurvaturePct", label: "Curvatura del cierre", min: 0, max: 100, step: 5, unit: "%", when: dropInsert },
  { path: "insert.dropTipRadiusMm", label: "Redondeo de la punta", min: 1.5, max: 30, step: 0.5, unit: "mm", when: dropInsert },
];

/** Los controles de la pantalla (`shade.`, `openwork.`, `doubleWall.`) solo existen si la familia activa los declara en `capabilities.ts`; los comunes (rosca, difusor) siempre. */
const FAMILY_SCOPED = /^(shade|openwork|doubleWall)./;
const belongs = (def: LampDefinition, s: LampControlSpec) => (!s.when || s.when(def)) && (!FAMILY_SCOPED.test(s.path) || familyHasControl(def.shadeType, s.path));
const withMain = (def: LampDefinition, s: LampControlSpec): LampControlSpec => ({ ...s, main: isMainControl(def.shadeType, s.path) });

/** Controles de la pantalla activa, los principales primero (se calculan primero). Qué es principal y qué es avanzado lo define la familia (`capabilities.ts`). */
export function specsFor(def: LampDefinition): LampControlSpec[] {
  const list = LAMP_CONTROL_SPECS.filter((s) => belongs(def, s)).map((s) => withMain(def, s));
  return [...list.filter((s) => s.main), ...list.filter((s) => !s.main)];
}

export function specFor(def: LampDefinition, path: string): LampControlSpec | undefined {
  const spec = LAMP_CONTROL_SPECS.find((s) => s.path === path && belongs(def, s));
  return spec && withMain(def, spec);
}

export interface ControlRange {
  path: string;
  /** Límites efectivos (dentro de la grilla del control). */
  min: number;
  max: number;
  /** Envolvente estática de la que salen. */
  hardMin: number;
  hardMax: number;
  step: number;
  /** El borde es más estricto que la envolvente, y por qué (razón breve + código). */
  limitedMin: boolean;
  limitedMax: boolean;
  minReason: string | null;
  maxReason: string | null;
  /** Ningún valor del control evita todos los errores: lo causa otro control (el rango es la envolvente completa). */
  conflict: boolean;
  /** El valor actual está dentro del rango efectivo. */
  currentValid: boolean;
  /** Códigos de error que este control no puede evitar (los causa otra parte del diseño). */
  persistentCodes: string[];
}

function getPath(def: LampDefinition, path: string): number {
  const [a, b] = path.split(".");
  return (def as unknown as Record<string, Record<string, number>>)[a][b];
}

export function setLampPath(def: LampDefinition, path: string, value: number): LampDefinition {
  const [a, b] = path.split(".");
  return { ...def, [a]: { ...(def as unknown as Record<string, object>)[a], [b]: value } } as LampDefinition;
}

/** Razones breves por código de error: lo que el usuario necesita saber de por qué un borde está donde está. */
const SHORT: Record<string, string> = {
  OPENWORK_STRIP_TOO_FLAT: "las tiras quedarían casi horizontales (no imprimibles)",
  OPENWORK_OPENING_CLOSED: "las aberturas entre tiras se cerrarían",
  OPENWORK_RINGS_TOO_TALL: "los anillos dejarían muy poca zona calada",
  OPENWORK_TOO_HEAVY: "la malla sería demasiado pesada",
  OPENWORK_STRIP_TOO_THIN: "las tiras serían demasiado finas",
  OPENWORK_DEPTH_TOO_THIN: "la profundidad no alcanza para imprimir",
  DIFFUSER_STRUCTURE_INTRUDES: "la estructura invadiría el volumen del difusor",
  DIFFUSER_PATH_BLOCKED: "el difusor no podría introducirse ni retirarse",
  DIFFUSER_CANNOT_PASS_TOP: "el difusor no pasaría por el anillo superior",
  DIFFUSER_EXCEEDS_BASE: "la base no alojaría el difusor (subí la rosca)",
  DIFFUSER_FIT_UNSOLVED: "la abertura de los anillos no se puede ajustar al difusor",
  INSERT_TOUCHES_SHADE: "el difusor tocaría la pantalla",
  INSERT_DOES_NOT_FIT: "el difusor no entraría",
  INSERT_TOO_CLOSE_TO_RINGS: "el difusor chocaría con los anillos del portalámparas",
  INSERT_TOO_CLOSE_TO_BULB: "el difusor quedaría a menos de la separación mínima a la bombilla",
  INSERT_TOO_SHORT: "el difusor quedaría muy bajo",
  INSERT_TOO_TALL: "el difusor llegaría al borde de la pantalla",
  TOWER_INNER_WALL_THIN: "la pared de la torre de la base quedaría muy delgada",
  TOWER_TOO_WIDE_FOR_THREAD: "la torre no entraría en el cuello roscado",
  SHADE_RIDGE_TOO_SHARP: "las crestas se plegarían sobre sí mismas",
  SHADE_TOO_STEEP: "la pared se inclinaría demasiado",
  SHADE_DEGENERATE: "la pantalla se volvería degenerada",
  SHADE_NARROWER_THAN_THREAD: "no queda lugar para la transición de 45° con la rosca",
  COLLAR_TOO_TALL: "el tramo recto superaría la mitad de la altura",
  DW_GAP: "las paredes quedarían demasiado cerca",
  DW_LEAN: "una cara se inclinaría demasiado",
  DW_FLUTE_SHARP: "las crestas de las estrías se plegarían",
  DW_FLUTE_DEPTH: "las estrías serían excesivas",
  DW_OPENING_TOO_SMALL: "la abertura central no dejaría pasar la bombilla",
  DW_TOO_HEAVY: "la malla sería demasiado pesada",
  DW_NECK_TOO_SHORT: "el cono interior no cabría en el cuello",
  DW_ZONES: "la altura no alcanza para piso, cámara y techo",
  ADHESION_INTERFERES: "el reborde de adhesión interferiría",
  THREAD_ENGAGEMENT_SHORT: "la rosca sería inestable",
  OUT_OF_RANGE: "fuera de la envolvente del control",
};

export function shortReason(issue: LampIssue): string {
  return SHORT[issue.code] ?? issue.message.split(/(?<=[.:])\s/)[0].slice(0, 120);
}

/** Opciones de cálculo. `fast`: muestreo grueso en la doble pared (se confirma con la validación completa en los bordes). */
export interface RangeOptions {
  samples?: number;
}

interface Probe {
  codes: Set<string>;
  issues: LampIssue[];
}

/** Valida la definición con un campo cambiado. `fast` solo cambia el muestreo de la doble pared; los bordes se confirman sin él. */
function probe(def: LampDefinition, path: string, value: number, fast: boolean): Probe {
  const issues = validateLamp(setLampPath(def, path, value), undefined, { fast }).errors;
  return { codes: new Set(issues.map((e) => e.code)), issues };
}

const clean = (v: number) => Math.round(v * 1e6) / 1e6;

export function computeControlRange(def: LampDefinition, spec: LampControlSpec, opts: RangeOptions = {}): ControlRange {
  const { min: lo, max: hi, step } = spec;
  const fast = def.shadeType === "double";
  const n = Math.round((hi - lo) / step);
  const at = (i: number) => clean(lo + i * step);
  const cur = getPath(def, spec.path);
  const nSamples = Math.min(n + 1, opts.samples ?? (fast ? 13 : 25));

  const idx = new Set<number>();
  for (let k = 0; k < nSamples; k++) idx.add(nSamples === n + 1 ? k : Math.round((k * n) / (nSamples - 1)));
  const curIdx = Number.isFinite(cur) ? Math.min(n, Math.max(0, Math.round((cur - lo) / step))) : 0;
  idx.add(curIdx);
  const order = [...idx].sort((a, b) => a - b);

  const results = new Map<number, Probe>();
  const run = (i: number): Probe => {
    let r = results.get(i);
    if (!r) {
      r = probe(def, spec.path, at(i), fast);
      results.set(i, r);
    }
    return r;
  };
  for (const i of order) run(i);

  // errores que ningún valor del control evita: los causa otra parte del diseño
  let P: Set<string> | undefined;
  for (const i of order) {
    const codes = results.get(i)!.codes;
    const prev: Set<string> | undefined = P;
    P = prev === undefined ? new Set(codes) : new Set([...prev].filter((c) => codes.has(c)));
  }
  P = P ?? new Set<string>();
  const persistentCodes = P;
  const ok = (i: number, r: Probe = results.get(i)!) => [...r.codes].every((c) => persistentCodes.has(c));
  const firstBlocking = (r: Probe) => r.issues.find((e) => !persistentCodes.has(e.code)) ?? r.issues[0];

  const anyOk = order.some((i) => ok(i));
  const base: ControlRange = {
    path: spec.path,
    min: lo,
    max: hi,
    hardMin: lo,
    hardMax: hi,
    step,
    limitedMin: false,
    limitedMax: false,
    minReason: null,
    maxReason: null,
    conflict: false,
    currentValid: true,
    persistentCodes: [...persistentCodes],
  };
  if (!anyOk) return { ...base, conflict: true, currentValid: false };

  // tramo válido contiguo: el que contiene al valor actual, o el más cercano
  const runs: number[][] = [];
  let currentRun: number[] = [];
  for (const i of order) {
    if (ok(i)) currentRun.push(i);
    else if (currentRun.length) {
      runs.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length) runs.push(currentRun);
  const dist = (r: number[]) => (curIdx >= r[0] && curIdx <= r[r.length - 1] ? 0 : Math.min(Math.abs(curIdx - r[0]), Math.abs(curIdx - r[r.length - 1])));
  const chosen = runs.reduce((best, r) => (dist(r) < dist(best) ? r : best), runs[0]);
  const firstI = chosen[0], lastI = chosen[chosen.length - 1];

  // bordes: bisección sobre la grilla entre la última muestra inválida y la primera válida
  const edge = (validI: number, invalidI: number): number => {
    let good = validI, bad = invalidI;
    while (Math.abs(bad - good) > 1) {
      const mid = Math.floor((good + bad) / 2);
      if (ok(mid, run(mid))) good = mid;
      else bad = mid;
    }
    return good;
  };
  const below = order.filter((i) => i < firstI).pop();
  const above = order.find((i) => i > lastI);
  let minI = below === undefined ? 0 : edge(firstI, below);
  let maxI = above === undefined ? n : edge(lastI, above);

  // El muestreo grueso solo es aproximado en la separación entre paredes y en las inclinaciones: si un borde lo fija una de esas reglas, la
  // validación fina (la que bloquea la exportación) manda y se retrocede hasta que el borde sea válido de verdad.
  if (fast) {
    const approx = new Set(["DW_GAP", "DW_LEAN", "SHADE_TOO_STEEP"]);
    const blockedByApprox = (i: number) => i >= 0 && i <= n && run(i).issues.some((e) => !persistentCodes.has(e.code) && approx.has(e.code));
    const confirm = (i: number) => ok(i, probe(def, spec.path, at(i), false));
    if (blockedByApprox(minI - 1)) while (minI < Math.min(maxI, curIdx) && !confirm(minI)) minI++;
    if (blockedByApprox(maxI + 1)) while (maxI > Math.max(minI, curIdx) && !confirm(maxI)) maxI--;
  }

  const reasonAt = (i: number) => {
    let issue = firstBlocking(run(i));
    // el muestreo grueso pudo no ver el motivo (la validación fina lo rechazó): se consulta la fina
    if (!issue || ok(i)) issue = firstBlocking(probe(def, spec.path, at(i), false));
    return issue ? shortReason(issue) : null;
  };
  const limitedMin = minI > 0;
  const limitedMax = maxI < n;
  // el valor actual tal cual está (no el de la grilla): ¿lo evita todo lo que este control puede evitar y cae dentro del rango?
  const curExact = Number.isFinite(cur) ? probe(def, spec.path, cur, fast) : null;
  const currentValid = !!curExact && ok(curIdx, curExact) && cur >= at(minI) - 1e-9 && cur <= at(maxI) + 1e-9;
  return {
    ...base,
    min: at(minI),
    max: at(maxI),
    limitedMin,
    limitedMax,
    minReason: limitedMin ? reasonAt(minI - 1) : null,
    maxReason: limitedMax ? reasonAt(maxI + 1) : null,
    currentValid,
  };
}

/** Rangos de todos los controles (o de `paths`) de la pantalla activa. Síncrono: la interfaz usa el hook que los calcula por tandas. */
export function computeLampRanges(def: LampDefinition, paths?: string[], opts: RangeOptions = {}): Record<string, ControlRange> {
  const out: Record<string, ControlRange> = {};
  for (const spec of specsFor(def)) {
    if (paths && !paths.includes(spec.path)) continue;
    out[spec.path] = computeControlRange(def, spec, opts);
  }
  return out;
}

/** Valor del rango más cercano a `v` (acción explícita del usuario: «llevar al valor válido más cercano»). */
export function nearestInRange(range: ControlRange, v: number): number {
  return clean(Math.min(range.max, Math.max(range.min, v)));
}

/** Clave de cache de un rango: toda la definición geométrica MENOS el campo del control (su rango no depende de su propio valor). */
export function rangeCacheKey(def: LampDefinition, path: string): string {
  const cleared = setLampPath(def, path, 0);
  return path + "|" + JSON.stringify({ ...cleared, insert: { ...cleared.insert, previewColor: "" } });
}

/** Comprueba que cada envolvente de la interfaz está dentro de `LAMP_LIMITS` (lo usa un test). */
export function specsOutsideLimits(): string[] {
  const bad: string[] = [];
  for (const s of LAMP_CONTROL_SPECS) {
    const lim = (LAMP_LIMITS as Record<string, { min: number; max: number }>)[s.path as LampLimitKey];
    if (lim && (s.min < lim.min - 1e-9 || s.max > lim.max + 1e-9)) bad.push(s.path);
  }
  return bad;
}
