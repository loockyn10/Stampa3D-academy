import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createMembershipDependencies } from "@/lib/mercadopago/membership-server";
import { syncUserMembership } from "@/lib/mercadopago/membership-sync";
import { membershipDto, membershipErrorResponse } from "@/lib/mercadopago/membership-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * "Check my payment" for the signed-in user (return from checkout, /pago/estado, Mi membresía).
 * Only the session user's own subscription is read (no id comes from the client); its owner is re-verified against
 * the checkout that created it. Premium is granted only by an approved charge (see membership-billing.ts).
 */
export async function POST() {
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
    const { summary, synced } = await syncUserMembership(user.id, deps);
    return NextResponse.json(
      {
        // Kept for older clients: `active` is real access, `status` the user-facing state.
        active: summary.hasAccess,
        status: synced ? summary.state : "not_found",
        access_until: summary.accessUntil,
        membership: membershipDto(summary),
      },
      { headers: noStore },
    );
  } catch (error) {
    console.error("[MP sync-subscription]", error instanceof Error ? error.message : "error");
    const failure = membershipErrorResponse(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: noStore });
  }
}
