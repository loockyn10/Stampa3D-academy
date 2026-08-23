import { SupabaseClient } from "@supabase/supabase-js";

interface RateLimitParams {
  supabase: SupabaseClient;
  userId: string;
}

export async function checkStampyRateLimit({ supabase, userId }: RateLimitParams): Promise<{ isBlocked: boolean; reason?: string }> {
  const STAMPY_MAX_MESSAGES_PER_HOUR = Number(process.env.STAMPY_MAX_MESSAGES_PER_HOUR) || 40;
  const STAMPY_MAX_MESSAGES_PER_DAY = Number(process.env.STAMPY_MAX_MESSAGES_PER_DAY) || 150;

  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  try {
    // Check hourly limit
    const { count: hourlyCount, error: hourlyError } = await supabase
      .from("stampy_usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("status", "blocked")
      .gte("created_at", oneHourAgo);

    if (hourlyError) {
      console.error("[Stampy] rate limit hourly check failed", hourlyError);
    } else if (hourlyCount !== null && hourlyCount >= STAMPY_MAX_MESSAGES_PER_HOUR) {
      return { isBlocked: true, reason: "hour" };
    }

    // Check daily limit
    const { count: dailyCount, error: dailyError } = await supabase
      .from("stampy_usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("status", "blocked")
      .gte("created_at", oneDayAgo);

    if (dailyError) {
      console.error("[Stampy] rate limit daily check failed", dailyError);
    } else if (dailyCount !== null && dailyCount >= STAMPY_MAX_MESSAGES_PER_DAY) {
      return { isBlocked: true, reason: "day" };
    }

    return { isBlocked: false };
  } catch (error) {
    console.error("[Stampy] rate limit check failed", error);
    // Allow the request on failure
    return { isBlocked: false };
  }
}
