"use server";

import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { resolvePostAccessDestination } from "@/lib/auth/access-destination";
import { createClient } from "@/utils/supabase/server";

export interface RefreshAccessResult {
  hasAccess: boolean;
  destination: string | null;
}

/** Re-resolves access server-side (fresh query, session user only) for /sin-acceso. */
export async function refreshAccessAction(): Promise<RefreshAccessResult> {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  const destination = resolvePostAccessDestination(access);
  return { hasAccess: destination !== null, destination };
}
