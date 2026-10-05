export interface AccessDestinationInput {
  authenticated: boolean;
  capabilities: { accessPlatform: boolean };
  needsOnboarding: boolean;
}

/**
 * Where a user waiting on /sin-acceso should go once the canonical access policy
 * (admin OR paid membership OR active platform grant) lets them in.
 * Returns null while they must stay on /sin-acceso.
 */
export function resolvePostAccessDestination(access: AccessDestinationInput): string | null {
  if (!access.authenticated || !access.capabilities.accessPlatform) return null;
  return access.needsOnboarding ? "/onboarding" : "/";
}
