import type * as ClipperLib from "clipper-lib";
import type { BackCutout, LetterGeometryResult, LetterSignParams } from "@/lib/maker/types";
import { insetContourGroups, unionRawPaths } from "@/lib/maker/geometry/offsets";
import { createDefaultBackCutout } from "@/lib/maker/geometry/backCutouts";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";
import { letterSafeRegion, standoffRadii, THROUGH_HOLE_EDGE_MARGIN_MM } from "@/lib/maker/installation/layout";
import type { InstallationOverrides, InstallationPlan, LetterInstallationOverride } from "@/lib/maker/installation/types";

/**
 * Edición del montaje con la arquitectura del editor visual de recortes traseros: los
 * puntos de montaje se muestran como "recortes" sintéticos (círculo del refuerzo o forma del
 * keyhole) que el MISMO MakerViewport sabe seleccionar/arrastrar. La única fuente de verdad
 * sigue siendo `installationOverrides` (mm relativos al centro del diseño).
 */

/** Ids del editor: `mount:` + id del punto (para no chocar con los de recortes manuales). */
export const MOUNT_EDITOR_PREFIX = "mount:";

export function mountEditorCutouts(plan: InstallationPlan | null, params: LetterSignParams): BackCutout[] {
  if (!plan) return [];
  const settings = getInstallationSettings(params);
  const out: BackCutout[] = [];
  for (const letter of plan.letters) {
    for (const m of letter.mounts) {
      const id = `${MOUNT_EDITOR_PREFIX}${m.id}`;
      if (m.kind === "keyhole") {
        const k = settings.mounting.keyhole;
        out.push({ ...createDefaultBackCutout("keyhole", id, m.x, m.y), type: "keyhole", headDiameterMm: k.headDiameterMm, neckWidthMm: k.neckWidthMm, neckLengthMm: k.neckLengthMm, tailDiameterMm: k.neckWidthMm, rotationDeg: 180 } as BackCutout);
      } else {
        out.push({ id, type: "circle", x: m.x, y: m.y, diameterMm: standoffRadii(settings.mounting.standoff).bossR * 2 });
      }
    }
  }
  return out;
}

/** Zona segura de los puntos de montaje: el núcleo de cada letra menos el margen de borde (la misma condición que aplica el plan). */
export function mountSafeZone(result: LetterGeometryResult, params: LetterSignParams): ClipperLib.Paths | null {
  const settings = getInstallationSettings(params);
  if (settings.mounting.type === "none" || result.letters.length === 0) return null;
  const margin = settings.mounting.type === "keyhole" ? Math.max(settings.mounting.keyhole.edgeMarginMm, THROUGH_HOLE_EDGE_MARGIN_MM) : Math.max(settings.mounting.standoff.edgeMarginMm, 0.6);
  const zones: ClipperLib.Paths = [];
  for (const l of result.letters) {
    const region = letterSafeRegion(l.instance, params);
    zones.push(...insetContourGroups(region, margin));
  }
  return unionRawPaths(zones);
}

/** Ids inválidos (según el plan ya calculado) en el espacio de ids del editor. */
export function invalidMountEditorIds(plan: InstallationPlan | null): Set<string> {
  const ids = new Set<string>();
  for (const l of plan?.letters ?? []) for (const m of l.mounts) if (!m.valid) ids.add(`${MOUNT_EDITOR_PREFIX}${m.id}`);
  return ids;
}

function withOverride(overrides: InstallationOverrides, letterId: string, patch: LetterInstallationOverride): InstallationOverrides {
  const next: LetterInstallationOverride = { ...overrides[letterId], ...patch };
  return { ...overrides, [letterId]: next };
}

/** Mueve UN punto de montaje: la letra pasa a posiciones manuales (las demás quedan donde estaban). */
export function moveMountPoint(overrides: InstallationOverrides, plan: InstallationPlan, editorId: string, x: number, y: number): InstallationOverrides {
  const mountId = editorId.startsWith(MOUNT_EDITOR_PREFIX) ? editorId.slice(MOUNT_EDITOR_PREFIX.length) : editorId;
  const letter = plan.letters.find((l) => l.mounts.some((m) => m.id === mountId));
  if (!letter) return overrides;
  const points = letter.mounts.map((m) => (m.id === mountId ? { x, y } : { x: m.x, y: m.y }));
  const current = overrides[letter.instanceId]?.mountPoints;
  if (current && current.length === points.length && current.every((p, i) => p.x === points[i].x && p.y === points[i].y)) return overrides;
  return withOverride(overrides, letter.instanceId, { mountPoints: points });
}

/** Vuelve al layout automático de una letra (o de todas): descarta posiciones manuales y cantidades. */
export function resetMountOverrides(overrides: InstallationOverrides, letterId?: string): InstallationOverrides {
  const next: InstallationOverrides = {};
  for (const [id, o] of Object.entries(overrides)) {
    if (letterId && id !== letterId) {
      next[id] = o;
      continue;
    }
    const { mountPoints: _p, mountCount: _c, ...rest } = o;
    void _p;
    void _c;
    if (Object.keys(rest).length > 0) next[id] = rest;
  }
  return next;
}

export function setLetterMountCount(overrides: InstallationOverrides, letterId: string, count: number | null): InstallationOverrides {
  if (count === null) {
    const { mountCount: _c, mountPoints: _p, ...rest } = overrides[letterId] ?? {};
    void _c;
    void _p;
    const next = { ...overrides };
    if (Object.keys(rest).length > 0) next[letterId] = rest;
    else delete next[letterId];
    return next;
  }
  // Cambiar la cantidad vuelve a repartir automáticamente (descarta posiciones manuales de esa letra).
  const { mountPoints: _p, ...rest } = overrides[letterId] ?? {};
  void _p;
  return { ...overrides, [letterId]: { ...rest, mountCount: Math.max(1, Math.min(12, Math.round(count))) } };
}

export function setLetterSplice(overrides: InstallationOverrides, letterId: string, enabled: boolean): InstallationOverrides {
  if (enabled) {
    const { spliceEnabled: _s, ...rest } = overrides[letterId] ?? {};
    void _s;
    const next = { ...overrides };
    if (Object.keys(rest).length > 0) next[letterId] = rest;
    else delete next[letterId];
    return next;
  }
  return withOverride(overrides, letterId, { spliceEnabled: false });
}
