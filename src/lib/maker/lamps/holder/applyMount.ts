import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import { MOUNT_LABELS } from "@/lib/maker/lamps/holder/mounts";
import { LAMP_LIMITS, type LampDefinition, type LampHolderMount } from "@/lib/maker/lamps/types";

/**
 * Elegir un sistema de fijación del portalámparas es una acción de la persona: devuelve una definición NUEVA y un aviso (o null) con lo único
 * que se ajusta además de `holder.mount`. Hoy es una sola cosa: el plato Ø78,82 del sistema «Rosca hembra B con patas» (patas V6.stl) deja
 * 3,0 mm libres hasta el orificio del cuello roscado, y el reborde de adhesión por defecto (3 mm + 1 mm de holgura de diseño) no cabe; se lo lleva
 * al máximo que cabe y se informa. Nada más se modifica en silencio.
 */
export function applyHolderMount(def: LampDefinition, mount: LampHolderMount): { def: LampDefinition; notice: string | null } {
  let next: LampDefinition = { ...def, holder: { ...def.holder, mount } };
  if (mount !== "threadV6" || !next.adhesion.enabled) return { def: next, notice: null };
  const available = validateLamp(next).layout?.adhesion.availableWidthMm;
  if (available === undefined || next.adhesion.widthMm <= available + 1e-9) return { def: next, notice: null };
  const width = Math.max(LAMP_LIMITS["adhesion.widthMm"].min, Math.floor(available * 10) / 10);
  next = { ...next, adhesion: { ...next.adhesion, widthMm: width } };
  return {
    def: next,
    notice: `${MOUNT_LABELS[mount]}: el plato deja ${String(available).replace(".", ",")} mm libres hasta el cuello roscado, así que el reborde de adhesión se redujo de ${String(def.adhesion.widthMm).replace(".", ",")} a ${String(width).replace(".", ",")} mm.`,
  };
}
