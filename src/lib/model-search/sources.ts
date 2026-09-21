import type { ModelSourceId } from "./types";

/** Metadata de fuentes segura para el cliente (no importa providers ni credenciales). */
export const MODEL_SOURCE_IDS: readonly ModelSourceId[] = ["myminifactory", "thingiverse"];

export const MODEL_SOURCE_LABELS: Record<ModelSourceId, string> = {
  myminifactory: "MyMiniFactory",
  thingiverse: "Thingiverse",
};

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

export function isModelSourceId(value: string): value is ModelSourceId {
  return (MODEL_SOURCE_IDS as readonly string[]).includes(value);
}
