import { doubleWallKey, sampleDoubleWallField } from "@/lib/maker/lamps/doublewall/field";
import { openworkKey, sampleOpenworkField } from "@/lib/maker/lamps/openwork/field";
import { sampleShadeField, shadeKey, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import type { LampDefinition, LampShadeDef } from "@/lib/maker/lamps/types";

/** Cache LRU chico: mover un slider del inserto o de la base no vuelve a muestrear la pantalla. */
const MAX_ENTRIES = 8;
const fields = new Map<string, ShadeField>();

function remember(key: string, build: () => ShadeField): ShadeField {
  const hit = fields.get(key);
  if (hit) {
    fields.delete(key);
    fields.set(key, hit);
    return hit;
  }
  const field = build();
  fields.set(key, field);
  if (fields.size > MAX_ENTRIES) fields.delete(fields.keys().next().value as string);
  return field;
}

export function getShadeField(shade: LampShadeDef): ShadeField {
  return remember(`solid|${shadeKey(shade)}`, () => sampleShadeField(shade));
}

/** Campo de la pantalla activa de la definición (sólida u calada). Solo depende de lo que cambia la superficie. */
export function getLampField(def: LampDefinition): ShadeField {
  if (def.shadeType === "double") return remember(`double|${doubleWallKey(def)}`, () => sampleDoubleWallField(def));
  if (def.shadeType === "openwork") return remember(`openwork|${openworkKey(def.shade, def.openwork)}`, () => sampleOpenworkField(def.shade, def.openwork));
  return getShadeField(def.shade);
}
