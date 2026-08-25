export const PLATFORM_GRANT_TYPES = [
  "beta_tester",
  "manual_free_access",
  "internal_tester",
] as const;

export type PlatformGrantType = (typeof PLATFORM_GRANT_TYPES)[number];

export type AccessSource = "admin" | "membership" | PlatformGrantType;

export interface AccessGrantFact {
  grantType: string | null;
  status: string | null;
  expiresAt: string | null;
}

export interface AccessPolicyInput {
  authenticated: boolean;
  role: string | null;
  membershipStatus: string | null;
  membershipExpiresAt: string | null;
  onboardingCompleted: boolean;
  grants: AccessGrantFact[];
}

export interface UserCapabilities {
  accessPlatform: boolean;
  accessAdmin: boolean;
  useStampy: boolean;
  downloadStl: boolean;
  viewInactiveContent: boolean;
}

export interface AccessPolicyEvaluation {
  membershipValid: boolean;
  validGrantTypes: PlatformGrantType[];
  accessSources: AccessSource[];
  capabilities: UserCapabilities;
  needsOnboarding: boolean;
}

function isPlatformGrantType(value: string | null): value is PlatformGrantType {
  return PLATFORM_GRANT_TYPES.some((grantType) => grantType === value);
}

function isNotExpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return true;

  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export function evaluateAccessPolicy(
  input: AccessPolicyInput,
  now: Date = new Date(),
): AccessPolicyEvaluation {
  const nowMs = now.getTime();
  const membershipValid =
    input.authenticated &&
    input.membershipStatus === "active" &&
    isNotExpired(input.membershipExpiresAt, nowMs);

  const validGrantTypes = input.authenticated
    ? Array.from(
        new Set(
          input.grants
            .filter(
              (grant) =>
                grant.status === "active" &&
                isPlatformGrantType(grant.grantType) &&
                isNotExpired(grant.expiresAt, nowMs),
            )
            .map((grant) => grant.grantType as PlatformGrantType),
        ),
      )
    : [];

  const accessAdmin = input.authenticated && input.role === "admin";
  const accessPlatform =
    accessAdmin || membershipValid || validGrantTypes.length > 0;

  const accessSources: AccessSource[] = [];
  if (accessAdmin) accessSources.push("admin");
  if (membershipValid) accessSources.push("membership");
  accessSources.push(...validGrantTypes);

  return {
    membershipValid,
    validGrantTypes,
    accessSources,
    capabilities: {
      accessPlatform,
      accessAdmin,
      useStampy: accessPlatform,
      downloadStl: accessPlatform,
      viewInactiveContent: accessAdmin,
    },
    needsOnboarding:
      input.authenticated && accessPlatform && !input.onboardingCompleted,
  };
}
