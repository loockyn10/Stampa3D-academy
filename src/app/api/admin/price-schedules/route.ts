import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { attentionSchedules, computeValidationAlert } from "@/lib/mercadopago/price-schedule-alerts";
import { listScheduleOverview, priceSchedulesEnabled, priceStepUpEnabled } from "@/lib/mercadopago/price-schedule-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const MAX_EMAIL_LOOKUPS = 60;

/**
 * Admin view of the promotional price schedules: switches, validation alert, counts and the schedules themselves.
 * Read-only. Admin only; provider payloads never leave the server.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Configuración de Supabase incompleta" }, { status: 500, headers: noStore });
  const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const flags = {
    schedulesEnabled: priceSchedulesEnabled(),
    stepUpEnabled: priceStepUpEnabled(),
    noticeMailerConfigured: Boolean(process.env.RESEND_API_KEY && process.env.PRICE_NOTICE_FROM),
    alertEmailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.PRICE_NOTICE_FROM && process.env.PRICE_ALERT_EMAIL),
  };

  let schedules;
  try {
    schedules = await listScheduleOverview(admin);
  } catch {
    // The price-schedule migration is not applied yet.
    return NextResponse.json({ available: false, flags }, { headers: noStore });
  }

  const alert = computeValidationAlert({ stepUpEnabled: flags.stepUpEnabled, schedules, now: new Date() });
  const counts: Record<string, number> = {};
  for (const row of schedules) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const summary = {
    available: true,
    flags,
    alert,
    counts,
    attention: attentionSchedules(schedules).length,
    total: schedules.length,
  };
  if (new URL(request.url).searchParams.get("summary") === "1") return NextResponse.json(summary, { headers: noStore });

  const emails = new Map<string, string>();
  for (const row of schedules.slice(0, MAX_EMAIL_LOOKUPS)) {
    if (emails.has(row.userId)) continue;
    try {
      const { data } = await admin.auth.admin.getUserById(row.userId);
      if (data?.user?.email) emails.set(row.userId, data.user.email);
    } catch {
      // the row is shown without the e-mail
    }
  }

  return NextResponse.json(
    { ...summary, schedules: schedules.map((row) => ({ ...row, email: emails.get(row.userId) ?? null })) },
    { headers: noStore },
  );
}
