import type { ModelSearchProvider } from "./types";
import { createMyMiniFactoryProvider } from "./providers/myminifactory";
import { createThingiverseProvider } from "./providers/thingiverse";

/**
 * Registry de providers. Sumar una fuente = crear su archivo en `providers/`, agregar su id en `sources.ts` y
 * registrarla acá. Solo se registran fuentes con integración oficial (MakerWorld / Printables / Cults3D / Thangs:
 * no implementadas).
 */
export function createDefaultProviders(): ModelSearchProvider[] {
  return [createMyMiniFactoryProvider(), createThingiverseProvider()];
}
