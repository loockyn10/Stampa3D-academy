import "server-only";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

const noStore = { "Cache-Control": "no-store" };

/**
 * Admin-only API routes that need the service role: the session user must be an admin (profiles.role, read with the
 * user's own session) before a service-role client is created. Returns either the client or the response to send.
 */
export async function requireAdminServiceClient(): Promise<{ admin: SupabaseClient; response?: undefined } | { admin?: undefined; response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "admin") return { response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { response: NextResponse.json({ error: "Configuración de Supabase incompleta" }, { status: 500, headers: noStore }) };
  return { admin: createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) };
}
