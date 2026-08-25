import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateAccessPolicy,
  PLATFORM_GRANT_TYPES,
  type AccessGrantFact,
  type AccessPolicyEvaluation,
} from "./access-policy";

interface ProfileAccessRow {
  role: string | null;
  membership_status: string | null;
  membership_expires_at: string | null;
  onboarding_completed: boolean | null;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  member_level: string | null;
}

interface GrantAccessRow {
  grant_type: string | null;
  status: string | null;
  expires_at: string | null;
}

export interface UserAccessIdentity {
  email: string | null;
  fullName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  memberLevel: string | null;
}

export interface UserAccessSnapshot extends AccessPolicyEvaluation {
  authenticated: boolean;
  userId: string | null;
  role: string | null;
  membershipStatus: string | null;
  membershipExpiresAt: string | null;
  onboardingCompleted: boolean;
  grants: AccessGrantFact[];
  identity: UserAccessIdentity;
}

export interface UserAccessResolution {
  access: UserAccessSnapshot;
  error: string | null;
}

interface ResolveUserAccessOptions {
  email?: string | null;
  now?: Date;
}

const EMPTY_IDENTITY: UserAccessIdentity = {
  email: null,
  fullName: null,
  displayName: null,
  avatarUrl: null,
  memberLevel: null,
};

function buildAccessSnapshot({
  authenticated,
  userId,
  role,
  membershipStatus,
  membershipExpiresAt,
  onboardingCompleted,
  grants,
  identity,
  now,
}: {
  authenticated: boolean;
  userId: string | null;
  role: string | null;
  membershipStatus: string | null;
  membershipExpiresAt: string | null;
  onboardingCompleted: boolean;
  grants: AccessGrantFact[];
  identity: UserAccessIdentity;
  now?: Date;
}): UserAccessSnapshot {
  const evaluation = evaluateAccessPolicy(
    {
      authenticated,
      role,
      membershipStatus,
      membershipExpiresAt,
      onboardingCompleted,
      grants,
    },
    now,
  );

  return {
    authenticated,
    userId,
    role,
    membershipStatus,
    membershipExpiresAt,
    onboardingCompleted,
    grants,
    identity,
    ...evaluation,
  };
}

export function createAnonymousUserAccess(now?: Date): UserAccessSnapshot {
  return buildAccessSnapshot({
    authenticated: false,
    userId: null,
    role: null,
    membershipStatus: null,
    membershipExpiresAt: null,
    onboardingCompleted: false,
    grants: [],
    identity: EMPTY_IDENTITY,
    now,
  });
}

function createDeniedUserAccess({
  userId,
  email,
  profile,
  now,
}: {
  userId: string;
  email: string | null;
  profile?: ProfileAccessRow | null;
  now?: Date;
}): UserAccessSnapshot {
  return buildAccessSnapshot({
    authenticated: true,
    userId,
    role: null,
    membershipStatus: null,
    membershipExpiresAt: null,
    onboardingCompleted: profile?.onboarding_completed === true,
    grants: [],
    identity: {
      email,
      fullName: profile?.full_name ?? null,
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      memberLevel: profile?.member_level ?? null,
    },
    now,
  });
}

export async function resolveUserAccess(
  supabase: SupabaseClient,
  userId: string,
  options: ResolveUserAccessOptions = {},
): Promise<UserAccessResolution> {
  try {
    const [profileResult, grantsResult] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "role, membership_status, membership_expires_at, onboarding_completed, full_name, display_name, avatar_url, member_level",
        )
        .eq("id", userId)
        .single(),
      supabase
        .from("user_access_grants")
        .select("grant_type, status, expires_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .in("grant_type", [...PLATFORM_GRANT_TYPES]),
    ]);

    const profile = profileResult.data as ProfileAccessRow | null;

    if (profileResult.error || !profile) {
      return {
        access: createDeniedUserAccess({
          userId,
          email: options.email ?? null,
          now: options.now,
        }),
        error: profileResult.error?.message ?? "Perfil no encontrado",
      };
    }

    if (grantsResult.error) {
      return {
        access: createDeniedUserAccess({
          userId,
          email: options.email ?? null,
          profile,
          now: options.now,
        }),
        error: grantsResult.error.message,
      };
    }

    const grantRows = (grantsResult.data ?? []) as GrantAccessRow[];
    const grants: AccessGrantFact[] = grantRows.map((grant) => ({
      grantType: grant.grant_type,
      status: grant.status,
      expiresAt: grant.expires_at,
    }));

    return {
      access: buildAccessSnapshot({
        authenticated: true,
        userId,
        role: profile.role,
        membershipStatus: profile.membership_status,
        membershipExpiresAt: profile.membership_expires_at,
        onboardingCompleted: profile.onboarding_completed === true,
        grants,
        identity: {
          email: options.email ?? null,
          fullName: profile.full_name,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
          memberLevel: profile.member_level,
        },
        now: options.now,
      }),
      error: null,
    };
  } catch (error: unknown) {
    return {
      access: createDeniedUserAccess({
        userId,
        email: options.email ?? null,
        now: options.now,
      }),
      error: error instanceof Error ? error.message : "Error al resolver el acceso",
    };
  }
}

export async function getCurrentUserAccess(
  supabase: SupabaseClient,
  now?: Date,
): Promise<UserAccessResolution> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      return {
        access: createAnonymousUserAccess(now),
        error: error.message,
      };
    }

    if (!user) {
      return {
        access: createAnonymousUserAccess(now),
        error: null,
      };
    }

    return resolveUserAccess(supabase, user.id, {
      email: user.email ?? null,
      now,
    });
  } catch (error: unknown) {
    return {
      access: createAnonymousUserAccess(now),
      error: error instanceof Error ? error.message : "Error de autenticación",
    };
  }
}
