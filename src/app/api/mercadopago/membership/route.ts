import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createMembershipDependencies } from "@/lib/mercadopago/membership-server";
import { readMembershipSummary } from "@/lib/mercadopago/membership-sync";
import { membershipDto, membershipErrorResponse } from "@/lib/mercadopago/membership-http";
import { priceSchedulesEnabled, readPriceNotice } from "@/lib/mercadopago/price-schedule-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** "Mi membresía": read-only summary of the session user's membership (Supabase only, no Mercado Pago call). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }

  const deps = createMembershipDependencies();
  if (!deps) {
    return NextResponse.json({ error: "Configuración incompleta" }, { status: 500, headers: noStore });
  }

  try {
    const summary = await readMembershipSummary(user.id, deps);
    // Notice of a coming price change (promotions by billing periods). Never blocks the membership summary.
    let priceNotice: Awaited<ReturnType<typeof readPriceNotice>> = null;
    if (priceSchedulesEnabled()) {
      try {
        priceNotice = await readPriceNotice(deps.admin, user.id);
      } catch (error) {
        console.error("[MP membership] price notice", error instanceof Error ? error.message : "error");
      }
    }
    return NextResponse.json({ membership: membershipDto(summary), price_notice: priceNotice }, { headers: noStore });
  } catch (error) {
    console.error("[MP membership]", error instanceof Error ? error.message : "error");
    const failure = membershipErrorResponse(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: noStore });
  }
}
