import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Límite por usuario de generaciones del Mug Designer. Reusa `stampy_usage_logs` (infra existente, sin migration): cada
 * llamada al proveedor deja una fila con `model = "mug-designer:<modelo>"`, que es lo que se cuenta aquí.
 * Nota: como el limitador de Stampy cuenta TODAS las filas del usuario, las generaciones de jarros también consumen
 * su cupo (los límites de acá son más bajos que los de Stampy para que no lo agoten).
 */
export const MUG_AI_MODEL_TAG = "mug-designer";

export async function checkMugAiRateLimit(supabase: SupabaseClient, userId: string): Promise<{ blocked: boolean }> {
  const perHour = Number(process.env.MUG_AI_MAX_PER_HOUR) || 15;
  const perDay = Number(process.env.MUG_AI_MAX_PER_DAY) || 60;
  const now = Date.now();
  const windows: [number, number][] = [
    [60 * 60 * 1000, perHour],
    [24 * 60 * 60 * 1000, perDay],
  ];
  try {
    for (const [ms, limit] of windows) {
      const { count, error } = await supabase
        .from("stampy_usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .like("model", `${MUG_AI_MODEL_TAG}:%`)
        .neq("status", "blocked")
        .gte("created_at", new Date(now - ms).toISOString());
      if (error) console.error("[MugAI] rate limit check failed", error);
      else if (count !== null && count >= limit) return { blocked: true };
    }
  } catch (error) {
    console.error("[MugAI] rate limit exception", error);
  }
  return { blocked: false };
}
