import { sampleShadeField, shadeKey, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import type { LampShadeDef } from "@/lib/maker/lamps/types";

/** Cache LRU chico: mover un slider del inserto o de la base no vuelve a muestrear la pantalla. */
const MAX_ENTRIES = 8;
const fields = new Map<string, ShadeField>();

export function getShadeField(shade: LampShadeDef): ShadeField {
  const key = shadeKey(shade);
  const hit = fields.get(key);
  if (hit) {
    fields.delete(key);
    fields.set(key, hit);
    return hit;
  }
  const field = sampleShadeField(shade);
  fields.set(key, field);
  if (fields.size > MAX_ENTRIES) fields.delete(fields.keys().next().value as string);
  return field;
}
