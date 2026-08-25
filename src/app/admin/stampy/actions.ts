"use server";

import { createClient } from "@/utils/supabase/server";
import { indexStampyKnowledge } from "@/lib/stampy/knowledge-indexer";

export async function runStampyIndexation() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "No autorizado." };
  }

  // Verificar admin role si aplica, por simplicidad asumimos que tiene acceso a admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "admin" && profile.role !== "superadmin")) {
     return { error: "No sos admin." };
  }

  try {
    const result = await indexStampyKnowledge(supabase);
    return { success: true, result };
  } catch (error: any) {
    return { error: error.message || "Error al indexar conocimiento." };
  }
}
