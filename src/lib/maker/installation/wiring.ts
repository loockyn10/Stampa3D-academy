import type {
  CableLength,
  CableLink,
  LetterInstance,
  LetterWiring,
  LetterWiringRole,
  TerminalId,
  WiringDirection,
  WiringModel,
} from "@/lib/maker/installation/types";

/**
 * Modelo de cableado: ENCADENADO FÍSICO, PARALELO ELÉCTRICO.
 *
 * El cable recorre las letras en orden (S -> T -> A1 -> ...), pero dentro de cada
 * letra el empalme une IN+ = LED+ = OUT+ y IN- = LED- = OUT-: todas las letras
 * cuelgan del mismo bus + y del mismo bus -. NUNCA hay una conexión LED -> LED
 * (serie). El modelo solo describe conexiones lógicas; no dimensiona nada eléctrico.
 *
 * El orden depende únicamente del índice y de la dirección: los ids no cambian al
 * invertirla, solo cambia el rol de cada letra.
 */

export function wiringOrder(instances: LetterInstance[], direction: WiringDirection): LetterInstance[] {
  const sorted = [...instances].sort((a, b) => a.index - b.index);
  return direction === "ltr" ? sorted : sorted.reverse();
}

export function buildWiringRoles(instances: LetterInstance[], direction: WiringDirection): Map<string, LetterWiringRole> {
  const ordered = wiringOrder(instances, direction);
  const inSide = direction === "ltr" ? "left" : "right";
  const outSide = direction === "ltr" ? "right" : "left";
  const roles = new Map<string, LetterWiringRole>();
  ordered.forEach((letter, order) => {
    const isFirst = order === 0;
    const isLast = order === ordered.length - 1;
    roles.set(letter.id, {
      instanceId: letter.id,
      label: letter.label,
      order,
      isFirst,
      isLast,
      hasPowerIn: isFirst,
      hasIn: !isFirst,
      hasOut: !isLast,
      inSide,
      outSide,
    });
  });
  return roles;
}

export function buildWiringModel(instances: LetterInstance[], direction: WiringDirection): WiringModel {
  const ordered = wiringOrder(instances, direction);
  const roles = buildWiringRoles(instances, direction);
  const letters: LetterWiring[] = ordered.map((letter) => {
    const role = roles.get(letter.id)!;
    const plus: TerminalId[] = ["LED+"];
    const minus: TerminalId[] = ["LED-"];
    // La entrada (o la alimentación de la primera) y la salida se empalman con el LED local de la misma polaridad.
    plus.unshift("IN+");
    minus.unshift("IN-");
    if (role.hasOut) {
      plus.push("OUT+");
      minus.push("OUT-");
    }
    return { instanceId: letter.id, label: letter.label, role, nets: [{ polarity: "+", terminals: plus }, { polarity: "-", terminals: minus }] };
  });
  const links: CableLink[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    links.push({
      fromId: ordered[i].id,
      toId: ordered[i + 1].id,
      fromLabel: ordered[i].label,
      toLabel: ordered[i + 1].label,
      joins: [["OUT+", "IN+"], ["OUT-", "IN-"]],
    });
  }
  return { topology: "parallel", direction, physicalOrder: ordered.map((l) => l.id), letters, links };
}

/**
 * Componentes eléctricos globales (unión-búsqueda sobre terminales por letra y
 * links de cable). Un cableado en paralelo produce EXACTAMENTE dos buses: el que
 * contiene todos los LED+ y el que contiene todos los LED-.
 */
export function computeElectricalBuses(model: WiringModel): { plus: string[]; minus: string[]; shorted: boolean } {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    if (!parent.has(a)) parent.set(a, a);
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(a, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const letter of model.letters) {
    for (const net of letter.nets) {
      const [first, ...rest] = net.terminals;
      for (const t of rest) union(`${letter.instanceId}.${first}`, `${letter.instanceId}.${t}`);
    }
  }
  for (const link of model.links) {
    for (const [out, inn] of link.joins) union(`${link.fromId}.${out}`, `${link.toId}.${inn}`);
  }
  const plusRoots = new Set(model.letters.map((l) => find(`${l.instanceId}.LED+`)));
  const minusRoots = new Set(model.letters.map((l) => find(`${l.instanceId}.LED-`)));
  const shorted = [...plusRoots].some((r) => minusRoots.has(r));
  return {
    plus: [...plusRoots],
    minus: [...minusRoots],
    // Serie/paralelo: en paralelo hay un solo bus por polaridad y nunca se mezclan.
    shorted,
  };
}

/** ¿Todas las letras cuelgan de UN bus + y UN bus - (paralelo real)? */
export function isParallelWiring(model: WiringModel): boolean {
  const buses = computeElectricalBuses(model);
  return buses.plus.length === 1 && buses.minus.length === 1 && !buses.shorted;
}

/**
 * Longitud aproximada de cada tramo (OUT de N -> IN de N+1): distancia recta entre
 * los puertos + margen de servicio. Métrica física de cable, no dimensionado
 * eléctrico. `portPositions` son coordenadas globales; sin puerto se usa el borde
 * de la caja de cada letra.
 */
export function computeCableLengths(
  instances: LetterInstance[],
  model: WiringModel,
  serviceMarginMm: number,
  portPositions: { out: Map<string, { x: number; y: number }>; in: Map<string, { x: number; y: number }> },
): CableLength[] {
  const byId = new Map(instances.map((l) => [l.id, l]));
  const toRight = model.direction === "ltr";
  return model.links.map((link) => {
    const from = byId.get(link.fromId)!;
    const to = byId.get(link.toId)!;
    const fromPos =
      portPositions.out.get(link.fromId) ??
      { x: toRight ? from.boundsMm.maxX : from.boundsMm.minX, y: (from.boundsMm.minY + from.boundsMm.maxY) / 2 };
    const toPos =
      portPositions.in.get(link.toId) ??
      { x: toRight ? to.boundsMm.minX : to.boundsMm.maxX, y: (to.boundsMm.minY + to.boundsMm.maxY) / 2 };
    const distanceMm = Math.hypot(fromPos.x - toPos.x, fromPos.y - toPos.y);
    return {
      fromId: link.fromId,
      toId: link.toId,
      fromLabel: link.fromLabel,
      toLabel: link.toLabel,
      distanceMm,
      lengthMm: distanceMm + serviceMarginMm,
    };
  });
}
