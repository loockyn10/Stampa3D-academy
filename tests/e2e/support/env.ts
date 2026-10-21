import path from "node:path";

/** Roles con sesión que la suite sabe usar. "anonymous" no tiene credenciales. */
export const ROLES = ["free", "beta", "paid", "admin", "betaExpired", "betaRevoked"] as const;
export type Role = (typeof ROLES)[number];
export type ActorRole = Role | "anonymous";

const ENV_PREFIX: Record<Role, string> = {
  free: "E2E_FREE",
  beta: "E2E_BETA",
  paid: "E2E_PAID",
  admin: "E2E_ADMIN",
  betaExpired: "E2E_BETA_EXPIRED",
  betaRevoked: "E2E_BETA_REVOKED",
};

export interface Credentials {
  email: string;
  password: string;
}

/** Lee credenciales del entorno. Nunca hay valores por defecto ni secretos en el repo. */
export function credentialsFor(role: Role): Credentials | null {
  const email = process.env[`${ENV_PREFIX[role]}_EMAIL`]?.trim();
  const password = process.env[`${ENV_PREFIX[role]}_PASSWORD`];
  return email && password ? { email, password } : null;
}

export function hasCredentials(role: Role): boolean {
  return credentialsFor(role) !== null;
}

export function missingCredentialsReason(role: Role): string {
  return `faltan ${ENV_PREFIX[role]}_EMAIL / ${ENV_PREFIX[role]}_PASSWORD`;
}

export const AUTH_DIR = path.join(process.cwd(), "tests", "e2e", ".auth");

export function storageStatePath(role: Role): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/**
 * Las pruebas que escriben datos (crear/editar/anular) exigen opt-in explícito.
 * Hoy el único Supabase conocido del proyecto es producción: NO activar contra él.
 */
export const MUTATIONS_ALLOWED = process.env.E2E_ALLOW_MUTATIONS === "1";
export const MUTATION_SKIP_REASON =
  "mutación omitida: definir E2E_ALLOW_MUTATIONS=1 SOLO contra un Supabase de test descartable (nunca producción)";

/** Prefijo para todo dato creado por la suite, para poder identificarlo y limpiarlo. */
export const DATA_PREFIX = process.env.E2E_DATA_PREFIX || "ZZ-E2E";

export function uniqueName(label: string): string {
  return `${DATA_PREFIX} ${label} ${Date.now().toString(36)}`;
}

/** Código Beta válido/ inválido, solo para entornos descartables. */
export const BETA_CODE_VALID = process.env.E2E_BETA_CODE_VALID?.trim() || null;
export const BETA_CODE_INVALID = process.env.E2E_BETA_CODE_INVALID?.trim() || "ZZ-E2E-NO-EXISTE-0000";

/** Etiqueta declarada del entorno: local | preview | staging | production. Solo informativa/para reportes. */
export const TARGET_ENV = process.env.E2E_TARGET_ENV || (process.env.E2E_BASE_URL ? "unknown-external" : "local-against-env-local");
