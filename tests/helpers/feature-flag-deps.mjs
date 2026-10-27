import { execSync } from "node:child_process";

/**
 * Dependencias neutras para los arneses de tests que cargan Server Actions / API routes con `require` simulado:
 * las feature flags no restringen nada (equivale a "todas las herramientas habilitadas").
 */
export const openStampyFeatureGate = {
  isFeatureAvailable: () => true,
  isRouteAvailable: () => true,
  filterByRoute: (items) => [...items],
  buildPromptNotice: () => null,
};

export function stampyFeatureGateDeps() {
  return {
    "@/lib/stampy/feature-gate": {
      loadStampyFeatureGate: async () => openStampyFeatureGate,
      STAMPY_FEATURE_UNAVAILABLE_ANSWER: "Esta herramienta todavía no está disponible.",
    },
  };
}

export function featureServerDeps() {
  return {
    "@/lib/features/server": {
      FEATURE_UNAVAILABLE_ERROR_CODE: "feature_unavailable",
      FEATURE_UNAVAILABLE_MESSAGE: "Esta herramienta todavía no está disponible.",
      isFeatureAvailable: async () => true,
      featureGuardResponse: async () => null,
    },
  };
}

/**
 * Cambios sin confirmar en `paths` que NO sean el guard de feature flags (import + llamada). Sirve para los tests
 * "endpoint intacto": el único cambio permitido sobre esos archivos es la comprobación de la funcionalidad.
 */
export function nonFeatureGuardDiff(cwd, paths) {
  const output = execSync(`git diff -U0 HEAD -- ${paths.join(" ")}`, { cwd }).toString();
  return output
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    .filter((line) => line.slice(1).trim() !== "")
    .filter((line) => !/featureGuardResponse|features\/server|featureBlocked/.test(line));
}
